import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { EXTENSION_VERSION } from '@/core/utils/version';

import inputLocators from '../../../catalog/sites/claude/selector-data/input.json';
import placementLocators from '../../../catalog/sites/claude/selector-data/placement.json';
import site from '../../../catalog/sites/claude/site.json';
import { hostCatalogStorageKey } from '../../../remote/hostCatalogCache';
import { createDefaultPluginSources } from '../../../sources/defaultSources';
import type { PluginManifest } from '../../../types';
import {
  COVERAGE,
  INITIAL_PLUGINS,
  ITEMS,
  PLUGINS,
  PROMPTS,
  createHost,
  composer,
  fixture,
  holdRead,
  openPanel,
  pressPrompt,
  setupAcceptance,
  stopHost,
  storage,
  triggers,
} from './acceptanceHarness';

vi.mock('webextension-polyfill', () => ({ default: globalThis.chrome }));
setupAcceptance();

const marker: PluginManifest = {
  id: 'test.catalog-code',
  name: 'Catalog code marker',
  version: '1.0.0',
  description: 'Observe the code-block selector after catalog reloads.',
  author: 'test',
  category: 'other',
  license: 'MIT',
  engine: '>=1.0.0',
  tier: 'declarative',
  matches: site.matches,
  contributes: {
    domOps: [
      {
        op: 'addClass',
        target: { kind: 'semantic', key: 'codeBlock' },
        className: 'gv-test-catalog-code',
      },
    ],
  },
};

function publish({
  selectors = {},
  revision = 1,
  revoked = [],
  locators = {},
}: {
  readonly selectors?: Readonly<Record<string, string>>;
  readonly revision?: number;
  readonly revoked?: string[];
  readonly locators?: Readonly<Record<string, string[]>>;
}): void {
  storage.external('local', hostCatalogStorageKey('claude.ai'), {
    host: 'claude.ai',
    status: 'ok',
    extensionVersion: EXTENSION_VERSION,
    fetchedAt: revision,
    lastAttemptAt: revision,
    failureCount: 0,
    manifests: [],
    revoked,
    site: {
      ...site,
      catalogRevision: Number.MAX_SAFE_INTEGER - 10 + revision,
      selectors: { ...site.selectors, ...selectors },
      locators,
    },
  });
}

describe('Prompt Manager across catalog adapter reloads', () => {
  it('keeps an open panel and unsaved prompt when only an unrelated selector changes', async () => {
    fixture('claude');
    storage.values.sync.set(COVERAGE, ['claude.ai']);
    publish({ selectors: { codeBlock: 'pre' }, revision: 0 });
    storage.values.local.set(PLUGINS, {
      ...INITIAL_PLUGINS,
      [marker.id]: { enabled: true, installedAt: 1 },
    });
    const oldCode = document.querySelector('pre')!;
    const nextCode = document.createElement('div');
    nextCode.className = 'updated-code';
    document.body.appendChild(nextCode);
    const host = createHost({
      sources: [...createDefaultPluginSources(), { id: 'marker', list: async () => [marker] }],
    });
    await host.start();
    const panel = await openPanel();
    panel.querySelector<HTMLButtonElement>('.gv-pm-add')!.click();
    panel.querySelector<HTMLInputElement>('.gv-pm-input-name')!.value = 'Voyager 测试 draft';
    panel.querySelector<HTMLTextAreaElement>('.gv-pm-input-text')!.value = 'Unsaved prompt body';
    expect(oldCode.classList.contains('gv-test-catalog-code')).toBe(true);
    expect(nextCode.classList.contains('gv-test-catalog-code')).toBe(false);

    publish({ selectors: { codeBlock: '.updated-code' } });
    // Another plugin must still remount against the updated adapter.
    await vi.waitFor(() => expect(nextCode.classList.contains('gv-test-catalog-code')).toBe(true));
    expect(oldCode.classList.contains('gv-test-catalog-code')).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    const currentPanel = document.getElementById('gv-pm-panel')!;
    expect(currentPanel.classList.contains('gv-hidden')).toBe(false);
    expect(currentPanel.querySelector<HTMLInputElement>('.gv-pm-input-name')!.value).toBe(
      'Voyager 测试 draft',
    );
    expect(currentPanel.querySelector<HTMLTextAreaElement>('.gv-pm-input-text')!.value).toBe(
      'Unsaved prompt body',
    );
    expect(currentPanel).toBe(panel);
    expect(storage.values.local.get(ITEMS)).toEqual(PROMPTS);
    storage.external('sync', COVERAGE, []);
    await vi.waitFor(() => expect(document.getElementById('gv-pm-panel')).toBeNull());
    storage.external('sync', COVERAGE, ['claude.ai']);
    const fresh = await openPanel();
    expect(fresh).not.toBe(panel);
    expect(fresh.querySelector<HTMLInputElement>('.gv-pm-input-name')!.value).toBe('');
    await stopHost(host);
    expect(storage.listeners.size).toBe(0);
  });

  it('restarts cleanly when the composer selector changes', async () => {
    fixture('claude');
    storage.values.sync.set(COVERAGE, ['claude.ai']);
    const host = createHost();
    await host.start();
    const panel = await openPanel();
    panel.querySelector<HTMLButtonElement>('.gv-pm-add')!.click();
    panel.querySelector<HTMLInputElement>('.gv-pm-input-name')!.value = 'Old composer draft';

    publish({ selectors: { composer: `${site.selectors.composer}, .updated-composer` } });
    await vi.waitFor(() => {
      const current = document.getElementById('gv-pm-panel');
      expect(current).not.toBeNull();
      expect(current).not.toBe(panel);
      expect(current!.classList.contains('gv-hidden')).toBe(true);
    });
    const current = await openPanel();
    expect(current.querySelector<HTMLInputElement>('.gv-pm-input-name')!.value).toBe('');
    expect(panel.isConnected).toBe(false);
    pressPrompt();
    await vi.waitFor(() => expect(composer().textContent).toContain(PROMPTS[0].text));
    expect(triggers()).toHaveLength(1);
    await stopHost(host);
    expect(storage.listeners.size).toBe(0);
  });

  it('keeps an unsaved draft when the first catalog supplies unchanged input defaults', async () => {
    fixture('claude');
    storage.values.sync.set(COVERAGE, ['claude.ai']);
    const host = createHost();
    await host.start();
    const panel = await openPanel();
    panel.querySelector<HTMLButtonElement>('.gv-pm-add')!.click();
    panel.querySelector<HTMLInputElement>('.gv-pm-input-name')!.value =
      'Draft before first catalog';
    panel.querySelector<HTMLTextAreaElement>('.gv-pm-input-text')!.value = 'Still being written';

    publish({
      selectors: { codeBlock: '.updated-code' },
      locators: { ...inputLocators, ...placementLocators },
    });
    await vi.waitFor(() => expect(host.activeAdapter?.selectors.codeBlock).toBe('.updated-code'));
    await vi.advanceTimersByTimeAsync(500);
    const current = document.getElementById('gv-pm-panel')!;
    expect(current.querySelector<HTMLInputElement>('.gv-pm-input-name')!.value).toBe(
      'Draft before first catalog',
    );
    expect(current.querySelector<HTMLTextAreaElement>('.gv-pm-input-text')!.value).toBe(
      'Still being written',
    );
    expect(current.classList.contains('gv-hidden')).toBe(false);
    expect(current).toBe(panel);
    await stopHost(host);
    expect(storage.listeners.size).toBe(0);
  });

  it('keeps an unsaved draft when only Research Pack handoff locators change', async () => {
    fixture('claude');
    storage.values.sync.set(COVERAGE, ['claude.ai']);
    const locators = { ...inputLocators, ...placementLocators };
    publish({ locators, revision: 0 });
    const host = createHost();
    await host.start();
    const panel = await openPanel();
    panel.querySelector<HTMLButtonElement>('.gv-pm-add')!.click();
    panel.querySelector<HTMLInputElement>('.gv-pm-input-name')!.value = 'Keep this unsaved draft';
    panel.querySelector<HTMLTextAreaElement>('.gv-pm-input-text')!.value =
      'Unrelated to Research Pack';

    publish({ locators: { ...locators, 'input.handoff': ['.research-editor'] } });
    await vi.waitFor(() =>
      expect(host.activeAdapter?.locators?.['input.handoff']).toEqual(['.research-editor']),
    );
    await vi.advanceTimersByTimeAsync(500);
    const current = document.getElementById('gv-pm-panel')!;
    expect(current.querySelector<HTMLInputElement>('.gv-pm-input-name')!.value).toBe(
      'Keep this unsaved draft',
    );
    expect(current.querySelector<HTMLTextAreaElement>('.gv-pm-input-text')!.value).toBe(
      'Unrelated to Research Pack',
    );
    expect(current.classList.contains('gv-hidden')).toBe(false);
    expect(current).toBe(panel);
    await stopHost(host);
    expect(storage.listeners.size).toBe(0);
  });

  it('stops a retained panel when the catalog revokes its plugin', async () => {
    fixture('claude');
    storage.values.sync.set(COVERAGE, ['claude.ai']);
    const host = createHost();
    await host.start();
    const panel = await openPanel();
    publish({ selectors: { codeBlock: '.updated-code' } });
    await vi.waitFor(() => expect(host.activeAdapter?.selectors.codeBlock).toBe('.updated-code'));
    publish({
      selectors: { codeBlock: '.updated-code' },
      revision: 2,
      revoked: ['voyager.claude-prompt-manager'],
    });
    await vi.waitFor(() => expect(triggers()).toHaveLength(0));
    expect(panel.isConnected).toBe(false);
    expect(storage.values.sync.get(COVERAGE)).toEqual(['claude.ai']);
    expect(storage.values.local.get(ITEMS)).toEqual(PROMPTS);
    await stopHost(host);
    expect(storage.listeners.size).toBe(0);
  });

  it('keeps ownership of an unfinished start through an unrelated adapter reload', async () => {
    fixture('claude');
    storage.values.sync.set(COVERAGE, ['claude.ai']);
    const read = holdRead('sync', StorageKeys.HIDE_PROMPT_MANAGER);
    const host = createHost();
    await host.start();
    await read.seen;
    publish({ selectors: { codeBlock: '.updated-code' } });
    await vi.waitFor(() => expect(host.activeAdapter?.selectors.codeBlock).toBe('.updated-code'));
    read.release();
    await openPanel();
    expect(triggers()).toHaveLength(1);
    await stopHost(host);
    expect(storage.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['input.candidates', 'input.fab'])(
    'restarts for an %s update without restarting other plugins',
    async (key) => {
      fixture('claude');
      storage.values.sync.set(COVERAGE, ['claude.ai']);
      storage.values.local.set(PLUGINS, {
        ...INITIAL_PLUGINS,
        'voyager.claude-composer-counter': { enabled: true, installedAt: 1 },
      });
      const host = createHost();
      await host.start();
      const panel = await openPanel();
      const badge = document.querySelector('.gv-counter-badge-composer');
      expect(badge).not.toBeNull();
      panel.querySelector<HTMLButtonElement>('.gv-pm-add')!.click();
      panel.querySelector<HTMLInputElement>('.gv-pm-input-name')!.value = 'Old placement draft';

      publish({ locators: { [key]: ['.updated-input-target'] } });
      await vi.waitFor(() => {
        const current = document.getElementById('gv-pm-panel');
        expect(current).not.toBeNull();
        expect(current).not.toBe(panel);
        expect(current!.classList.contains('gv-hidden')).toBe(true);
      });
      const current = await openPanel();
      expect(current.querySelector<HTMLInputElement>('.gv-pm-input-name')!.value).toBe('');
      expect(document.querySelector('.gv-counter-badge-composer')).toBe(badge);
      await stopHost(host);
      expect(badge!.isConnected).toBe(false);
      expect(storage.listeners.size).toBe(0);
    },
  );
});
