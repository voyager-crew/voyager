import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import {
  COVERAGE,
  INITIAL_PLUGINS,
  ITEMS,
  PLUGINS,
  PROMPTS,
  createHost,
  fixture,
  holdRead,
  openPanel,
  panels,
  setupAcceptance,
  stopHost,
  storage,
  triggers,
} from './acceptanceHarness';

vi.mock('webextension-polyfill', () => ({ default: globalThis.chrome }));
setupAcceptance();

describe('Prompt Manager startup through PluginHost', () => {
  it('a newer coverage change wins over an old initial browser-storage reply', async () => {
    fixture('claude');
    storage.values.sync.set(COVERAGE, ['claude.ai']);
    const read = holdRead('sync', COVERAGE);
    const host = createHost();
    const starting = host.start();
    await read.seen;
    storage.external('sync', COVERAGE, []);
    read.release();
    await starting;
    await vi.advanceTimersByTimeAsync(500);
    expect(triggers()).toHaveLength(0);
    expect(panels()).toHaveLength(0);
    storage.external('sync', COVERAGE, ['claude.ai']);
    await openPanel();
  });

  it('switching off during panel startup leaves no late trigger or panel', async () => {
    fixture('claude');
    storage.values.sync.set(COVERAGE, ['claude.ai']);
    const read = holdRead('sync', StorageKeys.HIDE_PROMPT_MANAGER);
    const host = createHost();
    await host.start();
    await read.seen;
    storage.external('sync', COVERAGE, []);
    await vi.advanceTimersByTimeAsync(0);
    read.release();
    await vi.advanceTimersByTimeAsync(500);
    expect(triggers()).toHaveLength(0);
    expect(panels()).toHaveLength(0);
    expect(storage.values.local.get(ITEMS)).toEqual(PROMPTS);
    storage.external('sync', COVERAGE, ['claude.ai']);
    await openPanel();
    expect(triggers()).toHaveLength(1);
  });

  it('off and on during the same unfinished startup eventually leave one usable panel', async () => {
    fixture('chatgpt');
    storage.values.sync.set(COVERAGE, ['chatgpt.com']);
    const read = holdRead('sync', StorageKeys.HIDE_PROMPT_MANAGER);
    const host = createHost();
    await host.start();
    await read.seen;
    storage.external('sync', COVERAGE, []);
    await vi.advanceTimersByTimeAsync(0);
    storage.external('sync', COVERAGE, ['chatgpt.com']);
    await vi.advanceTimersByTimeAsync(0);
    read.release();
    await openPanel();
    await vi.advanceTimersByTimeAsync(500);
    expect(triggers()).toHaveLength(1);
    expect(panels()).toHaveLength(1);
    expect(storage.values.local.get(PLUGINS)).toEqual(INITIAL_PLUGINS);
  });

  it('a host stopped during startup cannot later recreate UI or storage subscriptions', async () => {
    fixture('claude');
    storage.values.sync.set(COVERAGE, ['claude.ai']);
    const read = holdRead('sync', StorageKeys.HIDE_PROMPT_MANAGER);
    const host = createHost();
    await host.start();
    await read.seen;
    host.stop();
    read.release();
    await stopHost(host);
    expect(storage.listeners.size).toBe(0);
    storage.external('sync', COVERAGE, []);
    storage.external('sync', COVERAGE, ['claude.ai']);
    await vi.advanceTimersByTimeAsync(500);
    expect(triggers()).toHaveLength(0);
    expect(panels()).toHaveLength(0);
    expect(storage.values.local.get(ITEMS)).toEqual(PROMPTS);
  });

  it('coverage changes that still include this host preserve an open panel and its draft', async () => {
    fixture('claude');
    storage.values.sync.set(COVERAGE, ['claude.ai']);
    const host = createHost();
    await host.start();
    const panel = await openPanel();
    panel.querySelector<HTMLButtonElement>('.gv-pm-add')!.click();
    const name = panel.querySelector<HTMLInputElement>('.gv-pm-input-name')!;
    name.value = 'Unsaved draft';
    storage.external('sync', COVERAGE, ['claude.ai', 'example.org']);
    await vi.advanceTimersByTimeAsync(500);
    expect(document.getElementById('gv-pm-panel')).toBe(panel);
    expect(name.value).toBe('Unsaved draft');
    expect(panel.classList.contains('gv-hidden')).toBe(false);
  });
});
