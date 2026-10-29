import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import type { createMainWorldRegistration } from '../mainWorldRegistration';
import { registerBackgroundSettingListeners } from '../registrationSettings';
import { createSiteAccessRegistration } from '../siteAccessRegistration';

/**
 * The browser's grants, with its meaning of a match pattern: `*.x` covers x
 * itself and every subdomain.
 */
const browserGrants = vi.hoisted(() => {
  const granted = new Set<string>();
  const covers = (grant: string, wanted: string): boolean => {
    const parse = (pattern: string) => /^(\*|https?):\/\/([^/]+)\//.exec(pattern);
    const [have, want] = [parse(grant), parse(wanted)];
    if (!have || !want) return grant === wanted;
    if (have[1] !== '*' && have[1] !== want[1]) return false;
    if (have[2] === want[2]) return true;
    if (!have[2].startsWith('*.')) return false;
    const host = want[2].replace(/^\*\./, '');
    return host === have[2].slice(2) || host.endsWith(have[2].slice(1));
  };
  return { granted, holds: (origin: string) => [...granted].some((g) => covers(g, origin)) };
});

vi.mock('webextension-polyfill', () => ({
  default: {
    permissions: {
      contains: vi.fn(async ({ origins }: { origins: string[] }) =>
        origins.every(browserGrants.holds),
      ),
    },
    tabs: { sendMessage: vi.fn(async () => undefined) },
  },
}));

// The plugins this build ships; no cached remote catalog or imported plugin.
vi.mock('@/features/plugins/sources/defaultSources', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/plugins/sources/defaultSources')>();
  const { BuiltinPluginSource } = await import('@/features/plugins/sources/BuiltinPluginSource');
  const { BundledCatalogPluginSource } =
    await import('@/features/plugins/sources/BundledCatalogPluginSource');
  return {
    ...actual,
    listPluginManifests: () =>
      actual.listPluginManifests([new BuiltinPluginSource(), new BundledCatalogPluginSource()]),
  };
});

const PLUGIN_SCRIPT = 'gv-plugin-content-script';

let pluginState: Record<string, unknown>;
let coverage: string[];
const registered = new Map<string, chrome.scripting.RegisteredContentScript>();
const storageListeners: ((changes: object, area: string) => void)[] = [];

const pluginPages = () => registered.get(PLUGIN_SCRIPT)?.matches ?? [];

/** The background as it starts: registrations from storage, then its listeners. */
async function startBackground() {
  const siteAccess = createSiteAccessRegistration();
  registerBackgroundSettingListeners({
    siteAccess,
    mainWorld: {
      registerFetchInterceptor: vi.fn(async () => {}),
      syncResponseCompleteObserverRegistration: vi.fn(async () => {}),
    } as unknown as ReturnType<typeof createMainWorldRegistration>,
  });
  await siteAccess.syncPlugins();
  return siteAccess;
}

/** The popup's write: the list changes in sync storage and the background hears of it. */
function writeCoverage(next: string[]): void {
  const oldValue = coverage;
  coverage = next;
  const changes = { [StorageKeys.PROMPT_CUSTOM_WEBSITES]: { oldValue, newValue: next } };
  for (const listener of storageListeners) listener(changes, 'sync');
}

/** Waits for every queued registration change, the listener's included. */
async function drain(siteAccess: ReturnType<typeof createSiteAccessRegistration>) {
  await siteAccess.syncCustom(coverage);
  await siteAccess.syncPlugins();
}

beforeEach(() => {
  browserGrants.granted.clear();
  registered.clear();
  storageListeners.length = 0;
  pluginState = {};
  coverage = [];
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test-extension-id',
      getURL: (path: string) => `chrome-extension://test-extension-id/${path}`,
      getManifest: (): Partial<chrome.runtime.Manifest> => ({
        manifest_version: 3,
        host_permissions: ['https://gemini.google.com/*'],
        content_scripts: [
          {
            matches: ['https://gemini.google.com/*'],
            js: ['src/pages/content/index.tsx'],
            run_at: 'document_idle',
          },
        ],
      }),
    },
    storage: {
      local: {
        get: vi.fn(async (defaults: object) => ({
          ...defaults,
          [StorageKeys.PLUGINS_STATE]: pluginState,
        })),
      },
      sync: {
        get: vi.fn(async (defaults: object) => ({
          ...defaults,
          [StorageKeys.PROMPT_CUSTOM_WEBSITES]: coverage,
        })),
      },
      onChanged: { addListener: (listener: never) => storageListeners.push(listener) },
    },
    permissions: { onAdded: { addListener: vi.fn() }, onRemoved: { addListener: vi.fn() } },
    scripting: {
      registerContentScripts: vi.fn(async (scripts: chrome.scripting.RegisteredContentScript[]) => {
        for (const script of scripts) {
          if (registered.has(script.id)) throw new Error(`Duplicate script ID '${script.id}'`);
          registered.set(script.id, script);
        }
      }),
      unregisterContentScripts: vi.fn(async ({ ids }: { ids: string[] }) => {
        for (const id of ids) registered.delete(id);
      }),
      getRegisteredContentScripts: vi.fn(async () => [...registered.values()]),
      executeScript: vi.fn(async () => []),
      insertCSS: vi.fn(async () => {}),
    },
    tabs: { query: vi.fn(async () => []) },
  });
});

describe('Prompt Manager on a supported site, through its coverage entry', () => {
  it.each([
    ['Claude', 'claude.ai', 'https://claude.ai/*'],
    ['DeepSeek', 'chat.deepseek.com', 'https://chat.deepseek.com/*'],
    ['Kimi', 'kimi.com', 'https://www.kimi.com/*'],
  ])(
    'runs on %s with every other plugin off, and stops when the entry goes',
    async (_, entry, page) => {
      // The page grant a plugin there asked for, the one Prompt Manager reuses.
      browserGrants.granted.add(page);
      await startBackground();
      expect(pluginPages()).not.toContain(page);

      writeCoverage([entry]);
      await vi.waitFor(() => expect(pluginPages()).toContain(page));

      writeCoverage([]);
      await vi.waitFor(() => expect(registered.has(PLUGIN_SCRIPT)).toBe(false));
    },
  );

  it('keeps the site while another plugin there is on', async () => {
    browserGrants.granted.add('https://claude.ai/*');
    pluginState = { 'voyager.claude-draft-save': { enabled: true, installedAt: 1 } };
    const background = await startBackground();
    writeCoverage(['claude.ai']);
    await drain(background);

    writeCoverage([]);
    await drain(background);

    expect(pluginPages()).toContain('https://claude.ai/*');
  });

  it('ignores a plugin-state entry its switch never writes', async () => {
    browserGrants.granted.add('https://claude.ai/*');
    // A restored plugins backup can carry one.
    pluginState = { 'voyager.claude-prompt-manager': { enabled: true, installedAt: 1 } };
    await startBackground();

    expect(registered.has(PLUGIN_SCRIPT)).toBe(false);
  });

  it('runs on an alias host only, as its entry covers only that host', async () => {
    browserGrants.granted.add('https://chatgpt.com/*');
    browserGrants.granted.add('https://chat.openai.com/*');
    pluginState = { 'voyager.chatgpt-folders': { enabled: false, installedAt: 1 } };
    coverage = ['chat.openai.com'];
    await startBackground();

    expect(pluginPages()).toEqual(['https://chat.openai.com/*']);
  });
});
