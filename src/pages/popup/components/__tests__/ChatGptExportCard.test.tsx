import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUILTIN_PLUGINS } from '@/features/plugins/builtin';
import {
  CHATGPT_EXPORT_OPEN_MESSAGE,
  CHATGPT_EXPORT_PLUGIN_ID,
} from '@/features/plugins/builtin/chatgptExport/openMessage';
import type { PluginManifest } from '@/features/plugins/types';
import type { TranslationKey } from '@/utils/translations';

import { ChatGptExportCard, type ChatGptExportCardProps } from '../ChatGptExportCard';
import { PluginSiteSettings } from '../PluginSiteSettings';

const mocks = vi.hoisted(() => ({
  permissionContains: vi.fn(),
  permissionRequest: vi.fn(),
  runtimeSendMessage: vi.fn(),
  tabsSendMessage: vi.fn(),
  setPluginEnabled: vi.fn(),
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    permissions: { contains: mocks.permissionContains, request: mocks.permissionRequest },
    runtime: { sendMessage: mocks.runtimeSendMessage },
    tabs: { sendMessage: mocks.tabsSendMessage },
  },
}));

vi.mock('@/core/utils/browser', () => ({
  isFirefox: () => false,
  supportsDynamicContentScriptRegistration: () => true,
  supportsOptionalHostPermissions: () => true,
}));

vi.mock('@/features/plugins/storage/pluginState', () => ({
  setPluginEnabled: mocks.setPluginEnabled,
}));

// The plugin list has its own suite; here it only needs to stay out of the way.
vi.mock('../PluginManager', () => ({ PluginManager: () => null }));
vi.mock('../PromptDataTransfer', () => ({ PromptDataTransfer: () => null }));

const t = (key: TranslationKey): string => key;
const CHATGPT_URL = 'https://chatgpt.com/c/abc';

function exportPlugin(): PluginManifest {
  const plugin = BUILTIN_PLUGINS.find((candidate) => candidate.id === CHATGPT_EXPORT_PLUGIN_ID);
  if (!plugin) throw new Error('Expected the ChatGPT export builtin plugin.');
  return plugin;
}

let container: HTMLElement;
let root: Root;

async function flush(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderCard(props: Partial<ChatGptExportCardProps> = {}): Promise<void> {
  await act(async () => {
    root.render(
      React.createElement(ChatGptExportCard, {
        plugin: exportPlugin(),
        enabled: false,
        activeTabId: 7,
        activeUrl: CHATGPT_URL,
        t,
        ...props,
      }),
    );
  });
}

function button(): HTMLButtonElement {
  const element = container.querySelector<HTMLButtonElement>(
    '[data-testid="chatgpt-export-card"] button',
  );
  if (!element) throw new Error('Expected the export card button.');
  return element;
}

async function click(): Promise<void> {
  await act(async () => {
    button().click();
  });
  await flush();
}

function statusText(): string | null {
  return container.querySelector('[role="status"]')?.textContent ?? null;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.permissionContains.mockResolvedValue(true);
  mocks.permissionRequest.mockResolvedValue(true);
  mocks.runtimeSendMessage.mockResolvedValue({ ok: true });
  mocks.setPluginEnabled.mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ChatGptExportCard', () => {
  it('offers to turn export on while the plugin is off', async () => {
    await renderCard({ enabled: false });

    expect(button().textContent).toBe('chatgptExportTurnOn');
    expect(container.textContent).toContain('chatgptExportCardOffHint');
  });

  it('turns the exporter on through the shared site-access flow', async () => {
    mocks.permissionContains.mockResolvedValue(false);
    await renderCard({ enabled: false });

    await click();

    expect(mocks.permissionRequest).toHaveBeenCalledWith({
      origins: expect.arrayContaining(['https://chatgpt.com/*']),
    });
    expect(mocks.setPluginEnabled).toHaveBeenCalledWith(CHATGPT_EXPORT_PLUGIN_ID, true);
    expect(mocks.setPluginEnabled).not.toHaveBeenCalledWith(CHATGPT_EXPORT_PLUGIN_ID, false);
    expect(mocks.tabsSendMessage).not.toHaveBeenCalled();
  });

  it('explains a denied site permission and leaves the exporter off', async () => {
    mocks.permissionContains.mockResolvedValue(false);
    mocks.permissionRequest.mockResolvedValue(false);
    await renderCard({ enabled: false });

    await click();

    expect(mocks.setPluginEnabled).toHaveBeenLastCalledWith(CHATGPT_EXPORT_PLUGIN_ID, false);
    expect(statusText()).toBe('pluginPermissionDenied');
  });

  it('offers to turn export on again when it is enabled without site access', async () => {
    mocks.permissionContains.mockResolvedValue(false);
    await renderCard({ enabled: true });
    await flush();
    expect(button().textContent).toBe('chatgptExportTurnOn');

    await click();

    expect(mocks.permissionRequest).toHaveBeenCalledOnce();
    expect(mocks.tabsSendMessage).not.toHaveBeenCalled();
    expect(button().textContent).toBe('pm_export');
  });

  it("opens the tab's export dialog in the top frame and reports it", async () => {
    const onOpened = vi.fn();
    mocks.tabsSendMessage.mockResolvedValue({ ok: true });
    await renderCard({ enabled: true, onOpened });
    expect(button().textContent).toBe('pm_export');

    await click();

    expect(mocks.tabsSendMessage).toHaveBeenCalledWith(
      7,
      { type: CHATGPT_EXPORT_OPEN_MESSAGE },
      { frameId: 0 },
    );
    expect(onOpened).toHaveBeenCalledOnce();
    expect(statusText()).toBeNull();
  });

  it('asks for a conversation when the page has nothing to export', async () => {
    const onOpened = vi.fn();
    mocks.tabsSendMessage.mockResolvedValue({ ok: false, reason: 'no-conversation' });
    await renderCard({ enabled: true, onOpened });

    await click();

    expect(onOpened).not.toHaveBeenCalled();
    expect(statusText()).toBe('chatgptExportNoConversation');
  });

  it('asks for a reload when no exporter answers in the tab', async () => {
    mocks.tabsSendMessage.mockRejectedValue(new Error('Receiving end does not exist.'));
    await renderCard({ enabled: true });

    await click();

    expect(statusText()).toBe('chatgptExportReloadTab');
  });
});

describe('PluginSiteSettings export entry', () => {
  async function renderSiteSettings(manifests: readonly PluginManifest[]): Promise<void> {
    await act(async () => {
      root.render(
        React.createElement(PluginSiteSettings, {
          promptSwitch: null,
          promptDataTransfer: {} as never,
          plugins: { manifests, activeUrl: CHATGPT_URL },
          exportEntry: { enabled: false, activeTabId: 7 },
          t,
        }),
      );
    });
  }

  it('shows the export card on a site whose plugins include the ChatGPT exporter', async () => {
    await renderSiteSettings([exportPlugin()]);

    expect(container.querySelector('[data-testid="chatgpt-export-card"]')).not.toBeNull();
  });

  it('shows no export card on other plugin sites', async () => {
    const otherPlugin = BUILTIN_PLUGINS.find((plugin) => plugin.id === 'voyager.claude-timeline');
    await renderSiteSettings(otherPlugin ? [otherPlugin] : []);

    expect(container.querySelector('[data-testid="chatgpt-export-card"]')).toBeNull();
  });
});
