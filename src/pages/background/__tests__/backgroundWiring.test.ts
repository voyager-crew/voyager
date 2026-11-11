import { afterEach, describe, expect, it, vi } from 'vitest';

import { SAFARI_NATIVE_APP_ID } from '@/core/utils/safariNativeClipboard';
import {
  PLUGIN_CATALOG_REFRESH_MESSAGE,
  PLUGIN_CONTENT_SCRIPT_SYNC_MESSAGE,
} from '@/features/plugins/runtime/messages';

// The real background owners run; only browser I/O is replaced. The polyfill reads the
// current global so each started background sees its own stubbed browser.
vi.mock('webextension-polyfill', () => ({
  default: new Proxy({}, { get: (_target, key) => Reflect.get(chrome, key) }),
}));

type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => boolean | undefined;

const CHATGPT_CATALOG_URL = 'https://voyager.nagi.fun/catalog/hosts/chatgpt.com.json';
const PLUGIN_SCRIPT_ID = 'gv-plugin-content-script';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function startBackground(target: 'chrome' | 'safari') {
  vi.resetModules();
  vi.stubEnv('VOYAGER_BUILD_TARGET', target);
  vi.stubEnv('VOYAGER_DEV_AUTO_RELOAD', '');
  const read = async (keys: unknown) =>
    keys && typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
  const event = () => ({ addListener: vi.fn(), removeListener: vi.fn() });
  let listener: MessageListener | undefined;
  const scripting = {
    getRegisteredContentScripts: vi.fn(async () => [] as Array<{ id: string }>),
    registerContentScripts: vi.fn(async () => {}),
    unregisterContentScripts: vi.fn(async () => {}),
    executeScript: vi.fn(async () => []),
  };
  const connectNative = vi.fn(() => ({ onMessage: event(), onDisconnect: event() }));
  const catalogFetch = vi.fn<typeof fetch>(async () => new Response('', { status: 404 }));
  vi.stubGlobal('fetch', catalogFetch);
  vi.stubGlobal('chrome', {
    ...chrome,
    runtime: {
      ...chrome.runtime,
      getManifest: () => ({
        permissions: [],
        host_permissions: [],
        content_scripts: [{ matches: [], js: ['content.js'] }],
      }),
      connectNative,
      onMessage: {
        addListener: (callback: MessageListener) => {
          listener = callback;
        },
      },
      onInstalled: event(),
      onStartup: event(),
    },
    storage: {
      ...chrome.storage,
      local: { ...chrome.storage.local, get: read, set: vi.fn(async () => {}) },
      sync: { ...chrome.storage.sync, get: read, set: vi.fn(async () => {}) },
      session: { get: read, set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
      onChanged: event(),
    },
    permissions: {
      contains: vi.fn(async () => false),
      getAll: vi.fn(async () => ({ origins: [] })),
      onAdded: event(),
      onRemoved: event(),
    },
    scripting,
    notifications: { ...chrome.notifications, onClicked: event() },
    alarms: { ...chrome.alarms, create: vi.fn(async () => {}), onAlarm: event() },
    tabs: { ...chrome.tabs, query: vi.fn(async () => []), onRemoved: event(), onUpdated: event() },
  });

  await import('../index');
  // Let the startup syncs settle so later observations belong to the message under test.
  await new Promise((resolve) => setTimeout(resolve, 0));
  scripting.getRegisteredContentScripts.mockClear();
  scripting.unregisterContentScripts.mockClear();
  catalogFetch.mockClear();
  if (!listener) throw new Error('background registered no runtime message listener');
  const send = (
    message: unknown,
    sender: chrome.runtime.MessageSender = { id: chrome.runtime.id },
  ) => {
    const reply = vi.fn();
    return { open: listener!(message, sender, reply), reply };
  };
  const catalogRequests = () =>
    catalogFetch.mock.calls.filter(([input]) => String(input) === CHATGPT_CATALOG_URL);
  return { send, scripting, connectNative, catalogRequests };
}

describe('background runtime messages', () => {
  it('leaves channels owned by other listeners closed', async () => {
    const { send } = await startBackground('chrome');

    const { open, reply } = send({ type: 'gv.chatgptExport.open' });

    expect(open).toBeUndefined();
    expect(reply).not.toHaveBeenCalled();
  });

  it('answers a content-script repair request once, after the stale plugin registration is removed', async () => {
    const { send, scripting } = await startBackground('chrome');
    let release!: () => void;
    const registryRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    scripting.getRegisteredContentScripts.mockImplementation(async () => {
      await registryRead;
      return [{ id: PLUGIN_SCRIPT_ID }];
    });

    const { open, reply } = send({ type: PLUGIN_CONTENT_SCRIPT_SYNC_MESSAGE });
    expect(open).toBe(true);
    await vi.waitFor(() => expect(scripting.getRegisteredContentScripts).toHaveBeenCalled());
    expect(reply).not.toHaveBeenCalled();

    release();
    await vi.waitFor(() => expect(reply).toHaveBeenCalledExactlyOnceWith({ ok: true }));
    expect(scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: [PLUGIN_SCRIPT_ID] });
  });

  it('shares one forced catalog request between concurrent refresh messages', async () => {
    const { send, catalogRequests } = await startBackground('chrome');
    const refresh = {
      type: PLUGIN_CATALOG_REFRESH_MESSAGE,
      payload: { host: 'chatgpt.com', force: true },
    };

    const first = send(refresh);
    const second = send(refresh);

    expect([first.open, second.open]).toEqual([true, true]);
    for (const { reply } of [first, second]) {
      await vi.waitFor(() =>
        expect(reply).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ ok: true, status: 'missing' }),
        ),
      );
    }
    expect(catalogRequests()).toHaveLength(1);
  });

  it('opens the Safari native port only in the Safari build', async () => {
    const chromeBuild = await startBackground('chrome');
    expect(chromeBuild.connectNative).not.toHaveBeenCalled();

    const safariBuild = await startBackground('safari');
    expect(safariBuild.connectNative).toHaveBeenCalledExactlyOnceWith(SAFARI_NATIVE_APP_ID);
  });

  it('answers a Safari image fetch whose body fails with the error instead of leaving the page waiting', async () => {
    const { send } = await startBackground('safari');
    const brokenBody = new ReadableStream({
      pull(controller) {
        controller.error(new Error('image unavailable'));
      },
    });
    const image = new Response(brokenBody, { headers: { 'Content-Type': 'image/png' } });
    vi.mocked(fetch).mockResolvedValue(image);

    const { open, reply } = send(
      { type: 'gv.fetchImage', url: 'https://lh3.googleusercontent.com/image.png' },
      {
        id: chrome.runtime.id,
        tab: { id: 7, url: 'https://gemini.google.com/app/abc' } as chrome.tabs.Tab,
      },
    );

    expect(open).toBe(true);
    await vi.waitFor(() =>
      expect(reply).toHaveBeenCalledExactlyOnceWith({ ok: false, error: 'image unavailable' }),
    );
  });
});
