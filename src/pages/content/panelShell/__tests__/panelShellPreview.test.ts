/**
 * Live preview from the panel's sliders through the shell into a running
 * plugin: one apply per animation frame, page transitions off while a slider
 * is held, nothing written to storage, and the stored value back when the
 * preview ends, the panel closes or its frame goes away.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { PANEL_SHELL_MESSAGE } from '@/features/panel/protocol';
import { PluginHost } from '@/features/plugins/runtime/PluginHost';
import type { LegacySettingsSource } from '@/features/plugins/runtime/legacySnapshotFeed';
import { createOfficialAdmission } from '@/features/plugins/runtime/officialAdmission';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { BundledCatalogPluginSource } from '@/features/plugins/sources/BundledCatalogPluginSource';
import type { LegacySettingSnapshot } from '@/features/plugins/storage/legacySettingBindings';

import {
  type ShellPage,
  bootstrapI18n,
  flush,
  installShellPage,
  panel,
  postFromPanel,
  pressAltV,
} from './shellHarness';

vi.mock('webextension-polyfill', () => ({ default: globalThis.chrome }));
vi.mock('@/core/utils/userEvent', () => import('./forgedEvents'));

const GEMINI = 'https://gemini.google.com/app/abc';
const FONT_ID = OFFICIAL_PLUGIN_IDS.geminiChatFontSize;

let page: ShellPage;
let host: PluginHost | null = null;
let fireLegacy: (changed: LegacySettingSnapshot) => void = () => {};

beforeAll(bootstrapI18n);

beforeEach(async () => {
  page = installShellPage(GEMINI);
  const fontSize = (await new BundledCatalogPluginSource().list()).find((m) => m.id === FONT_ID);
  if (!fontSize) throw new Error(`${FONT_ID} is not packaged`);
  let listener: ((changed: LegacySettingSnapshot) => void) | null = null;
  const legacySettings: LegacySettingsSource = {
    load: async () => ({
      [StorageKeys.CHAT_FONT_SIZE_ENABLED]: true,
      [StorageKeys.CHAT_FONT_SIZE]: 110,
    }),
    subscribe(callback) {
      listener = callback;
      return () => {
        listener = null;
      };
    },
  };
  fireLegacy = (changed) => listener?.(changed);
  const admission = createOfficialAdmission();
  admission.admit('gemini', 'chatFontSize');
  host = new PluginHost({
    url: GEMINI,
    sources: [{ id: 'bundled', list: async () => [fontSize] }],
    doc: document,
    admission,
    legacySettings,
    requestCatalogRefresh: () => {},
    isTopFrame: true,
  });
  await host.start();
  await page.start();
  pressAltV(document.body);
  await flush();
});

afterEach(async () => {
  vi.useRealTimers();
  host?.stop();
  host = null;
  for (const node of document.querySelectorAll('[data-gv-plugin]')) node.remove();
  await page.restore();
  vi.restoreAllMocks();
});

function fontSize(): string | undefined {
  const style = document.querySelector(`style[data-gv-plugin="${FONT_ID}"]`);
  return style?.textContent?.match(/--gv-chat-font-size: (\d+)%/)?.[1];
}

function slide(value: number): void {
  postFromPanel({
    kind: PANEL_SHELL_MESSAGE.preview,
    pluginId: FONT_ID,
    settingKey: 'fontSize',
    value,
  });
}

/** Real event-loop turns, for when the frame clock is fake. */
async function turns(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await flush();
}

function live(): boolean {
  return document.documentElement.classList.contains('gv-ps-live');
}

describe('live preview', () => {
  it('applies the latest slider value once per frame and writes nothing', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    expect(fontSize()).toBe('110');
    const style = document.querySelector(`style[data-gv-plugin="${FONT_ID}"]`)!;
    let updates = 0;
    const observer = new MutationObserver((records) => (updates += records.length));
    observer.observe(style, { childList: true, characterData: true, subtree: true });
    const writesBefore = page.memory.writes.length;

    for (const value of [120, 130, 145]) {
      slide(value);
      await turns();
    }
    expect(live()).toBe(true);
    expect(fontSize()).toBe('110');
    vi.advanceTimersToNextFrame();
    await turns();
    observer.disconnect();

    expect(fontSize()).toBe('145');
    expect(updates).toBe(1);
    expect(page.memory.writes.length).toBe(writesBefore);
  });

  it('keeps the released value until the save lands, then follows storage again', async () => {
    slide(140);
    await nextFrame();

    postFromPanel({ kind: PANEL_SHELL_MESSAGE.previewEnd });
    await flush();
    expect(live()).toBe(false);
    expect(fontSize()).toBe('140');

    // The panel saved on release; the stored value arrives the normal way.
    fireLegacy({ [StorageKeys.CHAT_FONT_SIZE]: 140 });
    await flush();
    fireLegacy({ [StorageKeys.CHAT_FONT_SIZE]: 125 });
    await flush();
    expect(fontSize()).toBe('125');
  });

  it('gives the page its stored value back when the panel closes mid-drag', async () => {
    slide(150);
    await nextFrame();
    expect(fontSize()).toBe('150');

    postFromPanel({ kind: PANEL_SHELL_MESSAGE.close });
    await flush();

    expect(panel()).toBeNull();
    expect(live()).toBe(false);
    expect(fontSize()).toBe('110');
  });

  it('gives the page its stored value back when the host removes the panel frame', async () => {
    slide(150);
    await nextFrame();

    panel()!.remove();
    await flush();

    expect(live()).toBe(false);
    expect(fontSize()).toBe('110');
    slide(90);
    await nextFrame();
    expect(fontSize()).toBe('110');
  });

  it('ends cleanly when the plugin unmounts mid-drag', async () => {
    slide(150);
    await nextFrame();

    fireLegacy({ [StorageKeys.CHAT_FONT_SIZE_ENABLED]: false });
    await flush();
    expect(fontSize()).toBeUndefined();
    postFromPanel({ kind: PANEL_SHELL_MESSAGE.close });
    await flush();

    fireLegacy({ [StorageKeys.CHAT_FONT_SIZE_ENABLED]: true });
    await flush();
    expect(fontSize()).toBe('110');
    expect(live()).toBe(false);
  });
});
