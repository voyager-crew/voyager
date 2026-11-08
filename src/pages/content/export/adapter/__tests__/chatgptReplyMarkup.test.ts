import { describe, expect, it } from 'vitest';

import { plainReplyMarkdown } from '../chatgptReplyMarkup';

describe('plainReplyMarkdown', () => {
  it('turns citations, links and entities into plain Markdown', () => {
    const source =
      '¥10,000 ≈ £1,123。<Cite ref="turn2search14"/>\n\n' +
      'See <Link url="https://a.example/r" title="Claude plays robotics"/> and ' +
      '<Link url="https://b.example">the paper</Link> by ' +
      '<Entity category="people" value="Evan Hubinger"/>.';

    expect(plainReplyMarkdown(source)).toBe(
      '¥10,000 ≈ £1,123。\n\n' +
        'See [Claude plays robotics](https://a.example/r) and ' +
        '[the paper](https://b.example) by Evan Hubinger.',
    );
  });

  it('unwraps layout blocks without leaving their indentation as code', () => {
    const source = [
      '## 先说图里两台',
      '',
      '<box gap={3}>',
      '  <row align=start gap={3}>',
      '    <AsyncImage query="Lenovo Yoga laptop" aspectRatio="5:4"/>',
      '    <box flex="1" gap={1}>',
      '      <title size="lg">Lenovo Yoga Slim 7i</title>',
      '      <badge color="success"><icon name="check" size="xs" inline/> 已确认</badge>',
      '      <divider color="subtle"/>',
      '      **£999**，16GB 内存',
      '    </box>',
      '  </row>',
      '</box>',
      '',
      '    indented code stays',
    ].join('\n');

    expect(plainReplyMarkdown(source)).toBe(
      [
        '## 先说图里两台',
        '',
        'Lenovo Yoga Slim 7i',
        '已确认',
        '',
        '**£999**，16GB 内存',
        '',
        '    indented code stays',
      ].join('\n'),
    );
  });

  it('reads a table row as its cells side by side', () => {
    const source =
      '<table>\n<table-row><table-cell>项目</table-cell><table-cell>英镑</table-cell></table-row>\n' +
      '<table-row><table-cell>总计</table-cell><table-cell>£1,018.97</table-cell></table-row>\n</table>';

    expect(plainReplyMarkdown(source)).toBe('项目 | 英镑\n总计 | £1,018.97');
  });

  it('writes ChatGPT code blocks as fenced code, tags inside kept', () => {
    const source =
      'A wrapper:\n\n<CodeBlock language="typescript" editable>\nconst a = <box/>;\n</CodeBlock>';

    expect(plainReplyMarkdown(source)).toBe('A wrapper:\n\n```typescript\nconst a = <box/>;\n```');
  });

  it('keeps only the text of an interactive widget', () => {
    const source = [
      '## 我还想确认两个关键点',
      '',
      '{@body const [budget,setBudget] = DIL.useState("1500")}',
      '<box gap={2}>',
      '  1. 现在比较合理的预算上限是？',
      '  <radio-group value={budget} onChange={(v) => setBudget(v)}>',
      '    <radio value="1500">£1,500</radio>',
      '  </radio-group>',
      '  {#each items as item}',
      '  <button onClick={() => GenUI.issueNewTurn(`预算 £${budget} > 1000`)}>发送</button>',
      '  {/each}',
      '</box>',
    ].join('\n');

    expect(plainReplyMarkdown(source)).toBe(
      [
        '## 我还想确认两个关键点',
        '',
        '1. 现在比较合理的预算上限是？',
        '',
        '£1,500',
        '',
        '发送',
      ].join('\n'),
    );
  });

  it('leaves code that writes such tags untouched', () => {
    const source = 'Use `<box>` here:\n\n```tsx\n<box gap={2}><Cite ref="x"/></box>\n```';

    expect(plainReplyMarkdown(source)).toBe(source);
  });
});
