import { apiPath, children, createResolver, hasOption, testCall } from './ast.mjs';

export function collectTimeouts(program, sourceCode) {
  const resolver = createResolver(sourceCode);
  const findings = [];
  function visit(node) {
    if (node.type === 'CallExpression') {
      const parts = testCall(node, resolver);
      if (parts && parts[0] !== 'describe') {
        if (
          resolver.isNumeric(node.arguments[2]) ||
          node.arguments.slice(1).some((argument) => hasOption(argument, 'timeout', resolver))
        ) {
          findings.push(node);
        }
      }
      const api = apiPath(resolver.resolve(node.callee));
      if (
        api.length === 2 &&
        ['vi', 'vitest'].includes(api[0]) &&
        api[1] === 'setConfig' &&
        hasOption(node.arguments[0], 'testTimeout', resolver)
      ) {
        findings.push(node);
      }
    }
    for (const child of children(node, sourceCode)) visit(child);
  }
  visit(program);
  return findings;
}

export function collectUnlinkedSkips(program, sourceCode) {
  const resolver = createResolver(sourceCode);
  const quarantines = new Set(
    sourceCode
      .getAllComments()
      .filter(
        (comment) => comment.type === 'Line' && /^\s*quarantine:\s*#[1-9]\d*\b/.test(comment.value),
      )
      .map((comment) => comment.loc.start.line),
  );
  const findings = [];
  function visit(node) {
    if (node.type === 'CallExpression') {
      const parts = testCall(node, resolver);
      if (parts?.some((part) => part === 'skip' || part === 'todo')) {
        const start = node.loc.start.line;
        const end = node.loc.end.line;
        // A trailing comment on a multiline registration belongs to its closing line.
        if (!quarantines.has(start - 1) && !quarantines.has(start) && !quarantines.has(end)) {
          findings.push(node);
        }
      }
    }
    for (const child of children(node, sourceCode)) visit(child);
  }
  visit(program);
  return findings;
}
