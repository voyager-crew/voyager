import { apiPath, children, createResolver, isFunction, testCall, unwrap } from './ast.mjs';

const PROMISE_TIMERS = new Set(['node:timers/promises', 'timers/promises']);
const CALLBACK_TIMERS = new Set(['node:timers', 'timers']);
const HOOKS = new Set(['beforeAll', 'beforeEach', 'afterAll', 'afterEach']);

export function collectSleeps(program, sourceCode) {
  const resolver = createResolver(sourceCode);
  const sleepMemo = new WeakMap();
  const callbackMemo = new WeakMap();
  const cyclicFunctions = new Set();
  const bindingIds = new Map();
  const lexicalBindings = new WeakMap();

  function isPromise(node) {
    const parts = apiPath(resolver.resolve(node.callee));
    return node.type === 'NewExpression' && parts.length === 1 && parts[0] === 'Promise';
  }

  function hasDelay(node, index, bindings, defaultDelay) {
    const argument = node.arguments[index];
    if (!argument) return defaultDelay > 0;
    if (resolver.isUndefined(argument, bindings)) return defaultDelay > 0;
    const delay = resolver.number(argument, bindings);
    return delay === undefined || delay > 0;
  }

  function isCallbackTimer(node) {
    const parts = apiPath(resolver.resolve(node.callee));
    return (
      (parts.length === 1 && parts[0] === 'setTimeout') ||
      (parts.length === 2 && CALLBACK_TIMERS.has(parts[0]) && parts[1] === 'setTimeout')
    );
  }

  function promiseWaits(node, bindings, stack = new Set()) {
    // Nested declarations do not run, and a nested Promise owns its own wait.
    if (isFunction(node) || isPromise(node)) return false;
    if (node.type === 'CallExpression' && isCallbackTimer(node)) {
      return hasDelay(node, 1, bindings, 0);
    }
    if (node.type === 'CallExpression') {
      const callee = resolver.resolve(node.callee);
      if (
        isFunction(callee) &&
        evaluateFunction(callee, node.arguments, bindings, stack, promiseWaits, callbackMemo)
      )
        return true;
    }
    return children(node, sourceCode).some((child) => promiseWaits(child, bindings, stack));
  }

  function evaluateFunction(fn, args, bindings, stack, visit, memo) {
    if (stack.has(fn)) {
      for (const entry of stack) cyclicFunctions.add(entry);
      return false;
    }
    stack = new Set(stack).add(fn);
    bindings = new Map(bindings);
    fn.params.forEach((parameter, index) => {
      const binding = parameter.type === 'AssignmentPattern' ? parameter.left : parameter;
      // Omitted/undefined arguments apply defaults; an omitted browser delay yields a tick.
      const argument =
        !args[index] || resolver.isUndefined(args[index], bindings)
          ? (parameter.right ?? { type: 'Literal', value: undefined })
          : args[index];
      if (binding.type === 'Identifier') {
        bindings.set(resolver.variable(binding), argument);
      }
    });
    let visible = lexicalBindings.get(fn);
    if (!visible) {
      visible = new Set();
      for (let scope = sourceCode.getScope(fn.body); scope; scope = scope.upper) {
        for (const binding of scope.set.values()) visible.add(binding);
      }
      lexicalBindings.set(fn, visible);
    }
    // Caller locals cannot be captured by a sibling; retaining them defeats diamond reuse.
    const key = JSON.stringify(
      [...bindings]
        .filter(([binding]) => visible.has(binding))
        .map(([binding, value]) => {
          if (!bindingIds.has(binding)) bindingIds.set(binding, bindingIds.size);
          const number = resolver.number(value, bindings);
          return [
            bindingIds.get(binding),
            number === undefined
              ? resolver.isUndefined(value, bindings)
                ? 'undefined'
                : 'unknown'
              : String(number),
          ];
        }),
    );
    let cache = memo.get(fn);
    if (!cache) {
      cache = new Map();
      memo.set(fn, cache);
    }
    if (cache.has(key)) return cache.get(key);
    const result = visit(fn.body, bindings, stack);
    // Repeated branches reuse results, but a cycle-cut false is not a completed analysis.
    if (result || !cyclicFunctions.has(fn)) cache.set(key, result);
    return result;
  }

  function visitWaits(node, bindings, stack) {
    if (isFunction(node)) return false;
    if (waits(node, bindings, stack)) return true;
    if (isPromise(node)) {
      const executor = resolver.resolve(node.arguments[0]);
      return isFunction(executor) && visitWaits(executor.body, bindings, stack);
    }
    return children(node, sourceCode).some((child) => visitWaits(child, bindings, stack));
  }

  function functionWaits(fn, args, bindings, stack) {
    return evaluateFunction(fn, args, bindings, stack, visitWaits, sleepMemo);
  }

  function waits(input, bindings = new Map(), stack = new Set()) {
    const node = unwrap(input);
    if (!node) return false;
    if (isPromise(node)) {
      const executor = resolver.resolve(node.arguments[0]);
      return isFunction(executor) && promiseWaits(executor.body, bindings, stack);
    }
    if (node.type !== 'CallExpression') return false;
    const callee = resolver.resolve(node.callee);
    const parts = apiPath(callee);
    if (
      PROMISE_TIMERS.has(parts[0]) &&
      ((parts.length === 2 && parts[1] === 'setTimeout') ||
        (parts.length === 3 && parts[1] === 'scheduler' && parts[2] === 'wait'))
    ) {
      return hasDelay(node, 0, bindings, 1);
    }
    return isFunction(callee) && functionWaits(callee, node.arguments, bindings, stack);
  }

  function enclosingHelper(node) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (!isFunction(parent)) continue;
      const owner = parent.parent;
      if (owner?.type === 'NewExpression' && isPromise(owner)) continue;
      if (owner?.type === 'CallExpression') {
        const parts = apiPath(resolver.resolve(owner.callee));
        if (testCall(owner, resolver) || HOOKS.has(parts[0])) return undefined;
      }
      if (
        parent.type === 'FunctionDeclaration' ||
        owner?.type === 'VariableDeclarator' ||
        owner?.type === 'AssignmentPattern' ||
        owner?.type === 'Property'
      ) {
        return parent;
      }
    }
    return undefined;
  }

  const findings = new Set();
  function visit(node) {
    if (
      (node.type === 'CallExpression' || node.type === 'NewExpression') &&
      !enclosingHelper(node) &&
      waits(node)
    ) {
      findings.add(node);
    }
    if (node.type === 'CallExpression') {
      const parts = apiPath(resolver.resolve(node.callee));
      if (testCall(node, resolver) || HOOKS.has(parts[0])) {
        for (const argument of node.arguments) {
          const callback = resolver.resolve(argument);
          if (!isFunction(unwrap(argument)) && isFunction(callback)) {
            if (functionWaits(callback, [], new Map(), new Set())) findings.add(argument);
          }
        }
      }
    }
    for (const child of children(node, sourceCode)) visit(child);
  }
  visit(program);
  // Nested helper arguments can sleep independently; each call consumes an allowance.
  return [...findings];
}
