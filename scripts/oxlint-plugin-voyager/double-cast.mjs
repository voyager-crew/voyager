function isAssertion(node) {
  return node?.type === 'TSAsExpression' || node?.type === 'TSTypeAssertion';
}

export function collectDoubleCasts(node) {
  let inner = node.expression;
  while (inner?.type === 'ParenthesizedExpression') inner = inner.expression;
  if (!isAssertion(inner)) return [];
  let type = inner.typeAnnotation;
  while (type.type === 'TSParenthesizedType') type = type.typeAnnotation;
  return type.type === 'TSUnknownKeyword' || type.type === 'TSAnyKeyword' ? [node] : [];
}
