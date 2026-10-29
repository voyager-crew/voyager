import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { EXTENSION_VERSION } from '@/core/utils/version';

import { hostCatalogStorageKey } from '../../../remote/hostCatalogCache';
import { setPluginEnabled } from '../../../storage/pluginState';
import {
  COVERAGE,
  INITIAL_PLUGINS,
  ITEMS,
  PLUGINS,
  PROMPTS,
  composer,
  createHost,
  fixture,
  hasKey,
  lifecycle,
  openPanel,
  panels,
  pressPrompt,
  setupAcceptance,
  stopHost,
  storage,
  triggers,
  writeClipboard,
} from './acceptanceHarness';

vi.mock('webextension-polyfill', () => ({ default: globalThis.chrome }));
setupAcceptance();

describe('catalog Prompt Manager through PluginHost', () => {
  it.each(['chatgpt', 'claude'] as const)(
    '%s keeps old coverage, renders the existing library, inserts and copies without migrating data',
    async (site) => {
      fixture(site);
      const id = `voyager.${site}-prompt-manager`;
      storage.values.sync.set(COVERAGE, ['example.org', location.host]);
      // A stray plugin backup must not override the user's existing coverage choice.
      const state = { ...INITIAL_PLUGINS, [id]: { enabled: false, installedAt: 31 } };
      storage.values.local.set(PLUGINS, state);
      const originalItems = JSON.stringify(storage.values.local.get(ITEMS));
      const host = createHost();
      await host.start();
      const panel = await openPanel();
      expect(triggers()).toHaveLength(1);
      expect(panels()).toHaveLength(1);
      expect(document.getElementById('gv-pm-slash-root')).toBeNull();
      expect(panel.textContent).toContain('Review');
      pressPrompt();
      await vi.waitFor(() => expect(composer().textContent).toContain(PROMPTS[0].text));
      expect(writeClipboard).not.toHaveBeenCalled();

      await chrome.storage.sync.set({ [StorageKeys.PROMPT_INSERT_ON_CLICK]: false });
      pressPrompt();
      await vi.waitFor(() =>
        expect(writeClipboard).toHaveBeenCalledExactlyOnceWith(PROMPTS[0].text),
      );
      await setPluginEnabled(id, false, location.href);
      await vi.waitFor(() => expect(triggers()).toHaveLength(0));
      expect(storage.values.sync.get(COVERAGE)).toEqual(['example.org']);
      await setPluginEnabled(id, true, location.href);
      await openPanel();
      expect(storage.values.sync.get(COVERAGE)).toEqual(['example.org', location.host]);
      expect(JSON.stringify(storage.values.local.get(ITEMS))).toBe(originalItems);
      expect(storage.values.local.get(PLUGINS)).toEqual(state);
      expect(
        storage.writes.filter((write) => write.key === PLUGINS || write.key === ITEMS),
      ).toEqual([]);
      await stopHost(host);
    },
  );

  it('does not enable a page from a plugins backup and ignores local coverage writes', async () => {
    fixture('claude');
    const id = 'voyager.claude-prompt-manager';
    storage.values.local.set(PLUGINS, {
      ...INITIAL_PLUGINS,
      [id]: { enabled: true, installedAt: 1 },
    });
    const host = createHost();
    await host.start();
    expect(triggers()).toHaveLength(0);
    storage.external('local', COVERAGE, ['claude.ai']);
    await vi.advanceTimersByTimeAsync(500);
    expect(triggers()).toHaveLength(0);
    storage.external('sync', COVERAGE, ['claude.ai']);
    await openPanel();
    await chrome.storage.sync.remove(COVERAGE);
    await vi.waitFor(() => expect(panels()).toHaveLength(0));
    expect(storage.values.local.get(ITEMS)).toEqual(PROMPTS);
  });

  it('follows real coverage when page startup supplies a feed containing only visual settings', async () => {
    fixture('claude');
    storage.values.sync.set(COVERAGE, ['claude.ai']);
    const host = createHost({
      legacySettings: {
        load: async () => ({ [StorageKeys.GV_VISUAL_EFFECT]: 'off' }),
        subscribe: () => () => {},
      },
    });
    await host.start();
    await openPanel();
    storage.external('sync', COVERAGE, []);
    await vi.waitFor(() => expect(panels()).toHaveLength(0));
    storage.external('sync', COVERAGE, ['claude.ai']);
    await openPanel();
    expect(storage.values.local.get(PLUGINS)).toEqual(INITIAL_PLUGINS);
  });

  it('keeps alias-host switches independent and persists no plugin-state entry', async () => {
    const id = 'voyager.chatgpt-prompt-manager';
    fixture('chatgpt', 'https://chat.openai.com/u/0/c/first');
    storage.values.sync.set(COVERAGE, ['example.org', 'chatgpt.com']);
    const alias = createHost();
    await alias.start();
    expect(triggers()).toHaveLength(0);
    await setPluginEnabled(id, true, location.href);
    await openPanel();
    expect(storage.values.sync.get(COVERAGE)).toEqual([
      'example.org',
      'chatgpt.com',
      'chat.openai.com',
    ]);
    await setPluginEnabled(id, false, location.href);
    await vi.waitFor(() => expect(triggers()).toHaveLength(0));
    expect(storage.values.sync.get(COVERAGE)).toEqual(['example.org', 'chatgpt.com']);
    await stopHost(alias);
    fixture('chatgpt');
    const canonical = createHost();
    await canonical.start();
    await openPanel();
    expect(storage.values.local.get(PLUGINS)).toEqual(INITIAL_PLUGINS);
    expect(storage.writes.some((write) => write.key === PLUGINS)).toBe(false);
  });

  it('edits through the real library owner and reloads the same serialized record after a coverage round trip', async () => {
    fixture('claude');
    storage.values.sync.set(COVERAGE, ['claude.ai']);
    const host = createHost();
    await host.start();
    const panel = await openPanel();
    panel.querySelector<HTMLButtonElement>('.gv-pm-item .gv-pm-edit')!.click();
    const form = panel.querySelector<HTMLFormElement>('.gv-pm-add-form')!;
    form.querySelector<HTMLTextAreaElement>('.gv-pm-input-text')!.value = 'Revised prompt body';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const expected = [
      { ...PROMPTS[0], text: 'Revised prompt body', updatedAt: Date.now() },
      PROMPTS[1],
    ];
    await vi.waitFor(() => expect(storage.values.local.get(ITEMS)).toEqual(expected));
    const saved = JSON.stringify(storage.values.local.get(ITEMS));
    await setPluginEnabled('voyager.claude-prompt-manager', false, location.href);
    await vi.waitFor(() => expect(panels()).toHaveLength(0));
    await setPluginEnabled('voyager.claude-prompt-manager', true, location.href);
    await openPanel();
    pressPrompt();
    await vi.waitFor(() => expect(composer().textContent).toContain('Revised prompt body'));
    expect(JSON.stringify(storage.values.local.get(ITEMS))).toBe(saved);
    expect(storage.values.local.get(PLUGINS)).toEqual(INITIAL_PLUGINS);
  });

  it('keeps the panel usable after conversation and account-slot routes leave and return', async () => {
    const first = 'https://chatgpt.com/u/0/c/first';
    fixture('chatgpt', first);
    storage.values.sync.set(COVERAGE, ['chatgpt.com']);
    const host = createHost();
    await host.start();
    const panel = await openPanel();
    for (const path of ['/u/0/c/second', '/u/1/c/other-account', '/u/0/c/first']) {
      history.pushState({}, '', path);
      const previous = composer();
      const previousText = previous.textContent;
      const replacement = previous.cloneNode(false);
      previous.replaceWith(replacement);
      pressPrompt('Explain');
      document.querySelector<HTMLElement>('.gv-pm-slot')!.textContent = 'gravity';
      document.querySelector<HTMLButtonElement>('.gv-pm-fill .gv-pm-save')!.click();
      await vi.waitFor(() => expect(composer().textContent).toBe('Explain gravity.'));
      expect(previous.textContent).toBe(previousText);
      expect(triggers()).toHaveLength(1);
      expect(document.getElementById('gv-pm-panel')).toBe(panel);
    }
    expect(location.href).toBe(first);
    expect(storage.values.local.get(ITEMS)).toEqual(PROMPTS);
    expect(storage.values.sync.get(COVERAGE)).toEqual(['chatgpt.com']);
    expect(storage.values.local.get(PLUGINS)).toEqual(INITIAL_PLUGINS);
  });

  it('cancels a filled template when disabled, then lets a new session insert normally', async () => {
    fixture('claude');
    storage.values.sync.set(COVERAGE, ['claude.ai']);
    const host = createHost();
    await host.start();
    await openPanel();
    pressPrompt('Explain');
    document.querySelector<HTMLElement>('.gv-pm-slot')!.textContent = 'stale content';
    const previous = composer().textContent;
    await setPluginEnabled('voyager.claude-prompt-manager', false, location.href);
    await vi.waitFor(() => expect(document.querySelector('.gv-pm-fill')).toBeNull());
    await vi.advanceTimersByTimeAsync(500);
    expect(composer().textContent).toBe(previous);
    await setPluginEnabled('voyager.claude-prompt-manager', true, location.href);
    await openPanel();
    pressPrompt('Explain');
    document.querySelector<HTMLElement>('.gv-pm-slot')!.textContent = 'current content';
    document.querySelector<HTMLButtonElement>('.gv-pm-fill .gv-pm-save')!.click();
    await vi.waitFor(() => expect(composer().textContent).toContain('Explain current content.'));
  });

  it('renders the same library on two fresh pages and releases page effects after each stop', async () => {
    storage.values.sync.set(COVERAGE, ['claude.ai']);
    for (let page = 0; page < 2; page += 1) {
      fixture('claude');
      const hostNodes = new Set<EventTarget>(document.querySelectorAll('*'));
      const before = document.body.innerHTML;
      const host = createHost();
      await host.start();
      await openPanel();
      expect(document.querySelectorAll('.gv-pm-item')).toHaveLength(2);
      expect(document.querySelector<HTMLElement>('#gv-pm-trigger')?.style.right).toBe('70px');
      await stopHost(host);
      expect(document.body.innerHTML).toBe(before);
      expect(lifecycle.ledger.openListeners({ detachedHosts: hostNodes })).toEqual([]);
      expect(lifecycle.ledger.openObservers()).toEqual([]);
      expect(storage.listeners.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    }
  });
});

describe('bundled Prompt Manager after unusable online data', () => {
  it.each(['read-failed', 'missing', 'rejected'] as const)(
    '%s keeps the working bundled panel',
    async (failure) => {
      fixture('claude');
      storage.values.sync.set(COVERAGE, ['claude.ai']);
      const key = hostCatalogStorageKey('claude.ai');
      if (failure === 'read-failed') {
        const read = chrome.storage.local.get.bind(chrome.storage.local);
        vi.spyOn(chrome.storage.local, 'get').mockImplementation((async (
          keys: string | string[] | Record<string, unknown> | null,
          callback?: (values: Record<string, unknown>) => void,
        ) => {
          if (hasKey(keys, key)) throw new Error('catalog cache unavailable');
          const result = await read<Record<string, unknown>>(keys);
          callback?.(result);
          return result;
        }) as typeof chrome.storage.local.get);
      } else {
        storage.values.local.set(key, {
          host: 'claude.ai',
          status: failure === 'missing' ? 'missing' : 'ok',
          manifests: [
            {
              id: 'voyager.claude-prompt-manager',
              contributes: { domOps: [{ op: 'executeRemoteCode' }] },
            },
          ],
          site: { id: 'claude', matches: ['https://claude.ai/*'], selectors: 'invalid' },
          fetchedAt: 1,
          lastAttemptAt: 1,
          failureCount: 0,
          extensionVersion: EXTENSION_VERSION,
        });
      }
      const host = createHost();
      await host.start();
      await openPanel();
      pressPrompt();
      await vi.waitFor(() => expect(composer().textContent).toContain(PROMPTS[0].text));
      expect(triggers()).toHaveLength(1);
      expect(storage.values.local.get(ITEMS)).toEqual(PROMPTS);
      expect(storage.values.local.get(PLUGINS)).toEqual(INITIAL_PLUGINS);
    },
  );
});
