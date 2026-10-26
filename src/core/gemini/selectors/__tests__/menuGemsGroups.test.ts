import { afterEach, describe, expect, it } from 'vitest';

import { installGeminiSelectorPatch } from '@/pages/content/__tests__/geminiOnlineSelectorFixture';

import { getGeminiSelectorView, type GeminiSelectorProfileKey } from '..';

let stop = () => {};
afterEach(() => {
  stop();
  document.body.replaceChildren();
});

const surfaces: Array<{ key: GeminiSelectorProfileKey; markup: string }> = [
  { key: 'menu.panels', markup: '<div id="bundled" class="mat-mdc-menu-panel" role="menu"></div>' },
  { key: 'exportOverlay.canvas', markup: '<div id="chat-history"></div>' },
  {
    key: 'sidebarWidth.buttons',
    markup:
      '<bard-sidenav><button id="bundled" aria-label="Close sidebar"></button></bard-sidenav>',
  },
  { key: 'sidebarHover.menus', markup: '<div id="bundled" class="mat-mdc-menu-panel"></div>' },
  { key: 'gems.list', markup: '<div id="bundled" data-test-id="your-gems-list"></div>' },
];

describe('menu and Gems surface syntax fallback', () => {
  it.each(surfaces)(
    'a broken $key keeps the independent surface usable',
    async ({ key, markup }) => {
      document.body.innerHTML = markup + '<div id="other"></div>';
      const other = key === 'gems.list' ? 'menu.content' : 'gems.title';
      stop = await installGeminiSelectorPatch({ [key]: ['['], [other]: ['#other'] });
      const profiles = getGeminiSelectorView().profiles;
      expect(document.querySelector(profiles[key].join(','))?.id).toBe(
        key === 'exportOverlay.canvas' ? 'chat-history' : 'bundled',
      );
      expect(document.querySelector(profiles[other].join(','))?.id).toBe('other');
    },
  );
});
