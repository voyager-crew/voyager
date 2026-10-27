/**
 * Packaged official plugins on Gemini: their on/off is the legacy setting
 * (never `gvPluginsState`), they never mount before that setting has been
 * read, and only after the content script admits them.
 *
 * The manifests here borrow the official ids but stay declarative, so the
 * host policy (which still refuses their native ops in this build) does not
 * hide what the switch and admission decide.
 */
import { type Mock, afterEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { OFFICIAL_PLUGIN_IDS } from '../sites/featureOwners';
import type { LegacySettingSnapshot } from '../storage/legacySettingBindings';
import type { PluginManifest, PluginSource } from '../types';
import { PluginHost } from './PluginHost';
import { DeclarativeEngine } from './declarativeEngine';
import type { LegacySettingsSource } from './legacySnapshotFeed';
import { type OfficialAdmissionController, createOfficialAdmission } from './officialAdmission';

const FORMULA_ID = OFFICIAL_PLUGIN_IDS.geminiFormulaCopy;
const HALO_ID = OFFICIAL_PLUGIN_IDS.geminiHideInputHalo;
const FORMULA_KEY = StorageKeys.FORMULA_COPY_ENABLED;
const HALO_KEY = StorageKeys.INPUT_HALO_HIDDEN;
const GEMINI_URL = 'https://gemini.google.com/app/abc';

function official(id: string, className: string): PluginManifest {
  return {
    id,
    name: 'Official',
    version: '1.0.0',
    description: 'd',
    author: 'Voyager',
    category: 'other',
    license: 'MIT',
    engine: '>=1.0.0',
    tier: 'declarative',
    matches: ['https://gemini.google.com/*'],
    contributes: {
      domOps: [{ op: 'addClass', target: { kind: 'css', selector: 'body' }, className }],
    },
  };
}

const formulaPlugin = official(FORMULA_ID, 'gv-official-formula');
const haloPlugin = official(HALO_ID, 'gv-official-halo');
const formulaMounted = (): boolean => document.body.classList.contains('gv-official-formula');
const haloMounted = (): boolean => document.body.classList.contains('gv-official-halo');
const LOCAL_ID = 'local.me.gemini-tweak';
const localPlugin: PluginManifest = {
  ...official(LOCAL_ID, 'gv-local-tweak'),
  author: 'me',
  contributes: {
    styles: [{ css: '.gv-local-tweak{outline:1px solid red}' }],
    domOps: [
      { op: 'addClass', target: { kind: 'css', selector: 'body' }, className: 'gv-local-tweak' },
    ],
  },
};
const localMounted = (): boolean => document.body.classList.contains('gv-local-tweak');

function source(plugins: readonly PluginManifest[]): PluginSource {
  return { id: 'static', list: async () => plugins };
}

function mockPluginState(state: Record<string, unknown>): void {
  (chrome.storage.local.get as unknown as Mock).mockResolvedValue({ gvPluginsState: state });
}

/** A legacy settings source whose initial read stays open until the test settles it. */
function deferredLegacy() {
  let resolveLoad: (snapshot: LegacySettingSnapshot) => void = () => {};
  let rejectLoad: (error: unknown) => void = () => {};
  const loaded = new Promise<LegacySettingSnapshot>((resolve, reject) => {
    resolveLoad = resolve;
    rejectLoad = reject;
  });
  let listener: ((changed: LegacySettingSnapshot) => void) | null = null;
  const load = vi.fn(() => loaded);
  const legacySettings: LegacySettingsSource = {
    load,
    subscribe(callback) {
      listener = callback;
      return () => {
        listener = null;
      };
    },
  };
  return {
    legacySettings,
    load,
    resolve: (snapshot: LegacySettingSnapshot) => resolveLoad(snapshot),
    reject: (error: unknown) => rejectLoad(error),
    fire: (changed: LegacySettingSnapshot) => listener?.(changed),
    isSubscribed: () => listener !== null,
  };
}

/** Like `deferredLegacy`, but every load() is its own read, settled by its index. */
function perLoadLegacy() {
  const reads: Array<(snapshot: LegacySettingSnapshot) => void> = [];
  const legacySettings: LegacySettingsSource = {
    load: () => new Promise((resolve) => reads.push(resolve)),
    subscribe: () => () => {},
  };
  return {
    legacySettings,
    loads: () => reads.length,
    resolve: (index: number, snapshot: LegacySettingSnapshot) => reads[index]?.(snapshot),
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
}

function geminiHost(
  plugins: readonly PluginManifest[],
  legacySettings: LegacySettingsSource,
  admission?: OfficialAdmissionController,
  extra: {
    requestCatalogRefresh?: (host: string) => void;
    url?: string;
    localPlugins?: readonly PluginManifest[];
  } = {},
): PluginHost {
  const local: PluginSource = {
    id: 'local',
    kind: 'local',
    list: async () => extra.localPlugins ?? [],
  };
  return new PluginHost({
    url: extra.url ?? GEMINI_URL,
    sources: [source(plugins), local],
    doc: document,
    admission,
    legacySettings,
    requestCatalogRefresh: extra.requestCatalogRefresh ?? (() => {}),
    isTopFrame: true,
  });
}

afterEach(() => {
  document.body.className = '';
  (chrome.storage.local.get as unknown as Mock).mockReset();
  (chrome.storage.onChanged.addListener as unknown as Mock).mockClear();
});

describe('PluginHost: official plugins bound to legacy switches', () => {
  it('mounts a default-on official plugin whose legacy key is missing once it is admitted', async () => {
    mockPluginState({});
    const legacy = deferredLegacy();
    const admission = createOfficialAdmission();
    const host = geminiHost([formulaPlugin], legacy.legacySettings, admission);

    const started = host.start();
    legacy.resolve({});
    await started;
    expect(formulaMounted()).toBe(false); // still pending

    admission.admit('gemini', 'formulaCopy');
    await flush();
    expect(formulaMounted()).toBe(true);
    host.stop();
  });

  it('never mounts while the legacy key is explicitly off, not even before it has been read', async () => {
    mockPluginState({ [FORMULA_ID]: { enabled: true, installedAt: 1 } });
    const legacy = deferredLegacy();
    const admission = createOfficialAdmission();
    admission.admit('gemini', 'formulaCopy');
    const host = geminiHost([formulaPlugin], legacy.legacySettings, admission);

    const started = host.start();
    await flush();
    expect(formulaMounted()).toBe(false); // read in flight: no guessed default

    legacy.resolve({ [FORMULA_KEY]: false });
    await started;
    await flush();
    expect(formulaMounted()).toBe(false);
    host.stop();
  });

  it('lets a plugin-state "enabled: true" turn on no bound plugin', async () => {
    mockPluginState({
      [FORMULA_ID]: { enabled: true, installedAt: 1 },
      [HALO_ID]: { enabled: true, installedAt: 1 },
    });
    const legacy = deferredLegacy();
    const admission = createOfficialAdmission();
    admission.admit('gemini', 'formulaCopy');
    admission.admit('gemini', 'hideInputHalo');
    const host = geminiHost([formulaPlugin, haloPlugin], legacy.legacySettings, admission);

    const started = host.start();
    legacy.resolve({ [FORMULA_KEY]: false }); // halo key missing: off by default
    await started;
    expect(formulaMounted()).toBe(false);
    expect(haloMounted()).toBe(false);
    host.stop();
  });

  it('lets a switch flipped on during the initial read win over the stale read', async () => {
    mockPluginState({});
    const legacy = deferredLegacy();
    const admission = createOfficialAdmission();
    admission.admit('gemini', 'hideInputHalo');
    const host = geminiHost([haloPlugin], legacy.legacySettings, admission);

    const started = host.start();
    await flush();
    legacy.fire({ [HALO_KEY]: true });
    legacy.resolve({ [HALO_KEY]: false });
    await started;
    await flush();
    expect(haloMounted()).toBe(true);
    host.stop();
  });

  it('lets a switch flipped off during the initial read win over the stale read', async () => {
    mockPluginState({});
    const legacy = deferredLegacy();
    const admission = createOfficialAdmission();
    admission.admit('gemini', 'formulaCopy');
    const host = geminiHost([formulaPlugin], legacy.legacySettings, admission);

    const started = host.start();
    await flush();
    legacy.fire({ [FORMULA_KEY]: false });
    legacy.resolve({}); // the read began before the write: missing, i.e. on
    await started;
    await flush();
    expect(formulaMounted()).toBe(false);
    host.stop();
  });

  it('treats a key removed during the initial read as missing, i.e. the default', async () => {
    mockPluginState({});
    const legacy = deferredLegacy();
    const admission = createOfficialAdmission();
    admission.admit('gemini', 'formulaCopy');
    const host = geminiHost([formulaPlugin], legacy.legacySettings, admission);

    const started = host.start();
    await flush();
    legacy.fire({ [FORMULA_KEY]: undefined });
    legacy.resolve({ [FORMULA_KEY]: false });
    await started;
    await flush();
    expect(formulaMounted()).toBe(true);
    host.stop();
  });

  it('follows the legacy switch live once mounted', async () => {
    mockPluginState({});
    const legacy = deferredLegacy();
    const admission = createOfficialAdmission();
    admission.admit('gemini', 'formulaCopy');
    const host = geminiHost([formulaPlugin], legacy.legacySettings, admission);

    const started = host.start();
    legacy.resolve({ [FORMULA_KEY]: true });
    await started;
    expect(formulaMounted()).toBe(true);

    legacy.fire({ [FORMULA_KEY]: false });
    await flush();
    expect(formulaMounted()).toBe(false);

    legacy.fire({ [FORMULA_KEY]: true });
    await flush();
    expect(formulaMounted()).toBe(true);
    host.stop();
  });

  it('does not restart a bound plugin when its plugin-state entry gains stray settings', async () => {
    mockPluginState({});
    const legacy = deferredLegacy();
    const admission = createOfficialAdmission();
    admission.admit('gemini', 'formulaCopy');
    const host = geminiHost([formulaPlugin], legacy.legacySettings, admission);
    const started = host.start();
    legacy.resolve({});
    await started;
    expect(formulaMounted()).toBe(true);

    const updateSettings = vi.spyOn(DeclarativeEngine.prototype, 'updateSettings');
    const unmount = vi.spyOn(DeclarativeEngine.prototype, 'unmount');
    const listeners = (chrome.storage.onChanged.addListener as unknown as Mock).mock.calls;
    for (const [listener] of listeners) {
      listener(
        {
          gvPluginsState: {
            newValue: { [FORMULA_ID]: { enabled: false, installedAt: 1, settings: { junk: 1 } } },
          },
        },
        'local',
      );
    }
    await flush();
    expect(formulaMounted()).toBe(true);
    expect(updateSettings).not.toHaveBeenCalled();
    expect(unmount).not.toHaveBeenCalled();
    updateSettings.mockRestore();
    unmount.mockRestore();
    host.stop();
  });

  it('keeps a pending plugin off, and once admission closes it is denied for good', async () => {
    mockPluginState({});
    const legacy = deferredLegacy();
    const admission = createOfficialAdmission();
    const host = geminiHost([formulaPlugin], legacy.legacySettings, admission);

    const started = host.start();
    legacy.resolve({});
    await started;
    expect(formulaMounted()).toBe(false);

    admission.close();
    admission.admit('gemini', 'formulaCopy'); // e.g. a continuation after teardown
    await flush();
    expect(admission.stateOf(FORMULA_ID)).toBe('denied');
    expect(formulaMounted()).toBe(false);
    host.stop();
  });

  it('mounts no official plugin without an admission from the content script', async () => {
    mockPluginState({});
    const legacy = deferredLegacy();
    const host = geminiHost([formulaPlugin], legacy.legacySettings);

    const started = host.start();
    legacy.resolve({ [FORMULA_KEY]: true });
    await started;
    await flush();
    expect(formulaMounted()).toBe(false);
    host.stop();
  });

  it('does not mount on a guessed default when the extension context is gone', async () => {
    mockPluginState({});
    const legacy = deferredLegacy();
    const admission = createOfficialAdmission();
    const host = geminiHost([formulaPlugin], legacy.legacySettings, admission);

    const started = host.start();
    legacy.reject(new Error('Extension context invalidated.'));
    await started;
    // A later reconcile (admission arriving) still has no snapshot to read.
    admission.admit('gemini', 'formulaCopy');
    await flush();
    expect(formulaMounted()).toBe(false);
    host.stop();
  });

  it('an enabled Gemini official plugin leaves its locator check to page startup', async () => {
    mockPluginState({ [FORMULA_ID]: { enabled: true, installedAt: 1 } });
    const legacy = deferredLegacy();
    const admission = createOfficialAdmission();
    admission.admit('gemini', 'formulaCopy');
    const requestCatalogRefresh = vi.fn();
    const host = geminiHost([formulaPlugin], legacy.legacySettings, admission, {
      requestCatalogRefresh,
    });

    const started = host.start();
    legacy.resolve({});
    await started;
    await flush();
    expect(formulaMounted()).toBe(true);
    expect(requestCatalogRefresh).toHaveBeenCalledTimes(0);
    host.stop();
  });

  it('follows the shared legacy settings feed off Gemini / AI Studio without blocking startup', async () => {
    mockPluginState({});
    const legacy = deferredLegacy();
    const host = geminiHost([], legacy.legacySettings, createOfficialAdmission(), {
      url: 'https://claude.ai/chat/1',
    });
    await host.start();
    expect(legacy.load).toHaveBeenCalledOnce();
    expect(legacy.isSubscribed()).toBe(true);
    host.stop();
  });

  it('stops following the legacy switch and admission after stop()', async () => {
    mockPluginState({});
    const legacy = deferredLegacy();
    const admission = createOfficialAdmission();
    const host = geminiHost([formulaPlugin], legacy.legacySettings, admission);

    const started = host.start();
    legacy.resolve({});
    await started;
    host.stop();
    expect(legacy.isSubscribed()).toBe(false);

    admission.admit('gemini', 'formulaCopy');
    await flush();
    expect(formulaMounted()).toBe(false);
  });
});

describe('PluginHost: the legacy read runs beside start-up', () => {
  it('mounts an enabled local plugin while the legacy read is pending, and the bound plugin once it lands', async () => {
    mockPluginState({ [LOCAL_ID]: { enabled: true, installedAt: 1 } });
    const legacy = deferredLegacy();
    const admission = createOfficialAdmission();
    admission.admit('gemini', 'formulaCopy');
    const host = geminiHost([formulaPlugin], legacy.legacySettings, admission, {
      localPlugins: [localPlugin],
    });

    await host.start(); // must not wait on the legacy read
    expect(localMounted()).toBe(true);
    expect(document.documentElement.innerHTML).toContain('.gv-local-tweak{');
    expect(formulaMounted()).toBe(false);

    legacy.resolve({});
    await flush();
    expect(formulaMounted()).toBe(true);
    expect(localMounted()).toBe(true);
    host.stop();
  });

  it('lets a legacy read from before stop()/start() land without mounting anything', async () => {
    mockPluginState({});
    const legacy = perLoadLegacy();
    const admission = createOfficialAdmission();
    admission.admit('gemini', 'formulaCopy');
    const host = geminiHost([formulaPlugin], legacy.legacySettings, admission);
    const mount = vi.spyOn(DeclarativeEngine.prototype, 'mount');

    await host.start();
    host.stop();
    await host.start();
    expect(legacy.loads()).toBe(2);

    legacy.resolve(0, { [FORMULA_KEY]: true });
    await flush();
    expect(mount).not.toHaveBeenCalled();
    expect(formulaMounted()).toBe(false);

    legacy.resolve(1, {});
    await flush();
    expect(formulaMounted()).toBe(true);
    mount.mockRestore();
    host.stop();
  });

  it('mounts local plugins but no bound plugin when the legacy read fails with a gone context', async () => {
    mockPluginState({ [LOCAL_ID]: { enabled: true, installedAt: 1 } });
    const legacy = deferredLegacy();
    const admission = createOfficialAdmission();
    admission.admit('gemini', 'formulaCopy');
    const host = geminiHost([formulaPlugin], legacy.legacySettings, admission, {
      localPlugins: [localPlugin],
    });

    const started = host.start();
    legacy.reject(new Error('Extension context invalidated.'));
    await started;
    await flush();
    expect(localMounted()).toBe(true);
    expect(formulaMounted()).toBe(false);
    host.stop();
  });
});

describe('PluginHost: a Gemini shared rail inherits the native start point', () => {
  const ID = 'local.me.shared-rail';
  const shared: PluginManifest = {
    ...official(ID, 'gv-local-shared-rail'),
    engine: '>=1.9.0',
    contributes: {
      domOps: [
        {
          op: 'addClass',
          target: { kind: 'css', selector: 'body' },
          className: 'gv-local-shared-rail',
        },
        { op: 'native', handler: 'turnNavigator', params: { dataBackend: 'shared' } },
      ],
    },
  };
  const sharedMounted = () => document.body.classList.contains('gv-local-shared-rail');

  it('waits while ordinary local CSS runs, then mounts using its own switch with the official master off', async () => {
    mockPluginState({
      [ID]: { enabled: true, installedAt: 1 },
      [LOCAL_ID]: { enabled: true, installedAt: 1 },
    });
    const legacy = deferredLegacy();
    const admission = createOfficialAdmission();
    const host = geminiHost([], legacy.legacySettings, admission, {
      localPlugins: [shared, localPlugin],
    });
    await host.start();
    expect(localMounted()).toBe(true);
    expect(sharedMounted()).toBe(false);
    expect(host.getStatuses().find((entry) => entry.id === ID)).toMatchObject({
      kind: 'blocked',
      blockedReason: 'pending',
      blockedBy: OFFICIAL_PLUGIN_IDS.geminiTimeline,
    });
    legacy.resolve({ [StorageKeys.GV_TIMELINE_ENABLED]: false });
    await flush();
    expect(sharedMounted()).toBe(false);
    admission.admit('gemini', 'timeline');
    await flush();
    expect(sharedMounted()).toBe(true);
    expect(localMounted()).toBe(true);
    legacy.fire({ [StorageKeys.GV_TIMELINE_ENABLED]: false });
    await flush();
    expect(sharedMounted()).toBe(true);
    host.stop();
    expect(sharedMounted()).toBe(false);
  });

  it('a denied native entry blocks the shared consumer for good without blocking ordinary local CSS', async () => {
    mockPluginState({
      [ID]: { enabled: true, installedAt: 1 },
      [LOCAL_ID]: { enabled: true, installedAt: 1 },
    });
    const legacy = deferredLegacy();
    const admission = createOfficialAdmission();
    const host = geminiHost([], legacy.legacySettings, admission, {
      localPlugins: [shared, localPlugin],
    });
    await host.start();
    legacy.resolve({ [StorageKeys.GV_TIMELINE_ENABLED]: false });
    admission.close();
    admission.admit('gemini', 'timeline');
    await flush();
    expect(sharedMounted()).toBe(false);
    expect(host.getStatuses().find((entry) => entry.id === ID)).toMatchObject({
      kind: 'blocked',
      blockedReason: 'host-policy',
    });
    expect(localMounted()).toBe(true);
    host.stop();
  });
});
