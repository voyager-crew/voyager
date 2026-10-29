import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { type Mock, afterEach, beforeEach, vi } from 'vitest';

import type { PluginStateEntry } from '@/features/plugins/storage/pluginState';
import type { PluginManifest } from '@/features/plugins/types';

import { PluginCatalogControls, usePluginCatalog } from '../PluginCatalogControls';
import { PluginIdentity, usePluginSite } from '../PluginIdentity';
import { PluginManager, type PluginManagerProps } from '../PluginManager';
import { PluginSettings } from '../PluginSettings';
import { usePluginPreferences } from '../usePluginPreferences';

// Mock external effects once for the owner suites and Manager integration.
// Seen-version storage remains real so badge assertions verify persistence.
const {
  setPluginEnabled,
  setPluginSetting,
  setPluginSettings,
  permissionContains,
  permissionRequest,
  runtimeSendMessage,
  permissionOrigins,
  pluginState,
  PLUGIN_ID,
  mockLanguage,
  mockMessages,
  supportsDynamicRegistration,
} = vi.hoisted(() => ({
  setPluginEnabled: vi.fn().mockResolvedValue(undefined),
  setPluginSetting: vi.fn().mockResolvedValue(undefined),
  setPluginSettings: vi.fn().mockResolvedValue(undefined),
  permissionContains: vi.fn().mockResolvedValue(false),
  permissionRequest: vi.fn().mockResolvedValue(true),
  runtimeSendMessage: vi.fn().mockResolvedValue({ ok: true }),
  permissionOrigins: vi.fn().mockReturnValue([]),
  pluginState: { current: {} as Record<string, PluginStateEntry> },
  PLUGIN_ID: 'voyager.test-width',
  mockLanguage: { current: 'en' },
  // Translations resolve to their key by default (so assertions stay readable);
  // a test that exercises a placeholder loads the real English template here.
  mockMessages: { current: {} as Record<string, string> },
  supportsDynamicRegistration: vi.fn(() => true),
}));

export {
  setPluginEnabled,
  setPluginSetting,
  setPluginSettings,
  permissionContains,
  permissionRequest,
  runtimeSendMessage,
  permissionOrigins,
  pluginState,
  PLUGIN_ID,
  mockLanguage,
  mockMessages,
  supportsDynamicRegistration,
};

vi.mock('webextension-polyfill', () => ({
  default: {
    permissions: {
      contains: permissionContains,
      request: permissionRequest,
    },
    runtime: {
      sendMessage: runtimeSendMessage,
    },
  },
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    language: mockLanguage.current,
    setLanguage: vi.fn(),
    t: (key: string) => mockMessages.current[key] ?? key,
  }),
}));

vi.mock('@/core/utils/browser', () => ({
  isFirefox: () => false,
  supportsDynamicContentScriptRegistration: () => supportsDynamicRegistration(),
  supportsOptionalHostPermissions: () => true,
}));

vi.mock('@/features/plugins/runtime/siteRegistration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/plugins/runtime/siteRegistration')>()),
  pluginToOriginPatternsForActiveUrl: permissionOrigins,
}));

// The seen-version helpers are deliberately NOT mocked: the "Updated" badge is
// only meaningful if it round-trips through the real chrome.storage.local key,
// so the tests assert that write directly.
vi.mock('@/features/plugins/storage/pluginState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/plugins/storage/pluginState')>();
  return {
    ...actual,
    setPluginSetting,
    setPluginSettings,
    setPluginEnabled,
    setPluginCollapsed: vi.fn().mockResolvedValue(undefined),
    loadCollapsedPlugins: vi.fn().mockResolvedValue([]),
    loadPluginState: vi.fn().mockImplementation(async () => pluginState.current),
    subscribePluginState: vi.fn().mockReturnValue(() => {}),
  };
});

export const widthPlugin: PluginManifest = {
  id: PLUGIN_ID,
  name: 'Test · Width',
  version: '1.0.0',
  description: 'Adjustable width',
  i18n: {
    zh: {
      name: '测试 · 宽度',
      description: '可调节宽度',
      settings: {
        width: {
          label: '阅读宽度（px）',
          minLabel: '更窄',
          maxLabel: '更宽',
        },
      },
    },
  },
  author: 'Test',
  category: 'readability',
  license: 'MIT',
  engine: '>=1.0.0',
  tier: 'declarative',
  matches: ['https://claude.ai/*'],
  contributes: {
    settings: {
      width: {
        type: 'number',
        label: 'Reading width (px)',
        minLabel: 'Narrower',
        maxLabel: 'Wider',
        default: 768,
        min: 600,
        max: 1600,
      },
    },
  },
};

export const compactTimelinePlugin: PluginManifest = {
  ...widthPlugin,
  name: 'Claude · Timeline',
  description: 'Timeline with two visual styles',
  i18n: {
    zh: {
      settings: { compactView: { label: '使用紧凑索引' } },
    },
  },
  contributes: {
    settings: {
      compactView: {
        type: 'boolean',
        label: 'Use compact timeline',
        default: false,
      },
    },
  },
};

export let container: HTMLElement;
export let root: Root;

export function nativeSetSliderValue(input: HTMLInputElement, value: number): void {
  // Bypass React's value tracker so the synthetic onChange fires.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, String(value));
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Let queued storage reads (plugin state, catalog settings, catalog cache) settle. */
export async function flushEffects(rounds = 4): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

export async function render(plugin: PluginManifest = widthPlugin): Promise<void> {
  await act(async () => {
    root.render(React.createElement(PluginManager, { manifests: [plugin] }));
  });
  // Let the async state hydration (loadPluginState) resolve so the plugin shows
  // as enabled and its settings slider is rendered.
  await act(async () => {
    await Promise.resolve();
  });
}

export async function renderManager(props: Partial<PluginManagerProps> = {}): Promise<void> {
  await act(async () => {
    root.render(React.createElement(PluginManager, { manifests: [widthPlugin], ...props }));
  });
  await flushEffects();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  mockLanguage.current = 'en';
  mockMessages.current = {};
  (chrome.storage.sync.get as unknown as Mock).mockReset().mockResolvedValue({});
  (chrome.storage.sync.set as unknown as Mock).mockReset().mockResolvedValue(undefined);
  (chrome.storage.local.get as unknown as Mock).mockReset().mockResolvedValue({});
  (chrome.storage.local.set as unknown as Mock).mockReset().mockResolvedValue(undefined);
  (chrome.storage.onChanged.addListener as unknown as Mock).mockReset();
  (chrome.storage.onChanged.removeListener as unknown as Mock).mockReset();
  pluginState.current = { [PLUGIN_ID]: { enabled: true, installedAt: 0 } };
  setPluginEnabled.mockClear();
  setPluginSetting.mockClear();
  setPluginSettings.mockClear();
  permissionContains.mockReset().mockResolvedValue(false);
  permissionRequest.mockReset().mockResolvedValue(true);
  runtimeSendMessage.mockReset().mockResolvedValue({ ok: true });
  permissionOrigins.mockReset().mockReturnValue([]);
  supportsDynamicRegistration.mockReset().mockReturnValue(true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  // Some tests unmount mid-body to exercise the flush-on-close path; unmounting
  // again here is a no-op but guard it so React doesn't warn.
  try {
    act(() => root.unmount());
  } catch {
    /* already unmounted */
  }
  container.remove();
  vi.useRealTimers();
});

export function resetRoot(): void {
  root = createRoot(container);
}

function SettingsSubject({ plugin }: { plugin: PluginManifest }) {
  const preferences = usePluginPreferences();
  return (
    <PluginSettings
      plugin={plugin}
      values={preferences.settingsMap[plugin.id]}
      handleSetting={preferences.handleSetting}
      handleImmediateSettings={preferences.handleImmediateSettings}
    />
  );
}

export async function renderSettings(plugin: PluginManifest = widthPlugin): Promise<void> {
  await act(async () => root.render(<SettingsSubject plugin={plugin} />));
  await flushEffects();
}

type IdentityFixtureProps = Partial<
  Pick<PluginManagerProps, 'manifests' | 'sourceIds' | 'blockedUpdates' | 'activeUrl'>
>;

function IdentitySubject({
  manifests = [widthPlugin],
  sourceIds,
  blockedUpdates,
  activeUrl,
}: IdentityFixtureProps) {
  const plugin = manifests[0];
  const { collapsed, toggleCollapsed } = usePluginPreferences();
  const { currentSiteId } = usePluginSite(activeUrl);
  return (
    <PluginIdentity
      plugin={plugin}
      isOpen={!collapsed.has(plugin.id)}
      onCollapse={() => toggleCollapsed(plugin.id)}
      isUpdated={false}
      sourceId={sourceIds?.[plugin.id]}
      blockedUpdate={blockedUpdates?.[plugin.id]}
      activeUrl={activeUrl}
      currentSiteId={currentSiteId}
    />
  );
}

export async function renderIdentity(props: IdentityFixtureProps = {}): Promise<void> {
  await act(async () => root.render(<IdentitySubject {...props} />));
  await flushEffects();
}

export async function renderPluginIdentity(plugin: PluginManifest = widthPlugin): Promise<void> {
  await renderIdentity({ manifests: [plugin] });
}

type CatalogFixtureProps = Pick<PluginManagerProps, 'catalogHost' | 'refreshing'>;

function CatalogSubject({ catalogHost, refreshing = false }: CatalogFixtureProps) {
  const catalog = usePluginCatalog(catalogHost, refreshing);
  return <PluginCatalogControls catalogHost={catalogHost} {...catalog} />;
}

export async function renderCatalog(props: CatalogFixtureProps = {}): Promise<void> {
  await act(async () => root.render(<CatalogSubject {...props} />));
  await flushEffects();
}
