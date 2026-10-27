import ts from 'typescript';

const HTML_TAGS = new Set(
  'a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup option output p picture pre progress q rp rt ruby s samp script search section select slot small source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track u ul var video wbr'.split(
    ' ',
  ),
);

/** Native HTML construction is a protocol sink; an arbitrary createElement method is not. */
export function isHtmlConstruction(node: ts.Node, file: string, value: string): boolean {
  if (!HTML_TAGS.has(value)) return false;
  const call = node.parent;
  if (!ts.isCallExpression(call)) return false;
  if (ts.isPropertyAccessExpression(call.expression)) {
    const receiver = call.expression.expression;
    const native =
      (ts.isIdentifier(receiver) && receiver.text === 'document') ||
      (ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'ownerDocument');
    if (native)
      return (
        (call.expression.name.text === 'createElement' && call.arguments[0] === node) ||
        (call.expression.name.text === 'createElementNS' && call.arguments[1] === node)
      );
  }
  const index =
    file === 'src/features/plugins/verbs/siteCheck/panel.ts'
      ? 1
      : [
            'src/pages/content/researchPack/panel.ts',
            'src/pages/content/researchPack/templatesSection.ts',
          ].includes(file)
        ? 0
        : -1;
  return (
    index >= 0 &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === 'el' &&
    call.arguments[index] === node
  );
}
