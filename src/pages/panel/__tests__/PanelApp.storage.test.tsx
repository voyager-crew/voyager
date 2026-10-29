import { act } from 'react';

import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { PANEL_SHELL_MESSAGE } from '@/features/panel/protocol';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { PROMPT_SWITCH_ID } from '@/pages/popup/hooks/usePromptSwitch';

import { FLOATING_BUTTON_ROW_ID } from '../usePanelModel';
import {
  CLAUDE,
  byId,
  click,
  container,
  extensionApi,
  flush,
  granted,
  local,
  mount,
  posted,
  postedKinds,
  rowNames,
  rowSwitch,
  sync,
  writeElsewhere,
} from './panelHarness';

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./panelBrowserApi')).extensionApi,
}));

const CHAT_WIDTH = OFFICIAL_PLUGIN_IDS.geminiChatWidth;
const DRAFT_SAVE = 'voyager.claude-draft-save';

const slider = (pluginId: string) =>
  container.querySelector<HTMLInputElement>(`[data-row="${pluginId}"] input[type="range"]`)!;
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const writesOf = (key: string) =>
  extensionApi.storage.sync.set.mock.calls.filter(([updates]) =>
    Object.hasOwn(updates as object, key),
  );

/** A held thumb: press, then each value as the browser reports it while dragging. */
async function drag(input: HTMLInputElement, values: readonly number[]): Promise<void> {
  await act(async () => {
    input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
  });
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  for (const value of values) {
    await act(async () => {
      setValue.call(input, String(value));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await nextFrame();
    });
  }
  await act(async () => {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await flush();
  });
}

describe('panel switches write where the popup writes', () => {
  it('a Gemini feature writes its legacy sync key', async () => {
    await mount();
    await click(rowSwitch(OFFICIAL_PLUGIN_IDS.geminiMermaid));

    expect(sync[StorageKeys.MERMAID_ENABLED]).toBe(true);
    expect(rowSwitch(OFFICIAL_PLUGIN_IDS.geminiMermaid).getAttribute('aria-checked')).toBe('true');
  });

  it('a site plugin changes only its own gvPluginsState entry, after the site grant', async () => {
    const other = { enabled: true, installedAt: 1 };
    local[StorageKeys.PLUGINS_STATE] = { 'voyager.other-plugin': other };
    await mount(CLAUDE);
    await click(rowSwitch(DRAFT_SAVE));

    expect(extensionApi.permissions.request).toHaveBeenCalledExactlyOnceWith({
      origins: ['https://claude.ai/*'],
    });
    expect(local[StorageKeys.PLUGINS_STATE]).toEqual({
      'voyager.other-plugin': other,
      [DRAFT_SAVE]: expect.objectContaining({ enabled: true }),
    });
  });

  it("Prompt Manager's row writes the coverage entry for the page's host", async () => {
    // Another website Prompt Manager covers, with its access, so it stays listed.
    sync[StorageKeys.PROMPT_CUSTOM_WEBSITES] = ['example.org'];
    granted.add('https://*.example.org/*');
    await mount(CLAUDE);
    await click(byId(PROMPT_SWITCH_ID));

    expect(sync[StorageKeys.PROMPT_CUSTOM_WEBSITES]).toEqual(['example.org', 'claude.ai']);
    expect(byId(PROMPT_SWITCH_ID)?.getAttribute('aria-checked')).toBe('true');
  });

  it('the floating button row writes the existing hide key, both ways', async () => {
    await mount();
    const floating = rowSwitch(FLOATING_BUTTON_ROW_ID);
    expect(floating.getAttribute('aria-checked')).toBe('true');

    await click(floating);
    expect(sync[StorageKeys.HIDE_PROMPT_MANAGER]).toBe(true);

    await click(floating);
    expect(sync[StorageKeys.HIDE_PROMPT_MANAGER]).toBe(false);
  });
});

describe('sliders', () => {
  it('previews every frame on the page while held, fading the panel, and saves once on release', async () => {
    sync[StorageKeys.CHAT_WIDTH_ENABLED] = true;
    sync[StorageKeys.CHAT_WIDTH] = 70;
    await mount();
    await drag(slider(CHAT_WIDTH), [75, 80]);

    expect(postedKinds()).toEqual([
      PANEL_SHELL_MESSAGE.fade,
      PANEL_SHELL_MESSAGE.preview,
      PANEL_SHELL_MESSAGE.preview,
      PANEL_SHELL_MESSAGE.fade,
      PANEL_SHELL_MESSAGE.previewEnd,
    ]);
    expect(posted[0]).toEqual({ kind: PANEL_SHELL_MESSAGE.fade, faded: true });
    expect(posted.slice(1, 3)).toEqual(
      [75, 80].map((value) => ({
        kind: PANEL_SHELL_MESSAGE.preview,
        pluginId: CHAT_WIDTH,
        settingKey: 'widthPercent',
        value,
      })),
    );
    expect(posted[3]).toEqual({ kind: PANEL_SHELL_MESSAGE.fade, faded: false });
    expect(window.postMessage).toHaveBeenCalledWith(posted[0], 'https://gemini.google.com');
    expect(writesOf(StorageKeys.CHAT_WIDTH)).toHaveLength(1);
    expect(sync[StorageKeys.CHAT_WIDTH]).toBe(80);
  });

  it('viewing another site saves without a preview or a fade', async () => {
    sync[StorageKeys.CHAT_WIDTH_ENABLED] = true;
    sync[StorageKeys.CHAT_WIDTH] = 70;
    await mount(CLAUDE);
    await click(container.querySelector('.siteBtn'));
    const gemini = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    ).find((item) => item.textContent?.includes('Gemini'));
    await click(gemini!);
    expect(container.querySelector('.siteBtn')?.classList.contains('away')).toBe(true);

    await drag(slider(CHAT_WIDTH), [75, 80]);

    expect(posted).toEqual([]);
    expect(writesOf(StorageKeys.CHAT_WIDTH)).toHaveLength(1);
    expect(sync[StorageKeys.CHAT_WIDTH]).toBe(80);
  });
});

describe('rows come from manifests', () => {
  it('a plugin installed while the panel is open appears as a row with the default icon', async () => {
    await mount();
    expect(rowNames()).not.toContain('My Gemini tweak');

    await writeElsewhere('local', {
      [StorageKeys.PLUGIN_LOCAL_MANIFESTS]: {
        'local.me.gemini-tweak': {
          manifest: {
            id: 'local.me.gemini-tweak',
            name: 'My Gemini tweak',
            version: '1.0.0',
            description: 'd',
            author: 'me',
            category: 'layout',
            license: 'MIT',
            engine: '>=1.0.0',
            tier: 'declarative',
            matches: ['https://gemini.google.com/*'],
            contributes: { styles: [{ css: '.gv-x{color:red}' }] },
          },
          importedAt: 1,
          updatedAt: 1,
        },
      },
    });

    expect(rowNames()).toContain('My Gemini tweak');
    const icon = container.querySelector('[data-row="local.me.gemini-tweak"] .ri svg');
    expect(icon?.classList.contains('lucide-puzzle')).toBe(true);
  });
});
