import { act } from 'react';

import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';

import { click, container, en, local, mount, sync, GEMINI } from './panelHarness';

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./panelBrowserApi')).extensionApi,
}));

describe('font size in the floating panel', () => {
  it.each(['gemini', 'chatgpt', 'claude', 'deepseek', 'kimi'] as const)(
    '%s saves the typed percentage in its own storage and resets to 100%',
    async (site) => {
      const id =
        site === 'gemini'
          ? OFFICIAL_PLUGIN_IDS.geminiChatFontSize
          : `voyager.${site}-reading-typography`;
      if (site === 'gemini') {
        sync[StorageKeys.CHAT_FONT_SIZE_ENABLED] = true;
        sync[StorageKeys.CHAT_FONT_SIZE] = 102;
      } else {
        local[StorageKeys.PLUGINS_STATE] = {
          [id]: {
            enabled: true,
            installedAt: 0,
            settings: { fontSizeEnabled: true, fontSize: 102, lineHeight: 165 },
          },
        };
      }
      const urls = {
        gemini: GEMINI.pageUrl,
        chatgpt: 'https://chatgpt.com/',
        claude: 'https://claude.ai/new',
        deepseek: 'https://chat.deepseek.com/',
        kimi: 'https://www.kimi.com/',
      };
      await mount({ ...GEMINI, siteId: site, pageUrl: urls[site] });
      const row = container.querySelector(`[data-row="${id}"]`)!;
      const input = row.querySelector<HTMLInputElement>('input[type="number"]')!;
      const track = row.querySelector<HTMLInputElement>('input[type="range"]')!;
      expect(input.value).toBe('102');
      expect(track.value).toBe('102');
      await act(async () => {
        input.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          input,
          '103',
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(track.value).toBe('102');
      await act(async () => input.blur());
      expect(track.value).toBe('103');
      const read = () =>
        site === 'gemini'
          ? sync[StorageKeys.CHAT_FONT_SIZE]
          : (
              local[StorageKeys.PLUGINS_STATE] as Record<string, { settings: { fontSize: number } }>
            )[id].settings.fontSize;
      expect(read()).toBe(103);
      await click(
        row.querySelector<HTMLButtonElement>(`button[aria-label="${en.themeColorReset} (100%)"]`)!,
      );
      expect(read()).toBe(100);
      expect(input.value).toBe('100');
    },
  );
});
