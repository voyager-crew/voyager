import { type Mock, describe, expect, it, vi } from 'vitest';

import { requireBundledSiteAdapter } from '../catalog/sites';
import { readTurnKey } from '../sends/trackUserSends';
import type { PluginManifest, PluginSource } from '../types';
import { PluginHost } from './PluginHost';
import {
  manifest,
  StaticSource,
  mockState,
  fireStateChange,
  flush,
} from './PluginHost.testHarness';

describe('PluginHost site override (plan §3)', () => {
  const semanticPlugin: PluginManifest = {
    ...manifest(['https://claude.ai/*'], 'voyager.semantic'),
    contributes: {
      domOps: [
        {
          op: 'addClass',
          target: { kind: 'semantic', key: 'userTurn' },
          className: 'gv-plugin-turn',
        },
      ],
    },
  };

  function overrideAdapter(userTurn: string, brandColor = '#101010') {
    return {
      catalogRevision: Number.MAX_SAFE_INTEGER,
      id: 'claude',
      label: 'Claude (remote)',
      matches: ['https://claude.ai/*'],
      selectors: { userTurn },
      theme: { hostSelector: ':root', lightSelector: ':root', darkSelector: ':root.dark' },
      brandColor,
      capabilities: new Set(['chat' as const]),
    };
  }

  it('resolves semantic selectors against the published site instead of the bundled adapter', async () => {
    document.body.innerHTML =
      '<div data-testid="user-message">bundled</div><div class="remote-turn">remote</div>';
    mockState({ 'voyager.semantic': { enabled: true, installedAt: 1 } });
    const source: PluginSource = {
      id: 'host-catalog',
      kind: 'remote',
      async list() {
        return [semanticPlugin];
      },
      async isAuthoritative() {
        return true;
      },
      async siteOverride() {
        return overrideAdapter('.remote-turn');
      },
    };
    const host = new PluginHost({
      url: 'https://claude.ai/chat/1',
      sources: [source],
      doc: document,
      requestCatalogRefresh: () => {},
      isTopFrame: true,
    });
    await host.start();
    expect(host.activeAdapter?.label).toBe('Claude (remote)');
    expect(document.querySelector('.remote-turn')?.classList.contains('gv-plugin-turn')).toBe(true);
    expect(
      document.querySelector('[data-testid="user-message"]')?.classList.contains('gv-plugin-turn'),
    ).toBe(false);
    host.stop();
    document.body.innerHTML = '';
  });

  it('rebuilds the engine when a catalog change swaps the site adapter', async () => {
    document.body.innerHTML = '<div class="first-turn"></div><div class="second-turn"></div>';
    mockState({ 'voyager.semantic': { enabled: true, installedAt: 1 } });
    let selector = '.first-turn';
    const source: PluginSource = {
      id: 'host-catalog',
      kind: 'remote',
      async list() {
        return [semanticPlugin];
      },
      async isAuthoritative() {
        return true;
      },
      async siteOverride() {
        return overrideAdapter(selector);
      },
    };
    const host = new PluginHost({
      url: 'https://claude.ai/chat/1',
      sources: [source],
      doc: document,
      requestCatalogRefresh: () => {},
      isTopFrame: true,
    });
    await host.start();
    expect(document.querySelector('.first-turn')?.classList.contains('gv-plugin-turn')).toBe(true);

    selector = '.second-turn';
    const listeners = (chrome.storage.onChanged.addListener as unknown as Mock).mock.calls;
    for (const [listener] of listeners) {
      listener(
        {
          'gvPluginHostCatalog:claude.ai': {
            oldValue: { status: 'ok', extensionVersion: 'x', manifests: [] },
            newValue: { status: 'ok', extensionVersion: 'x', manifests: [], site: { id: 'v2' } },
          },
        },
        'local',
      );
    }
    await flush();
    expect(document.querySelector('.first-turn')?.classList.contains('gv-plugin-turn')).toBe(false);
    expect(document.querySelector('.second-turn')?.classList.contains('gv-plugin-turn')).toBe(true);
    host.stop();
    expect(document.querySelector('.second-turn')?.classList.contains('gv-plugin-turn')).toBe(
      false,
    );
    document.body.innerHTML = '';
  });

  it('a catalog update cannot rename the send tracker’s existing turn identity', async () => {
    mockState({ 'voyager.semantic': { enabled: true, installedAt: 1 } });
    document.body.innerHTML =
      '<div class="turn" data-turn-key="kept" data-forged-first="wrong-first" data-forged-next="wrong-next">Kept question</div>';
    const bundled = requireBundledSiteAdapter('chatgpt');
    let turnKeyAttributes = ['data-forged-first'];
    const source: PluginSource = {
      id: 'host-catalog',
      kind: 'remote',
      list: async () => [{ ...semanticPlugin, matches: ['https://chatgpt.com/*'] }],
      isAuthoritative: async () => true,
      siteOverride: async () => ({
        ...bundled,
        catalogRevision: Number.MAX_SAFE_INTEGER,
        selectors: { ...bundled.selectors, userTurn: '.turn' },
        turnKeyAttributes,
      }),
    };
    const host = new PluginHost({
      url: 'https://chatgpt.com/c/conversation',
      sources: [source],
      doc: document,
      requestCatalogRefresh: () => {},
      isTopFrame: true,
    });
    await host.start();
    const turn = document.querySelector('.turn')!;
    expect(readTurnKey(turn, host.activeAdapter!.turnKeyAttributes!)).toBe('kept');
    expect(turn.classList.contains('gv-plugin-turn')).toBe(true);
    turnKeyAttributes = ['data-forged-next'];
    for (const [listener] of (chrome.storage.onChanged.addListener as unknown as Mock).mock.calls) {
      listener(
        {
          'gvPluginHostCatalog:chatgpt.com': {
            oldValue: { status: 'ok', extensionVersion: 'x', manifests: [] },
            newValue: { status: 'ok', extensionVersion: 'x', manifests: [], site: { id: 'v2' } },
          },
        },
        'local',
      );
    }
    await flush();
    expect(readTurnKey(turn, host.activeAdapter!.turnKeyAttributes!)).toBe('kept');
    expect(turn.classList.contains('gv-plugin-turn')).toBe(true);
    host.stop();
  });

  it('applies a site override written while the initial adapter read is in flight', async () => {
    document.body.innerHTML = '<div class="first-turn"></div><div class="second-turn"></div>';
    mockState({ 'voyager.semantic': { enabled: true, installedAt: 1 } });
    let selector = '.first-turn';
    let reads = 0;
    const source: PluginSource = {
      id: 'host-catalog',
      kind: 'remote',
      async list() {
        return [semanticPlugin];
      },
      async isAuthoritative() {
        return true;
      },
      async siteOverride() {
        const adapter = overrideAdapter(selector);
        if (reads++ === 0) {
          // The background refresh lands after this read started: the value
          // being returned is already stale when the engine is built from it.
          selector = '.second-turn';
          for (const [listener] of (chrome.storage.onChanged.addListener as unknown as Mock).mock
            .calls) {
            listener(
              {
                'gvPluginHostCatalog:claude.ai': {
                  oldValue: { status: 'ok', extensionVersion: 'x', manifests: [] },
                  newValue: {
                    status: 'ok',
                    extensionVersion: 'x',
                    manifests: [],
                    site: { id: 'v2' },
                  },
                },
              },
              'local',
            );
          }
        }
        return adapter;
      },
    };
    const host = new PluginHost({
      url: 'https://claude.ai/chat/1',
      sources: [source],
      doc: document,
      requestCatalogRefresh: () => {},
      isTopFrame: true,
    });
    await host.start();
    await flush();
    expect(document.querySelector('.second-turn')?.classList.contains('gv-plugin-turn')).toBe(true);
    expect(document.querySelector('.first-turn')?.classList.contains('gv-plugin-turn')).toBe(false);
    host.stop();
    document.body.innerHTML = '';
  });
});

describe('PluginHost with a local plugin on Gemini', () => {
  const geminiTweak: PluginManifest = {
    ...manifest(['https://gemini.google.com/*'], 'local.me.gemini-tweak'),
    contributes: {
      styles: [{ css: '.gv-plugin-local-tweak{outline:1px solid red}' }],
      domOps: [
        {
          op: 'addClass',
          target: { kind: 'semantic', key: 'userTurn' },
          className: 'gv-plugin-local-tweak',
        },
      ],
    },
  };

  it('mounts on Gemini through the native adapter, tears down on disable, and never asks for a catalog', async () => {
    document.body.innerHTML = '<user-query>hello</user-query>';
    mockState({ 'local.me.gemini-tweak': { enabled: true, installedAt: 1 } });
    const requestCatalogRefresh = vi.fn();
    const host = new PluginHost({
      url: 'https://gemini.google.com/app/abc',
      sources: [{ id: 'local', kind: 'local', list: async () => [geminiTweak] }],
      doc: document,
      requestCatalogRefresh,
      isTopFrame: true,
    });

    await host.start();
    expect(host.activeAdapter?.id).toBe('gemini');
    const turn = document.querySelector('user-query');
    expect(turn?.classList.contains('gv-plugin-local-tweak')).toBe(true);
    expect(document.documentElement.innerHTML).toContain('.gv-plugin-local-tweak{');
    // Zero-request promise: no catalog check and no catalog cache subscription.
    expect(requestCatalogRefresh).not.toHaveBeenCalled();

    fireStateChange({ 'local.me.gemini-tweak': { enabled: false, installedAt: 1 } });
    await flush();
    expect(turn?.classList.contains('gv-plugin-local-tweak')).toBe(false);
    expect(document.documentElement.innerHTML).not.toContain('.gv-plugin-local-tweak{');
    host.stop();
    document.body.innerHTML = '';
  });

  it('never mounts a plugin with a native op or a theme on a native surface, whatever its matches say', async () => {
    const nativeOp: PluginManifest = {
      ...manifest(['https://gemini.google.com/*'], 'voyager.native-on-gemini'),
      contributes: {
        domOps: [
          {
            op: 'addClass',
            target: { kind: 'css', selector: 'body' },
            className: 'gv-plugin-active',
          },
          // A primitive Gemini keeps closed (formula copy and Vim input are open there now).
          { op: 'native', handler: 'turnNavigator', params: {} },
        ],
      },
    };
    const themed: PluginManifest = {
      ...manifest(['https://gemini.google.com/*'], 'voyager.themed-on-gemini'),
      theme: { brand: '#ff0000' },
    };
    // A legal Claude-artifact pattern whose wildcard must stay in the hostname.
    const frameOnly: PluginManifest = {
      ...manifest(['https://*.frame.claudeusercontent.com/*'], 'local.me.frame'),
      contributes: { domOps: [{ op: 'native', handler: 'turnNavigator', params: {} }] },
    };
    const enabled = { enabled: true, installedAt: 1 };
    mockState({
      'voyager.native-on-gemini': enabled,
      'voyager.themed-on-gemini': enabled,
      'local.me.frame': enabled,
    });
    const host = new PluginHost({
      url: 'https://gemini.google.com/app/abc?x=.frame.claudeusercontent.com/',
      sources: [new StaticSource([nativeOp, themed, frameOnly])],
      doc: document,
      isTopFrame: true,
    });
    await host.start();
    expect(document.body.classList.contains('gv-plugin-active')).toBe(false);
    // Refused plugins stay listed as blocked; the frame-only one never covered this page.
    expect(host.getStatuses()).toEqual([
      {
        id: 'voyager.native-on-gemini',
        version: '1.0.0',
        kind: 'blocked',
        blockedReason: 'host-policy',
      },
      {
        id: 'voyager.themed-on-gemini',
        version: '1.0.0',
        kind: 'blocked',
        blockedReason: 'host-policy',
      },
    ]);
    host.stop();
  });

  it('never asks for a catalog from AI Studio either, whatever is enabled there', async () => {
    mockState({ 'voyager.test': { enabled: true, installedAt: 1 } });
    const requestCatalogRefresh = vi.fn();
    const host = new PluginHost({
      url: 'https://aistudio.google.com/prompts/new_chat',
      sources: [new StaticSource([manifest(['https://aistudio.google.com/*'])])],
      doc: document,
      requestCatalogRefresh,
      isTopFrame: true,
    });
    await host.start();
    expect(document.body.classList.contains('gv-plugin-active')).toBe(true);
    expect(requestCatalogRefresh).not.toHaveBeenCalled();
    host.stop();
  });
});
