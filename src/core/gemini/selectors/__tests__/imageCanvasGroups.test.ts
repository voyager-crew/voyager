import { afterEach, describe, expect, it } from 'vitest';

import { installGeminiSelectorPatch } from '@/pages/content/__tests__/geminiOnlineSelectorFixture';

import { getGeminiSelectorView, type GeminiSelectorProfileKey } from '..';

let stop = () => {};
afterEach(() => {
  stop();
  document.body.replaceChildren();
});

const surfaces: Array<{ key: GeminiSelectorProfileKey; markup: string }> = [
  {
    key: 'imageExport.searchHosts',
    markup: '<div id="bundled" class="attachment-container search-images"></div>',
  },
  {
    key: 'generatedImage.downloadIcon',
    markup: '<mat-icon fonticon="download" id="bundled"></mat-icon>',
  },
  {
    key: 'canvas.codePanels',
    markup: '<code-immersive-panel id="bundled"></code-immersive-panel>',
  },
];

describe('image and Canvas syntax fallback', () => {
  it.each(surfaces)('a broken $key leaves every other surface usable', async ({ key, markup }) => {
    document.body.innerHTML = markup + '<section id="repaired">Independent repair</section>';
    stop = await installGeminiSelectorPatch({
      ...Object.fromEntries(surfaces.map((surface) => [surface.key, ['#repaired']])),
      [key]: ['['],
    });
    const { profiles } = getGeminiSelectorView();
    expect(document.querySelector(profiles[key].join(','))?.id).toBe('bundled');
    for (const other of surfaces.filter((surface) => surface.key !== key)) {
      expect(document.querySelector(profiles[other.key].join(','))?.textContent).toBe(
        'Independent repair',
      );
    }
  });
});
