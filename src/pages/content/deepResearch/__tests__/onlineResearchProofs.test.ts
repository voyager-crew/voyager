import { afterEach, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '@/pages/content/__tests__/geminiOnlineSelectorFixture';

import { extractThinkingPanels } from '../extractor';
import { findDeepResearchReportRoot } from '../reportExtractor';

let retire = () => {};
afterEach(() => {
  retire();
  document.body.replaceChildren();
  vi.useRealTimers();
});

function fixture(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01'));
  document.body.innerHTML = `<main><div class="conversation-container"><user-query>Research the result</user-query><model-response id="reply">
    <deep-research-immersive-panel data-panel>
      <thinking-panel data-thinking><div class="item-container" data-item>
        <thought-item><div class="thought-header">Searching</div><div class="gds-body-m gds-italic">Gathering sources</div></thought-item>
        <browse-chip-list><browse-web-chip><a data-test-id="browse-chip-link" href="https://example.com/report"><span data-test-id="domain-name">example.com</span><span data-test-id="title">Source</span></a></browse-web-chip></browse-chip-list>
      </div></thinking-panel>
      <div class="markdown" data-report><h1>Research report</h1><p>The complete report.</p></div>
    </deep-research-immersive-panel>
  </model-response></div></main><section id="foreign"><div data-wrong><h1>Another report</h1>Unrelated answer</div></section>`;
}

it.each([
  ['deepResearch.panel', '[data-panel]', 'deep-research-immersive-panel'],
  ['deepResearch.items', '[data-item]', '.item-container'],
  ['deepResearch.thinkingPanels', '[data-thinking]', 'thinking-panel'],
  ['deepResearch.reportCandidates', '[data-report]', '.markdown'],
] as const)(
  '%s preserves the same thinking and report while refusing an unrelated owner',
  async (key, alias, original) => {
    fixture();
    const before = extractThinkingPanels();
    const report = findDeepResearchReportRoot();
    expect(before?.sections[0].items.map((item) => item.type)).toEqual(['thought', 'browse-chips']);
    retire = await installGeminiSelectorPatch({ [key]: [alias] });
    expect(extractThinkingPanels()).toEqual(before);
    expect(findDeepResearchReportRoot()).toBe(report);
    const target = document.querySelector(alias)!;
    const renamed = document.createElement('section');
    for (const attr of target.attributes)
      if (attr.name !== 'class') renamed.setAttribute(attr.name, attr.value);
    renamed.append(...Array.from(target.childNodes));
    target.replaceWith(renamed);
    expect(document.querySelector(original)).toBeNull();
    expect(extractThinkingPanels()).toEqual(before);
    expect(findDeepResearchReportRoot()?.textContent).toBe('Research reportThe complete report.');
    // Move the same plausible markup out of the current reply; a nonempty match no longer proves ownership.
    const panel = document.querySelector('[data-panel]')!;
    document.getElementById('foreign')!.append(panel);
    const wrong = key === 'deepResearch.panel' ? panel : panel.querySelector(alias)!;
    if (key === 'deepResearch.panel') expect(extractThinkingPanels()).toBeNull();
    else {
      // Restore the old landmark with the real content; rejection must recover usable native output.
      const restored = document.createElement(original.startsWith('.') ? 'div' : original);
      if (original.startsWith('.')) restored.className = original.slice(1);
      restored.append(...Array.from(wrong.childNodes));
      wrong.replaceWith(restored);
      expect(extractThinkingPanels()).toEqual(before);
      expect(findDeepResearchReportRoot()?.textContent).toBe('Research reportThe complete report.');
    }
  },
);

it('a source link with a non-web protocol cannot certify a renamed research panel', async () => {
  fixture();
  retire = await installGeminiSelectorPatch({ 'deepResearch.panel': ['[data-panel]'] });
  const panel = document.querySelector('[data-panel]')!;
  const renamed = document.createElement('section');
  renamed.setAttribute('data-panel', '');
  renamed.append(...Array.from(panel.childNodes));
  panel.replaceWith(renamed);
  const source = document.querySelector<HTMLAnchorElement>('a')!;
  source.href = 'javascript:void(0)';
  expect(extractThinkingPanels()).toBeNull();
  source.href = 'https://example.com/report';
  expect(extractThinkingPanels()?.sections[0].items[1].type).toBe('browse-chips');
});

it('a partial research item list does not omit the second source from the export', async () => {
  fixture();
  const original = document.querySelector('.item-container')!;
  const second = original.cloneNode(true) as HTMLElement;
  second.removeAttribute('data-item');
  second.querySelector('[data-test-id="domain-name"]')!.textContent = 'second.example';
  original.after(second);
  const before = extractThinkingPanels();
  retire = await installGeminiSelectorPatch({ 'deepResearch.items': ['[data-item]'] });
  expect(extractThinkingPanels()).toEqual(before);
  second.setAttribute('data-item', '');
  expect(extractThinkingPanels()).toEqual(before);
});

it('a partial thinking list does not omit another research section', async () => {
  fixture();
  const original = document.querySelector('thinking-panel')!;
  const second = original.cloneNode(true) as HTMLElement;
  second.removeAttribute('data-thinking');
  second.querySelector('.thought-header')!.textContent = 'Checking another source';
  original.after(second);
  const before = extractThinkingPanels();
  retire = await installGeminiSelectorPatch({ 'deepResearch.thinkingPanels': ['[data-thinking]'] });
  expect(extractThinkingPanels()).toEqual(before);
  second.setAttribute('data-thinking', '');
  expect(extractThinkingPanels()).toEqual(before);
});

it('a report heading alone cannot replace the complete exported report', async () => {
  fixture();
  const before = findDeepResearchReportRoot();
  retire = await installGeminiSelectorPatch({
    'deepResearch.reportCandidates': ['[data-report] h1'],
  });
  expect(findDeepResearchReportRoot()).toBe(before);
  retire();
  retire = await installGeminiSelectorPatch({ 'deepResearch.reportCandidates': ['[data-report]'] });
  expect(findDeepResearchReportRoot()).toBe(before);
});

it('an extra remote report candidate cannot win export by containing longer unrelated text', async () => {
  fixture();
  const report = document.querySelector<HTMLElement>('[data-report]')!;
  report.className = 'renamed-report';
  retire = await installGeminiSelectorPatch({ 'deepResearch.reportCandidates': ['[data-report]'] });
  expect(findDeepResearchReportRoot()).toBe(report);
  const wrong = document.createElement('button');
  wrong.setAttribute('data-report', '');
  wrong.innerHTML = `<h1>Control preview</h1>${'Unrelated menu text '.repeat(50)}`;
  report.after(wrong);
  expect(findDeepResearchReportRoot()).toBeNull();
  wrong.removeAttribute('data-report');
  expect(findDeepResearchReportRoot()).toBe(report);
});

it('a merged research item wrapper cannot discard the second thought and browse list', async () => {
  fixture();
  const item = document.querySelector('.item-container')!;
  const second = item.cloneNode(true) as HTMLElement;
  second.querySelector('.thought-header')!.textContent = 'Second source';
  second.querySelector('[data-test-id="domain-name"]')!.textContent = 'second.example';
  const wrapper = document.createElement('div');
  wrapper.id = 'merged';
  item.before(wrapper);
  wrapper.append(item, second);
  const before = extractThinkingPanels();
  retire = await installGeminiSelectorPatch({ 'deepResearch.items': ['#merged'] });
  expect(extractThinkingPanels()).toEqual(before);
  retire();
  retire = await installGeminiSelectorPatch({ 'deepResearch.items': ['[data-item]'] });
  expect(extractThinkingPanels()).toEqual(before);
});

it('a thinking section without browse links still exports and cannot be omitted by a repair', async () => {
  fixture();
  const only = document.createElement('thinking-panel');
  only.innerHTML =
    '<div class="item-container"><thought-item><div class="thought-header">Synthesis</div><div class="gds-body-m gds-italic">A thought without another browse step</div></thought-item></div>';
  document.querySelector('thinking-panel')!.after(only);
  const before = extractThinkingPanels();
  retire = await installGeminiSelectorPatch({ 'deepResearch.thinkingPanels': ['[data-thinking]'] });
  expect(extractThinkingPanels()).toEqual(before);
  const renamed = document.createElement('section');
  renamed.setAttribute('data-thinking', '');
  renamed.append(...Array.from(only.childNodes));
  only.replaceWith(renamed);
  expect(extractThinkingPanels()).toEqual(before);
});

it.each(['img', 'svg', 'canvas', 'math'])(
  'a same-text report repair cannot drop a sibling %s',
  async (tag) => {
    fixture();
    const report = document.querySelector<HTMLElement>('[data-report]')!;
    report.className = 'renamed-report';
    retire = await installGeminiSelectorPatch({
      'deepResearch.reportCandidates': ['[data-report]'],
    });
    expect(findDeepResearchReportRoot()).toBe(report);
    const source = document.createElement(tag);
    report.after(source);
    expect(findDeepResearchReportRoot()).toBeNull();
    report.append(source);
    expect(findDeepResearchReportRoot()).toBe(report);
  },
);

it('a second owned research panel cannot replace the original report selected by the page', async () => {
  fixture();
  const first = document.querySelector('[data-panel]')!;
  const second = first.cloneNode(true) as HTMLElement;
  second.id = 'second';
  second.querySelector('h1')!.textContent = 'A different report';
  first.after(second);
  const before = findDeepResearchReportRoot();
  retire = await installGeminiSelectorPatch({ 'deepResearch.panel': ['#second'] });
  expect(findDeepResearchReportRoot()).toBe(before);
  first.remove();
  expect(findDeepResearchReportRoot()?.querySelector('h1')?.textContent).toBe('A different report');
});

it('a merged thinking wrapper cannot collapse two native research sections into one', async () => {
  fixture();
  const first = document.querySelector('thinking-panel')!;
  const second = first.cloneNode(true) as HTMLElement;
  second.querySelector('.thought-header')!.textContent = 'Another research phase';
  const wrapper = document.createElement('div');
  wrapper.id = 'thinking-wrapper';
  first.before(wrapper);
  wrapper.append(first, second);
  const before = extractThinkingPanels();
  retire = await installGeminiSelectorPatch({
    'deepResearch.thinkingPanels': ['#thinking-wrapper'],
  });
  expect(extractThinkingPanels()).toEqual(before);
  retire();
  retire = await installGeminiSelectorPatch({ 'deepResearch.thinkingPanels': ['[data-thinking]'] });
  expect(extractThinkingPanels()).toEqual(before);
});

it.each(['dialog', 'form', 'alertdialog', 'contenteditable', 'gv-preview'])(
  'a %s transcript copy cannot certify a renamed research panel',
  async (kind) => {
    fixture();
    const original = document.querySelector('[data-panel]')!;
    const renamed = document.createElement('section');
    renamed.setAttribute('data-panel', '');
    renamed.append(...Array.from(original.childNodes));
    original.replaceWith(renamed);
    const reply = document.getElementById('reply')!;
    const parent = reply.parentElement!;
    const preview = document.createElement(kind === 'dialog' || kind === 'form' ? kind : 'div');
    if (kind === 'alertdialog') preview.setAttribute('role', 'alertdialog');
    if (kind === 'contenteditable') preview.setAttribute('contenteditable', 'true');
    if (kind === 'gv-preview') preview.className = 'gv-preview';
    document.body.append(preview);
    preview.append(reply);
    retire = await installGeminiSelectorPatch({ 'deepResearch.panel': ['[data-panel]'] });
    expect(findDeepResearchReportRoot()).toBeNull();
    parent.append(reply);
    expect(findDeepResearchReportRoot()?.querySelector('h1')?.textContent).toBe('Research report');
  },
);

it('a native reply association cannot move research export into a dialog', async () => {
  fixture();
  const original = document.querySelector('[data-panel]')!;
  const panel = document.createElement('section');
  panel.id = 'research';
  panel.setAttribute('data-panel', '');
  panel.append(...Array.from(original.childNodes));
  original.replaceWith(panel);
  const reply = document.getElementById('reply')!;
  const control = document.createElement('button');
  control.setAttribute('aria-controls', 'research');
  reply.append(control);
  const dialog = document.createElement('dialog');
  document.body.append(dialog);
  dialog.append(panel);
  retire = await installGeminiSelectorPatch({ 'deepResearch.panel': ['[data-panel]'] });
  expect(findDeepResearchReportRoot()).toBeNull();
  document.body.append(panel);
  expect(findDeepResearchReportRoot()?.querySelector('h1')?.textContent).toBe('Research report');
});

it('a copied reply association cannot claim an otherwise native research panel', async () => {
  fixture();
  const original = document.querySelector('[data-panel]')!;
  const panel = document.createElement('section');
  panel.id = 'research';
  panel.setAttribute('data-panel', '');
  panel.append(...Array.from(original.childNodes));
  original.remove();
  document.body.append(panel);
  const preview = document.createElement('form');
  preview.innerHTML =
    '<model-response><button aria-controls="research">Research</button></model-response>';
  document.body.append(preview);
  retire = await installGeminiSelectorPatch({ 'deepResearch.panel': ['[data-panel]'] });
  expect(findDeepResearchReportRoot()).toBeNull();
  document.getElementById('reply')!.append(preview.querySelector('button')!);
  expect(findDeepResearchReportRoot()?.querySelector('h1')?.textContent).toBe('Research report');
});
