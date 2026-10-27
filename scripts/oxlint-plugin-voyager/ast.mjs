const WRAPPERS = new Set([
  'ChainExpression',
  'TSAsExpression',
  'TSTypeAssertion',
  'TSNonNullExpression',
  'TSInstantiationExpression',
  'AwaitExpression',
]);
const BUILDERS = new Set(['each', 'for', 'skipIf', 'runIf', 'extend']);

export function unwrap(node) {
  while (node && WRAPPERS.has(node.type)) node = node.expression ?? node.argument;
  return node;
}

export function propertyName(node) {
  if (!node.computed && node.key?.type === 'Identifier') return node.key.name;
  if (!node.computed && node.property?.type === 'Identifier') return node.property.name;
  const key = node.key ?? node.property;
  if (key?.type === 'Literal') return String(key.value);
  if (key?.type === 'TemplateLiteral' && key.expressions.length === 0) {
    return key.quasis[0].value.cooked;
  }
  return undefined;
}

export function isFunction(node) {
  return ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(
    node?.type,
  );
}

function undefinedValue(value) {
  return (
    (Array.isArray(value) && value.length === 1 && value[0] === 'undefined') ||
    (value?.type === 'Literal' && value.value === undefined) ||
    (value?.type === 'UnaryExpression' && value.operator === 'void')
  );
}

/** Resolve lexical aliases, preserving shadowed globals and imported API identities. */
export function createResolver(sourceCode) {
  function variable(node) {
    if (node?.type !== 'Identifier') return undefined;
    for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
      const found = scope.set.get(node.name);
      if (found) return found;
    }
    return undefined;
  }

  function member(base, key, seen) {
    if (Array.isArray(base)) return [...base, key];
    if (base?.type === 'ObjectExpression') {
      const property = base.properties.findLast(
        (entry) => entry.type === 'Property' && propertyName(entry) === key,
      );
      if (property) return resolve(property.value, seen);
      if (!base.properties.some((entry) => entry.type === 'SpreadElement')) {
        return { type: 'Literal', value: undefined };
      }
    }
    return undefined;
  }

  function bindingValue(pattern, name, value, seen) {
    if (pattern.type === 'Identifier') return pattern.name === name ? { value } : undefined;
    if (pattern.type === 'AssignmentPattern') {
      return bindingValue(
        pattern.left,
        name,
        undefinedValue(value) ? resolve(pattern.right, seen) : value,
        seen,
      );
    }
    if (pattern.type !== 'ObjectPattern') return undefined;
    for (const property of pattern.properties) {
      if (property.type !== 'Property') continue;
      const key = propertyName(property);
      if (key === undefined) continue;
      const found = bindingValue(property.value, name, member(value, key, seen), seen);
      if (found) return found;
    }
    return undefined;
  }

  function resolve(input, seen = new Set()) {
    const node = unwrap(input);
    if (!node || seen.has(node)) return undefined;
    seen = new Set(seen).add(node);
    if (node.type === 'Identifier') {
      const definition = variable(node)?.defs[0];
      if (!definition) return [node.name];
      if (definition.type === 'ImportBinding') {
        const imported = definition.node;
        const source = definition.parent.source.value;
        if (imported.type === 'ImportNamespaceSpecifier') return [source];
        return [source, imported.imported?.name ?? imported.imported?.value ?? 'default'];
      }
      if (definition.node.type === 'VariableDeclarator') {
        const declaration = definition.node;
        return bindingValue(declaration.id, node.name, resolve(declaration.init, seen), seen)
          ?.value;
      }
      if (isFunction(definition.node) && definition.type !== 'Parameter') {
        return definition.node;
      }
      return node;
    }
    if (node.type === 'MemberExpression') {
      const key = propertyName(node);
      if (key !== undefined) return member(resolve(node.object, seen), key, seen);
      return undefined;
    }
    if (node.type === 'ImportExpression' && node.source.type === 'Literal') {
      return [node.source.value];
    }
    if (node.type === 'CallExpression') {
      const callee = resolve(node.callee, seen);
      if (Array.isArray(callee)) {
        if (callee.length === 1 && callee[0] === 'require') {
          if (node.arguments[0]?.type === 'Literal') return [node.arguments[0].value];
        }
        if (BUILDERS.has(callee.at(-1))) return [...callee, '()'];
      }
      return node;
    }
    if (node.type === 'TaggedTemplateExpression') {
      const tag = resolve(node.tag, seen);
      if (Array.isArray(tag) && tag.at(-1) === 'each') return [...tag, '()'];
      return undefined;
    }
    return node;
  }

  function number(input, bindings = new Map(), seen = new Set()) {
    const node = unwrap(input);
    if (!node || seen.has(node)) return undefined;
    seen = new Set(seen).add(node);
    if (node.type === 'Literal' && typeof node.value === 'number') return node.value;
    if (node.type === 'Identifier' && bindings.has(variable(node))) {
      return number(bindings.get(variable(node)), bindings, seen);
    }
    if (node.type === 'UnaryExpression') {
      const value = number(node.argument, bindings, seen);
      if (value === undefined) return undefined;
      if (node.operator === '-') return -value;
      if (node.operator === '+') return value;
    }
    if (node.type === 'BinaryExpression') {
      const left = number(node.left, bindings, seen);
      const right = number(node.right, bindings, seen);
      if (left === undefined || right === undefined) return undefined;
      switch (node.operator) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          return left / right;
        case '%':
          return left % right;
        case '**':
          return left ** right;
        default:
          return undefined;
      }
    }
    const value = resolve(node);
    if (value && !Array.isArray(value) && value !== node) return number(value, bindings, seen);
    return undefined;
  }

  function isUndefined(input, bindings = new Map(), seen = new Set()) {
    const node = unwrap(input);
    if (!node || seen.has(node)) return false;
    seen = new Set(seen).add(node);
    if (node.type === 'Identifier' && bindings.has(variable(node))) {
      return isUndefined(bindings.get(variable(node)), bindings, seen);
    }
    const value = resolve(node);
    return undefinedValue(value);
  }

  function isNumeric(input) {
    if (number(input) !== undefined) return true;
    const node = unwrap(input);
    if (!node) return false;
    if (node.type === 'CallExpression') {
      const parts = resolve(node.callee);
      if (Array.isArray(parts) && parts.length === 1) {
        return ['Number', 'parseInt', 'parseFloat'].includes(parts[0]);
      }
    }
    if (node.type === 'UnaryExpression' && ['+', '-', '~'].includes(node.operator)) return true;
    if (
      node.type === 'BinaryExpression' &&
      ['-', '*', '/', '%', '**', '<<', '>>', '>>>', '|', '&', '^'].includes(node.operator)
    )
      return true;
    const value = resolve(node);
    return value && !Array.isArray(value) && value !== node ? isNumeric(value) : false;
  }

  return { resolve, variable, number, isUndefined, isNumeric };
}

export function apiPath(value) {
  if (!Array.isArray(value)) return [];
  if (['node:timers', 'timers', 'node:timers/promises', 'timers/promises'].includes(value[0])) {
    if (value[1] === 'default') return apiPath([value[0], ...value.slice(2)]);
    if (value[1] === 'promises') return [`${value[0]}/promises`, ...value.slice(2)];
  }
  if (['vitest', '@jest/globals'].includes(value[0])) return value.slice(1);
  if (['globalThis', 'global', 'window', 'self'].includes(value[0])) return value.slice(1);
  return value;
}

export function testCall(node, resolver) {
  const parts = apiPath(resolver.resolve(node.callee));
  if (!['it', 'test', 'describe'].includes(parts[0])) return undefined;
  if (BUILDERS.has(parts.at(-1))) return undefined;
  return parts;
}

export function hasOption(input, key, resolver, seen = new Set()) {
  const node = resolver.resolve(input);
  if (node?.type !== 'ObjectExpression' || seen.has(node)) return false;
  seen = new Set(seen).add(node);
  return node.properties.some((property) =>
    property.type === 'SpreadElement'
      ? hasOption(property.argument, key, resolver, seen)
      : propertyName(property) === key,
  );
}

export function children(node, sourceCode) {
  return (sourceCode.visitorKeys[node.type] ?? []).flatMap((key) => {
    const value = node[key];
    return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
  });
}
