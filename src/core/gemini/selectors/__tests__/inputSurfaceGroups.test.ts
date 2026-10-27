import { afterEach, describe, expect, it } from 'vitest';

import { installGeminiSelectorPatch } from '@/pages/content/__tests__/geminiOnlineSelectorFixture';

import { getGeminiSelectorView, type GeminiSelectorProfileKey } from '..';

let stop = () => {};
afterEach(() => {
  stop();
  document.body.replaceChildren();
});

// The public read result is DOM identity, not membership in a private registry.
const surfaces: Array<{ key: GeminiSelectorProfileKey; markup: string; bundled: string }> = [
  {
    key: 'inputCollapse.wrapper',
    markup: '<rich-textarea id="bundled"></rich-textarea>',
    bundled: 'bundled',
  },
  {
    key: 'vim.configuredComposer',
    markup: '<input-area-v2 id="bundled"></input-area-v2>',
    bundled: 'bundled',
  },
  {
    key: 'promptHistory.candidates',
    markup: '<textarea id="bundled"></textarea>',
    bundled: 'bundled',
  },
  { key: 'slash.candidates', markup: '<textarea id="bundled"></textarea>', bundled: 'bundled' },
  {
    key: 'sentChips.bubbles',
    markup: '<div id="bundled" class="user-query-bubble-container"></div>',
    bundled: 'bundled',
  },
  { key: 'project.inputs', markup: '<textarea id="bundled"></textarea>', bundled: 'bundled' },
  {
    key: 'activity.inputs',
    markup: '<rich-textarea><div contenteditable="true" id="bundled"></div></rich-textarea>',
    bundled: 'bundled',
  },
];

describe('independent input surface syntax fallback', () => {
  it.each(surfaces)(
    'a broken $key keeps another surface working',
    async ({ key, markup, bundled }) => {
      document.body.innerHTML = markup + '<div id="other"></div>';
      const other = key === 'project.inputs' ? 'slash.candidates' : 'project.inputs';
      stop = await installGeminiSelectorPatch({ [key]: ['['], [other]: ['#other'] });
      const profiles = getGeminiSelectorView().profiles;
      expect(document.querySelector(profiles[key].join(','))?.id).toBe(bundled);
      expect(document.querySelector(profiles[other].join(','))?.id).toBe('other');
    },
  );
});
