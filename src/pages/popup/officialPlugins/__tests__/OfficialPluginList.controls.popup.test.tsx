import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '@/contexts/LanguageContext';
import { StorageKeys } from '@/core/types/common';
import { getModifierKey } from '@/core/utils/browser';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { loadTranslations } from '@/utils/translations';

import Popup from '../../Popup';
import { extensionApi, popupRows, resetPopupBrowser } from './popupHarness';

const en = await loadTranslations('en');

// Keep Popup, its hooks and the packaged manifests real; replace only browser APIs.
vi.mock('webextension-polyfill', async () => ({
  default: (await import('./popupHarness')).extensionApi,
}));
vi.mock('@/core/utils/browser', async (importOriginal) => {
  const { browserTarget } = await import('./popupHarness');
  return {
    ...(await importOriginal<typeof import('@/core/utils/browser')>()),
    isSafari: () => browserTarget.safari,
  };
});

/** What a row shows under its switch while on: options, sliders and usage hints. */
describe('the official plugin list in the popup', () => {
  let container: HTMLDivElement;
  let root: Root;
  let local: Record<string, unknown>;
  let sync: Record<string, unknown>;

  beforeEach(() => {
    ({ local, sync } = resetPopupBrowser());
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const mount = async () => {
    await act(async () => {
      root.render(
        <LanguageProvider>
          <Popup />
        </LanguageProvider>,
      );
    });
  };

  const row = (id: string) => popupRows(container).row(id);
  const toggle = (id: string) => popupRows(container).toggle(id);

  describe('the appearance sliders', () => {
    const sliders = (id: string) => [
      ...row(id)!.querySelectorAll<HTMLInputElement>('input[type="range"]'),
    ];
    const slider = (id: string, label: string) =>
      sliders(id).find(
        (input) =>
          container.querySelector(`#${input.getAttribute('aria-labelledby')}`)?.textContent ===
          label,
      )!;
    const drag = (input: HTMLInputElement, value: number) => {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          input,
          value,
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    const release = async (input: HTMLInputElement) => {
      await act(async () => input.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
    };
    const pluginStateWritten = () =>
      extensionApi.storage.local.set.mock.calls.some(([updates]) =>
        Object.hasOwn(updates as object, StorageKeys.PLUGINS_STATE),
      );

    it.each([
      [
        'a chat width of 840px (70%, the default)',
        StorageKeys.CHAT_WIDTH,
        840,
        OFFICIAL_PLUGIN_IDS.geminiChatWidth,
        false,
      ],
      [
        'a chat width of 720px (60%)',
        StorageKeys.CHAT_WIDTH,
        720,
        OFFICIAL_PLUGIN_IDS.geminiChatWidth,
        true,
      ],
      [
        'an edit input width of 720px (60%, the default)',
        StorageKeys.EDIT_INPUT_WIDTH,
        720,
        OFFICIAL_PLUGIN_IDS.geminiEditInputWidth,
        false,
      ],
      [
        'an edit input width of 80%',
        StorageKeys.EDIT_INPUT_WIDTH,
        80,
        OFFICIAL_PLUGIN_IDS.geminiEditInputWidth,
        true,
      ],
      [
        'a sidebar width of 26%',
        StorageKeys.SIDEBAR_WIDTH,
        26,
        OFFICIAL_PLUGIN_IDS.geminiSidebarWidth,
        true,
      ],
      [
        'a sidebar width of 312px (the default)',
        StorageKeys.SIDEBAR_WIDTH,
        312,
        OFFICIAL_PLUGIN_IDS.geminiSidebarWidth,
        false,
      ],
    ] as const)(
      'with no stored switch, %s reads on or off as the page does',
      async (_label, widthKey, width, id, expected) => {
        sync[widthKey] = width;
        await mount();
        expect(toggle(id).checked).toBe(expected);
        expect(extensionApi.storage.sync.set).not.toHaveBeenCalled();
      },
    );

    it('a stored off switch stays off whatever width is stored', async () => {
      sync[StorageKeys.CHAT_WIDTH] = 32;
      sync[StorageKeys.CHAT_WIDTH_ENABLED] = false;
      sync[StorageKeys.SIDEBAR_WIDTH] = 26;
      sync[StorageKeys.SIDEBAR_WIDTH_ENABLED] = false;
      await mount();
      expect(toggle(OFFICIAL_PLUGIN_IDS.geminiChatWidth).checked).toBe(false);
      expect(toggle(OFFICIAL_PLUGIN_IDS.geminiSidebarWidth).checked).toBe(false);
    });

    it('shows each slider only while its row is on, with the stored value', async () => {
      sync[StorageKeys.CHAT_FONT_SIZE] = 120;
      await mount();
      expect(sliders(OFFICIAL_PLUGIN_IDS.geminiChatFontSize)).toHaveLength(0);
      expect(sliders(OFFICIAL_PLUGIN_IDS.geminiSidebarAutoHide)).toHaveLength(0);
      await act(async () => toggle(OFFICIAL_PLUGIN_IDS.geminiChatFontSize).click());
      const fontSize = slider(OFFICIAL_PLUGIN_IDS.geminiChatFontSize, en.chatFontSize);
      expect(fontSize.value).toBe('120');
      expect(fontSize.getAttribute('aria-valuetext')).toBe('120%');
      await act(async () => toggle(OFFICIAL_PLUGIN_IDS.geminiChatFontSize).click());
      expect(sliders(OFFICIAL_PLUGIN_IDS.geminiChatFontSize)).toHaveLength(0);
      expect(sync[StorageKeys.CHAT_FONT_SIZE]).toBe(120);
    });

    it('saves a width on keyboard release, not on every step, to its old sync key only', async () => {
      sync[StorageKeys.CHAT_WIDTH_ENABLED] = true;
      await mount();
      const width = slider(OFFICIAL_PLUGIN_IDS.geminiChatWidth, en.chatWidth);
      drag(width, 85);
      expect(width.getAttribute('aria-valuetext')).toBe('85%');
      expect(extensionApi.storage.sync.set).not.toHaveBeenCalled();
      await act(async () =>
        width.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true })),
      );
      expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
        [StorageKeys.CHAT_WIDTH]: 85,
      });
      expect(pluginStateWritten()).toBe(false);
    });

    it('saves paragraph spacing apart from line height on pointer release', async () => {
      sync[StorageKeys.CHAT_LINE_HEIGHT_ENABLED] = true;
      await mount();
      const paragraph = slider(OFFICIAL_PLUGIN_IDS.geminiChatLineHeight, en.chatParagraphSpacing);
      drag(paragraph, 20);
      expect(paragraph.getAttribute('aria-valuetext')).toBe('20px');
      expect(extensionApi.storage.sync.set).not.toHaveBeenCalled();
      await release(paragraph);
      expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
        [StorageKeys.CHAT_PARAGRAPH_SPACING]: 20,
      });
      expect(slider(OFFICIAL_PLUGIN_IDS.geminiChatLineHeight, en.chatLineHeight).value).toBe('160');
    });

    it('a width that turned its row on keeps it on when moved back to the default', async () => {
      // No stored switch: a 60% chat width reads on, and 70% would read off again.
      sync[StorageKeys.CHAT_WIDTH] = 60;
      await mount();
      const width = slider(OFFICIAL_PLUGIN_IDS.geminiChatWidth, en.chatWidth);
      drag(width, 70);
      await release(width);
      expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
        [StorageKeys.CHAT_WIDTH]: 70,
        [StorageKeys.CHAT_WIDTH_ENABLED]: true,
      });
      expect(toggle(OFFICIAL_PLUGIN_IDS.geminiChatWidth).checked).toBe(true);
    });

    it.each([
      [
        OFFICIAL_PLUGIN_IDS.geminiChatWidth,
        'chatWidth',
        StorageKeys.CHAT_WIDTH,
        88,
        90,
        StorageKeys.CHAT_WIDTH_ENABLED,
      ],
      [
        OFFICIAL_PLUGIN_IDS.geminiEditInputWidth,
        'editInputWidth',
        StorageKeys.EDIT_INPUT_WIDTH,
        88,
        90,
        StorageKeys.EDIT_INPUT_WIDTH_ENABLED,
      ],
      [
        OFFICIAL_PLUGIN_IDS.geminiSidebarWidth,
        'sidebarWidth',
        StorageKeys.SIDEBAR_WIDTH,
        400,
        456,
        StorageKeys.SIDEBAR_WIDTH_ENABLED,
      ],
    ] as const)(
      '%s: moving a custom width to another stores the unstored switch with it',
      async (id, label, widthKey, stored, next, switchKey) => {
        // An open page reads an unstored width switch off once the width changes live, so the
        // width alone would leave the row on here and the page off.
        sync[widthKey] = stored;
        await mount();
        expect(toggle(id).checked).toBe(true);
        const width = slider(id, en[label]);
        drag(width, next);
        await release(width);
        expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
          [widthKey]: next,
          [switchKey]: true,
        });
      },
    );

    it('shows a stored 26% sidebar as 312px and keeps it until a new width is picked', async () => {
      sync[StorageKeys.SIDEBAR_WIDTH] = 26;
      sync[StorageKeys.SIDEBAR_WIDTH_ENABLED] = true;
      await mount();
      const width = slider(OFFICIAL_PLUGIN_IDS.geminiSidebarWidth, en.sidebarWidth);
      expect(width.getAttribute('aria-valuetext')).toBe('312px');
      expect(width.value).not.toBe('180');
      // A click without a move writes nothing.
      await release(width);
      expect(extensionApi.storage.sync.set).not.toHaveBeenCalled();
      expect(sync[StorageKeys.SIDEBAR_WIDTH]).toBe(26);

      drag(width, 360);
      await release(width);
      expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
        [StorageKeys.SIDEBAR_WIDTH]: 360,
      });
    });
  });

  describe('the input collapse row', () => {
    const withContent = () =>
      row(OFFICIAL_PLUGIN_IDS.geminiInputCollapse)!.querySelector<HTMLInputElement>(
        `input[aria-label="${en.allowCollapseWhenNotEmpty}"]`,
      );

    it.each([
      ['missing', undefined, false],
      ['false', false, false],
      ['true', true, true],
    ] as const)(
      'shows a %s stored "collapse with content" the way the page reads it',
      async (_label, stored, expected) => {
        sync[StorageKeys.INPUT_COLLAPSE_ENABLED] = true;
        if (stored !== undefined) sync[StorageKeys.INPUT_COLLAPSE_WHEN_NOT_EMPTY] = stored;
        await mount();
        expect(withContent()!.checked).toBe(expected);
      },
    );

    it('offers "collapse with content" only while collapse is on, keeping its stored value', async () => {
      sync[StorageKeys.INPUT_COLLAPSE_WHEN_NOT_EMPTY] = true;
      await mount();
      expect(withContent()).toBeNull();

      await act(async () => toggle(OFFICIAL_PLUGIN_IDS.geminiInputCollapse).click());
      expect(withContent()!.checked).toBe(true);
      await act(async () => toggle(OFFICIAL_PLUGIN_IDS.geminiInputCollapse).click());
      expect(withContent()).toBeNull();
      expect(sync[StorageKeys.INPUT_COLLAPSE_WHEN_NOT_EMPTY]).toBe(true);
      expect(extensionApi.storage.sync.set.mock.calls.map(([payload]) => payload)).toEqual([
        { [StorageKeys.INPUT_COLLAPSE_ENABLED]: true },
        { [StorageKeys.INPUT_COLLAPSE_ENABLED]: false },
      ]);
    });

    it('writes "collapse with content" at once to its old sync key, not the plugin state', async () => {
      sync[StorageKeys.INPUT_COLLAPSE_ENABLED] = true;
      await mount();
      await act(async () => withContent()!.click());
      expect(withContent()!.checked).toBe(true);
      expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
        [StorageKeys.INPUT_COLLAPSE_WHEN_NOT_EMPTY]: true,
      });
      expect(local[StorageKeys.PLUGINS_STATE]).toBeUndefined();
    });
  });

  describe('usage hints', () => {
    const collapseHint = () => en.inputCollapseShortcutHint.replace('{modifier}', getModifierKey());

    it.each([
      [OFFICIAL_PLUGIN_IDS.geminiInputCollapse, StorageKeys.INPUT_COLLAPSE_ENABLED, collapseHint],
      [OFFICIAL_PLUGIN_IDS.geminiVimInput, StorageKeys.INPUT_VIM_MODE, () => en.inputVimModeHint],
    ] as const)('%s shows how to use it only while on', async (id, key, hint) => {
      await mount();
      expect(row(id)!.textContent).not.toContain(hint());
      await act(async () => toggle(id).click());
      expect(sync[key]).toBe(true);
      expect(row(id)!.textContent).toContain(hint());
      expect(hint()).not.toContain('{modifier}');
    });
  });
});
