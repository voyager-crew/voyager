import { apiPath, children, createResolver } from './ast.mjs';

/** Window properties a browser realm marks [LegacyUnforgeable]; the VM pools refuse to redefine them. */
const UNFORGEABLE = new Set(['location', 'window', 'document', 'top']);
const GLOBAL_OBJECT = new Set(['globalThis', 'global', 'window', 'self']);
/** Environments with a browser realm; any other declared one (node) has ordinary globals. */
const DOM_ENVIRONMENTS = new Set(['jsdom', 'happy-dom']);

function stringValue(input, resolver) {
  const node = resolver.resolve(input);
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
  return undefined;
}

function isGlobalObject(input, resolver) {
  const value = resolver.resolve(input);
  return Array.isArray(value) && value.length > 0 && value.every((part) => GLOBAL_OBJECT.has(part));
}

function declaredEnvironment(sourceCode) {
  for (const comment of sourceCode.getAllComments()) {
    const match = /@vitest-environment\s+([\w-]+)/.exec(comment.value);
    if (match) return match[1];
  }
  return undefined;
}

export function collectUnforgeableStubs(program, sourceCode) {
  const environment = declaredEnvironment(sourceCode);
  if (environment && !DOM_ENVIRONMENTS.has(environment)) return [];
  const resolver = createResolver(sourceCode);
  const findings = [];
  function visit(node) {
    if (node.type === 'CallExpression') {
      const api = apiPath(resolver.resolve(node.callee));
      const [first, second] = node.arguments;
      const redefines =
        api.length === 2 &&
        ['Object', 'Reflect'].includes(api[0]) &&
        api[1] === 'defineProperty' &&
        isGlobalObject(first, resolver) &&
        UNFORGEABLE.has(stringValue(second, resolver));
      const stubs =
        api.length === 2 &&
        ['vi', 'vitest'].includes(api[0]) &&
        api[1] === 'stubGlobal' &&
        UNFORGEABLE.has(stringValue(first, resolver));
      if (redefines || stubs) findings.push(node);
    }
    for (const child of children(node, sourceCode)) visit(child);
  }
  visit(program);
  return findings;
}
