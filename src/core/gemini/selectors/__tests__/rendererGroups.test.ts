import { afterEach, describe, expect, it } from 'vitest';

import { installGeminiSelectorPatch } from '@/pages/content/__tests__/geminiOnlineSelectorFixture';

import { getGeminiSelectorView, type GeminiSelectorProfileKey } from '..';

let stop = () => {};
afterEach(() => {
  stop();
  document.body.replaceChildren();
});

const surfaces: Array<{ key: GeminiSelectorProfileKey; markup: string }> = [
  { key: 'code.host', markup: '<code-block id="bundled"></code-block>' },
  { key: 'userLatex.lines', markup: '<p class="query-text-line" id="bundled">x</p>' },
];

describe('renderer syntax fallback', () => {
  it.each(surfaces)('a broken $key leaves other surfaces usable', async ({ key, markup }) => {
    document.body.innerHTML = markup + '<section id="repaired">Independent repair</section>';
    const other = key === 'code.host' ? 'userLatex.lines' : 'code.host';
    stop = await installGeminiSelectorPatch({ [key]: ['['], [other]: ['#repaired'] });
    const { profiles } = getGeminiSelectorView();
    expect(document.querySelector(profiles[key].join(','))?.id).toBe('bundled');
    expect(document.querySelector(profiles[other].join(','))?.textContent).toBe(
      'Independent repair',
    );
  });
});
