import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import {
  DEV_SETTINGS_REQUEST_SOURCE,
  DEV_SETTINGS_RESULT_SOURCE,
  startDevSettingsBridge,
} from '../devSettingsBridge';

const NOTIFY = StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED;

function postFromPage(data: Record<string, unknown>, source: Window | null = window): void {
  const event = new MessageEvent('message', { data });
  Object.defineProperty(event, 'source', { value: source });
  window.dispatchEvent(event);
}

describe('dev settings bridge', () => {
  let stop: () => void;
  let replies: Record<string, unknown>[];
  let postMessageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    replies = [];
    postMessageSpy = vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => {
      const reply = message as Record<string, unknown>;
      if (reply.source === DEV_SETTINGS_RESULT_SOURCE) replies.push(reply);
    });
    vi.mocked(chrome.storage.sync.set).mockResolvedValue(undefined);
    stop = startDevSettingsBridge();
  });

  afterEach(() => {
    stop();
    postMessageSpy.mockRestore();
  });

  it('turns a setting on from the page and confirms it', async () => {
    postFromPage({
      source: DEV_SETTINGS_REQUEST_SOURCE,
      id: 7,
      action: 'set',
      values: { [NOTIFY]: true },
    });

    await vi.waitFor(() =>
      expect(replies).toEqual([{ source: DEV_SETTINGS_RESULT_SOURCE, id: 7, ok: true }]),
    );
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({ [NOTIFY]: true });
  });

  it('reads settings back from the requested storage area', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({ [NOTIFY]: false } as never);

    postFromPage({
      source: DEV_SETTINGS_REQUEST_SOURCE,
      id: 1,
      action: 'get',
      area: 'local',
      keys: [NOTIFY],
    });

    await vi.waitFor(() =>
      expect(replies).toEqual([
        { source: DEV_SETTINGS_RESULT_SOURCE, id: 1, ok: true, values: { [NOTIFY]: false } },
      ]),
    );
  });

  it('deletes listed settings so a never-set setting can be reproduced', async () => {
    postFromPage({ source: DEV_SETTINGS_REQUEST_SOURCE, id: 3, action: 'remove', keys: [NOTIFY] });

    await vi.waitFor(() =>
      expect(replies).toEqual([{ source: DEV_SETTINGS_RESULT_SOURCE, id: 3, ok: true }]),
    );
    expect(chrome.storage.sync.remove).toHaveBeenCalledWith([NOTIFY]);
  });

  it('refuses a remove without a key list instead of clearing every setting', async () => {
    postFromPage({ source: DEV_SETTINGS_REQUEST_SOURCE, id: 4, action: 'remove' });

    await vi.waitFor(() => expect(replies).toMatchObject([{ id: 4, ok: false }]));
    expect(chrome.storage.sync.remove).not.toHaveBeenCalled();
  });

  it('refuses keys that are not Voyager settings and writes nothing', async () => {
    postFromPage({
      source: DEV_SETTINGS_REQUEST_SOURCE,
      id: 2,
      action: 'set',
      values: { [NOTIFY]: true, someOtherExtensionKey: 'x' },
    });

    await vi.waitFor(() =>
      expect(replies).toEqual([
        {
          source: DEV_SETTINGS_RESULT_SOURCE,
          id: 2,
          ok: false,
          error: 'unknown keys: someOtherExtensionKey',
        },
      ]),
    );
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });

  it("writes and reads a host's plugin catalog cache entry in local storage", async () => {
    const key = `${StorageKeys.PLUGIN_HOST_CATALOG_PREFIX}chat.deepseek.com`;
    const entry = { host: 'chat.deepseek.com', status: 'ok', manifests: [] };
    vi.mocked(chrome.storage.local.set).mockResolvedValue(undefined);
    vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({ [key]: entry } as never);

    postFromPage({
      source: DEV_SETTINGS_REQUEST_SOURCE,
      id: 5,
      action: 'set',
      area: 'local',
      values: { [key]: entry },
    });
    postFromPage({
      source: DEV_SETTINGS_REQUEST_SOURCE,
      id: 6,
      action: 'get',
      area: 'local',
      keys: [key],
    });

    await vi.waitFor(() =>
      expect(replies).toEqual([
        { source: DEV_SETTINGS_RESULT_SOURCE, id: 5, ok: true },
        { source: DEV_SETTINGS_RESULT_SOURCE, id: 6, ok: true, values: { [key]: entry } },
      ]),
    );
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ [key]: entry });
  });

  it.each([
    ['in sync storage', 'sync', 'chat.deepseek.com'],
    ['with a path after the host', 'local', 'chat.deepseek.com/x'],
    ['with a port', 'local', 'localhost:3000'],
    ['for a host that never has a catalog', 'local', 'gemini.google.com'],
  ])('refuses a plugin catalog key %s and writes nothing', async (_, area, host) => {
    const key = `${StorageKeys.PLUGIN_HOST_CATALOG_PREFIX}${host}`;
    postFromPage({
      source: DEV_SETTINGS_REQUEST_SOURCE,
      id: 8,
      action: 'set',
      area,
      values: { [key]: {} },
    });

    await vi.waitFor(() =>
      expect(replies).toEqual([
        { source: DEV_SETTINGS_RESULT_SOURCE, id: 8, ok: false, error: `unknown keys: ${key}` },
      ]),
    );
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('ignores messages from other windows', async () => {
    vi.mocked(chrome.storage.sync.get).mockResolvedValue({} as never);
    postFromPage(
      { source: DEV_SETTINGS_REQUEST_SOURCE, id: 3, action: 'set', values: { [NOTIFY]: true } },
      null,
    );
    postFromPage({ source: DEV_SETTINGS_REQUEST_SOURCE, id: 4, action: 'get', keys: [] });

    await vi.waitFor(() => expect(replies.map((reply) => reply.id)).toEqual([4]));
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });
});
