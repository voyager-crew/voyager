// @vitest-environment jsdom
import { act } from 'react';

import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { PANEL_MESSAGE } from '@/features/panel/protocol';
import { importLocalPlugin } from '@/features/plugins/local/localPluginImport';

import {
  GEMINI,
  click,
  en,
  extensionApi,
  flush,
  local,
  mount,
  query,
  tab,
  updateContext,
} from './panelHarness';

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./panelBrowserApi')).extensionApi,
}));

const ID = 'local.me.compact';
const PLUGIN = {
  id: 'me.compact',
  name: 'Compact turns',
  version: '1.0.0',
  description: 'Tighter spacing between my messages',
  author: 'me',
  category: 'readability',
  license: 'MIT',
  engine: '>=1.0.0',
  tier: 'declarative',
  matches: ['https://gemini.google.com/*'],
  contributes: { styles: [{ css: '.gv-plugin-compact{margin-block:4px}' }] },
};
const reply = (patch: Record<string, unknown> = {}) =>
  JSON.stringify({ ...PLUGIN, ...patch }, null, 2);

const button = (label: string) =>
  Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === label,
  ) ?? null;
const stored = () =>
  (
    local[StorageKeys.PLUGIN_LOCAL_MANIFESTS] as Record<string, { manifest: { version: string } }>
  )?.[ID];
const enabled = () =>
  (local[StorageKeys.PLUGINS_STATE] as Record<string, { enabled?: boolean }> | undefined)?.[ID]
    ?.enabled;

/** The page holds `text` as the user's pick until the panel fetches it, once. */
function pageHolds(text: string): void {
  let held: string | null = text;
  extensionApi.runtime.sendMessage.mockImplementation(
    async (message: { type?: string; payload?: { request?: { type?: string } } }) => {
      if (message?.type !== PANEL_MESSAGE.tabRequest) return undefined;
      if (message.payload?.request?.type !== 'gv.create.pending')
        return { ok: true, response: undefined };
      const candidate = held ? { text: held, siteId: 'gemini' } : null;
      held = null;
      return { ok: true, response: { candidate } };
    },
  );
}

/** Installs through the real import, as the popup or another panel would. */
async function importElsewhere(patch: Record<string, unknown>): Promise<void> {
  const result = await importLocalPlugin({ ...PLUGIN, ...patch });
  expect(result.ok).toBe(true);
}

const review = () => query('[data-testid="create-review"]');

describe('reviewing a reply picked on the page', () => {
  it('opens the Create tab on the pick and installs exactly it, turned on', async () => {
    pageHolds(reply());
    await mount({ ...GEMINI, creationRequest: 1 });

    expect(tab('create').getAttribute('aria-selected')).toBe('true');
    expect(review()?.textContent).toContain('Compact turns');
    expect(stored()).toBeUndefined();

    await click(button(en.panelCreateInstall));
    expect(stored()?.manifest.version).toBe('1.0.0');
    expect(enabled()).toBe(true);
    expect(review()?.textContent).toContain('Compact turns is on.');
  });

  it('stays out of the way when the page holds no pick', async () => {
    pageHolds('');
    await mount({ ...GEMINI, creationRequest: 3 });
    expect(tab('features').getAttribute('aria-selected')).toBe('true');
    expect(review()).toBeNull();
  });

  it('follows a pick made while the panel is already open', async () => {
    pageHolds(reply());
    await mount(GEMINI);
    expect(review()).toBeNull();

    await updateContext({ ...GEMINI, creationRequest: 1 });
    expect(tab('create').getAttribute('aria-selected')).toBe('true');
    expect(review()?.textContent).toContain(en.panelCreateInstall);
  });

  it('writes nothing over an install that changed after the review, and reviews it again', async () => {
    await importElsewhere({});
    pageHolds(reply({ version: '2.0.0' }));
    await mount({ ...GEMINI, creationRequest: 1 });
    expect(button(en.panelCreateUpdate)).not.toBeNull();

    await importElsewhere({ version: '3.0.0' });
    await click(button(en.panelCreateUpdate));

    expect(stored()?.manifest.version).toBe('3.0.0');
    expect(enabled()).not.toBe(true);
    expect(review()?.textContent).toContain(en.localPluginChangedSinceReview);
  });

  it('lands an update disabled first, then enables only that version', async () => {
    await importElsewhere({});
    pageHolds(reply({ version: '2.0.0' }));
    await mount({ ...GEMINI, creationRequest: 1 });
    const writes: { version?: string; enabled?: boolean }[] = [];
    const set = extensionApi.storage.local.set.getMockImplementation()!;
    extensionApi.storage.local.set.mockImplementation(
      (updates: Record<string, unknown>, callback?: unknown) => {
        const manifests = updates[StorageKeys.PLUGIN_LOCAL_MANIFESTS] as
          | Record<string, { manifest: { version: string } }>
          | undefined;
        const state = updates[StorageKeys.PLUGINS_STATE] as
          | Record<string, { enabled?: boolean }>
          | undefined;
        writes.push({ version: manifests?.[ID]?.manifest.version, enabled: state?.[ID]?.enabled });
        return set(updates, callback);
      },
    );

    await click(button(en.panelCreateUpdate));

    expect(writes).toEqual([
      { version: '2.0.0', enabled: false },
      { version: undefined, enabled: true },
    ]);
    expect(stored()?.manifest.version).toBe('2.0.0');
  });

  it('keeps a version imported between the install and the enable switched off', async () => {
    pageHolds(reply());
    await mount({ ...GEMINI, creationRequest: 1 });
    const set = extensionApi.storage.local.set.getMockImplementation()!;
    let raced = false;
    extensionApi.storage.local.set.mockImplementation(
      async (updates: Record<string, unknown>, callback?: unknown) => {
        await set(updates, callback);
        if (raced || !(StorageKeys.PLUGIN_LOCAL_MANIFESTS in updates)) return;
        raced = true;
        // Another popup re-imports the plugin right after this panel's import.
        const manifests = local[StorageKeys.PLUGIN_LOCAL_MANIFESTS] as Record<
          string,
          { manifest: object }
        >;
        local[StorageKeys.PLUGIN_LOCAL_MANIFESTS] = {
          ...manifests,
          [ID]: { ...manifests[ID], manifest: { ...manifests[ID].manifest, version: '3.0.0' } },
        };
      },
    );

    await click(button(en.panelCreateInstall));

    expect(stored()?.manifest.version).toBe('3.0.0');
    expect(enabled()).not.toBe(true);
    expect(review()?.textContent).toContain(en.localPluginChangedSinceReview);
  });

  it('shows the problems of a refused reply and installs nothing', async () => {
    pageHolds(reply({ name: '' }));
    await mount({ ...GEMINI, creationRequest: 1 });

    expect(review()?.textContent).toContain(en.localPluginsRejected);
    expect(button(en.panelCreateInstall)).toBeNull();
    expect(stored()).toBeUndefined();
  });
});

/** The page as the user picks on it: each pick replaces the held one, and a fetch takes it. */
function pagePicks() {
  let held: string | null = null;
  let answerGate: Promise<void> | null = null;
  extensionApi.runtime.sendMessage.mockImplementation(
    async (message: { type?: string; payload?: { request?: { type?: string } } }) => {
      if (message?.type !== PANEL_MESSAGE.tabRequest) return undefined;
      if (message.payload?.request?.type !== 'gv.create.pending')
        return { ok: true, response: undefined };
      const candidate = held ? { text: held, siteId: 'gemini' } : null;
      held = null;
      const gate = answerGate;
      answerGate = null;
      await gate;
      return { ok: true, response: { candidate } };
    },
  );
  return {
    pick(text: string) {
      held = text;
    },
    /** The next fetch takes the pick at once but answers only on release. */
    delayNextAnswer(): () => void {
      let release = () => {};
      answerGate = new Promise((resolve) => (release = resolve));
      return release;
    },
  };
}

const FIRST = reply({ name: 'First pick' });
const SECOND = reply({ name: 'Second pick', version: '2.0.0' });

describe('a newer pick while the review is busy', () => {
  it('reviews the newer pick made while the earlier one was still being fetched', async () => {
    const page = pagePicks();
    page.pick(FIRST);
    const release = page.delayNextAnswer();
    await mount({ ...GEMINI, creationRequest: 1 });

    page.pick(SECOND);
    await updateContext({ ...GEMINI, creationRequest: 2 });
    await act(async () => {
      release();
      await flush();
    });

    expect(review()?.textContent).toContain('Second pick');
    expect(review()?.textContent).not.toContain('First pick');
    await click(button(en.panelCreateInstall));
    expect(stored()?.manifest.version).toBe('2.0.0');
  });

  it('reviews a pick made during an install once the install finished', async () => {
    const page = pagePicks();
    page.pick(FIRST);
    await mount({ ...GEMINI, creationRequest: 1 });
    const set = extensionApi.storage.local.set.getMockImplementation()!;
    let release = () => {};
    const writing = new Promise<void>((resolve) => (release = resolve));
    extensionApi.storage.local.set.mockImplementation(
      async (updates: Record<string, unknown>, callback?: unknown) => {
        if (StorageKeys.PLUGIN_LOCAL_MANIFESTS in updates) await writing;
        return set(updates, callback);
      },
    );

    await click(button(en.panelCreateInstall));
    page.pick(SECOND);
    await updateContext({ ...GEMINI, creationRequest: 2 });
    await act(async () => {
      release();
      await flush();
      await flush();
    });

    expect(stored()?.manifest.version).toBe('1.0.0');
    expect(review()?.textContent).toContain('Second pick');
    expect(button(en.panelCreateUpdate)).not.toBeNull();
  });
});
