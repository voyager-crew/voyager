import { afterEach, describe, expect, it } from 'vitest';

import { installGeminiSelectorPatch } from '@/pages/content/__tests__/geminiOnlineSelectorFixture';

import { getGeminiSelectorView, type GeminiSelectorProfileKey } from '..';

let stop = () => {};
afterEach(() => {
  stop();
  document.body.replaceChildren();
});

const surfaces: Array<{ key: GeminiSelectorProfileKey; markup: string }> = [
  { key: 'content.answer', markup: '<message-content id="bundled"></message-content>' },
  { key: 'context.images', markup: '<generated-image><img id="bundled"></generated-image>' },
  { key: 'responseActions.bars', markup: '<message-actions id="bundled"></message-actions>' },
  { key: 'researchPack.actionBars', markup: '<message-actions id="bundled"></message-actions>' },
  { key: 'usage.root', markup: '<usage-metrics-window id="bundled"></usage-metrics-window>' },
];

describe('content, response and usage surface syntax fallback', () => {
  it.each(surfaces)(
    'a broken $key preserves the other surface’s repair',
    async ({ key, markup }) => {
      document.body.innerHTML = markup + '<section id="repaired"></section>';
      const other = key === 'usage.root' ? 'content.answer' : 'usage.root';
      stop = await installGeminiSelectorPatch({ [key]: ['['], [other]: ['#repaired'] });
      const { profiles } = getGeminiSelectorView();
      expect(document.querySelector(profiles[key].join(','))?.id).toBe('bundled');
      expect(document.querySelector(profiles[other].join(','))?.id).toBe('repaired');
    },
  );

  it('an unsupported user-content locator restores the answer from the same bundled group', async () => {
    document.body.innerHTML = `
      <message-content id="answer">Complete answer</message-content>
      <div class="query-text-line" id="question">Complete question</div>
      <section id="unrelated">Unrelated text</section>
      <aside id="usage">Usage panel</aside>`;
    stop = await installGeminiSelectorPatch({
      'content.answer': ['#unrelated'],
      'content.userLines': ['['],
      'usage.root': ['#usage'],
    });
    const { profiles } = getGeminiSelectorView();
    expect(document.querySelector(profiles['content.answer'].join(','))?.textContent).toBe(
      'Complete answer',
    );
    expect(document.querySelector(profiles['content.userLines'].join(','))?.textContent).toBe(
      'Complete question',
    );
    expect(document.querySelector(profiles['usage.root'].join(','))?.textContent).toBe(
      'Usage panel',
    );
  });
});
