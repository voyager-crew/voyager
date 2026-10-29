import { act } from 'react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { CHATGPT_LOCAL_BRIDGE_PLUGIN_ID } from '@/features/plugins/builtin/chatgptLocalBridge/manifest';
import { hostCatalogStorageKey } from '@/features/plugins/remote/hostCatalogCache';
import { PLUGIN_CATALOG_REFRESH_MESSAGE } from '@/features/plugins/runtime/messages';

import { container, en, extensionApi, local, mount, sync } from './popupHarness';

const HOST = 'chatgpt.com';
const CATALOG_KEY = hostCatalogStorageKey(HOST);
const MANUAL_CHECK = { type: PLUGIN_CATALOG_REFRESH_MESSAGE, payload: { host: HOST, force: true } };

type StorageListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  area: string,
) => void;

/** Tell the popup's live storage listeners what the background just wrote. */
function emitLocalChange(changes: Record<string, chrome.storage.StorageChange>): void {
  const { addListener, removeListener } = extensionApi.storage.onChanged;
  const removed = new Set(removeListener.mock.calls.map(([listener]) => listener));
  for (const [listener] of addListener.mock.calls as [StorageListener][]) {
    if (!removed.has(listener)) listener(changes, 'local');
  }
}

/**
 * The background as the popup sees it: a manual check stays open until `finish`, then
 * writes chatgpt.com's catalog like the refresher does, and the bridge rules come with it.
 */
function fakeBackground() {
  let renewed = false;
  let release = (): void => {};
  extensionApi.runtime.sendMessage.mockImplementation(async (message: { type?: string }) => {
    if (message?.type === 'gv.bridge.status') {
      return {
        ok: true,
        data: {
          permission: true,
          paired: { serverId: 'abcdef0123456789', port: 47321, pairedAt: 1 },
          server: 'online',
          policy: renewed ? 'allowed' : 'stale',
          onlineUpdatesEnabled: sync[StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED] !== false,
          activeTasks: [],
        },
      };
    }
    if (message?.type !== PLUGIN_CATALOG_REFRESH_MESSAGE) return undefined;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    const oldValue = local[CATALOG_KEY];
    const newValue = {
      host: HOST,
      status: 'ok',
      manifests: [],
      fetchedAt: Date.now(),
      lastAttemptAt: Date.now(),
      failureCount: 0,
      extensionVersion: '1.8.3',
    };
    local[CATALOG_KEY] = newValue;
    renewed = true;
    emitLocalChange({ [CATALOG_KEY]: { oldValue, newValue } });
    return { ok: true, status: 'unchanged' };
  });
  return {
    finish: async (): Promise<void> => {
      await act(async () => release());
    },
  };
}

function manualCheck(): HTMLButtonElement {
  const buttons = container.querySelectorAll<HTMLButtonElement>(
    `button[aria-label="${en.pluginsRefresh}"]`,
  );
  // One manual check per card: the row's button replaces the card header's.
  expect(buttons).toHaveLength(1);
  return buttons[0];
}

describe('the online updates row on a ChatGPT tab', () => {
  beforeEach(() => {
    // The bridge card's status poll stays still, so only a catalog write can re-ask it.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    extensionApi.tabs.query.mockResolvedValue([{ id: 10, url: `https://${HOST}/c/abc` }]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([false, true])(
    'checks now with automatic updates %s, busy until the background answers',
    async (online) => {
      sync[StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED] = online;
      const background = fakeBackground();
      await mount();
      const toggle = container.querySelector<HTMLInputElement>(
        `input[aria-label="${en.pluginsOnlineUpdates}"]`,
      );
      expect(toggle?.checked).toBe(online);
      const button = manualCheck();
      expect(button.disabled).toBe(false);

      await act(async () => button.click());

      expect(extensionApi.runtime.sendMessage).toHaveBeenCalledWith(MANUAL_CHECK);
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('aria-busy')).toBe('true');

      await background.finish();

      expect(button.disabled).toBe(false);
      expect(button.getAttribute('aria-busy')).toBe('false');
    },
  );

  it('renews stale bridge rules from the same click without turning on online updates', async () => {
    sync[StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED] = false;
    local[StorageKeys.PLUGINS_STATE] = {
      [CHATGPT_LOCAL_BRIDGE_PLUGIN_ID]: { enabled: true, installedAt: 1 },
    };
    const background = fakeBackground();
    await mount();
    const bridgeCard = () => container.querySelector('[data-testid="chatgpt-bridge-card"]');
    expect(bridgeCard()?.textContent).toContain(en.bridgePolicyNeedsUpdates);

    await act(async () => manualCheck().click());
    await background.finish();

    expect(bridgeCard()?.textContent).not.toContain(en.bridgePolicyNeedsUpdates);
    expect(bridgeCard()?.textContent).not.toContain(en.bridgePolicyStale);
    expect(sync[StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]).toBe(false);
    expect(extensionApi.runtime.sendMessage).not.toHaveBeenCalledWith({
      type: 'gv.bridge.enableRefresh',
    });
  });
});
