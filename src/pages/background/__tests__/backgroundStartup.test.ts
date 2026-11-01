import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import {
  NOTIFICATION_ENABLEMENT_MESSAGE,
  type NotificationEnablementPayload,
} from '@/core/utils/notificationEnablement';

// Keep the real startup owners; only browser I/O is replaced.
vi.mock('webextension-polyfill', () => ({
  get default() {
    return chrome;
  },
}));

afterEach(() => {
  if (vi.isFakeTimers()) {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Real browser events and storage, including the change events that writes emit. */
async function startNotificationBackground(
  initialSync: Record<string, unknown> = {},
  buildTarget = 'chrome',
) {
  vi.resetModules();
  vi.stubEnv('VOYAGER_BUILD_TARGET', buildTarget);
  vi.stubEnv('VOYAGER_DEV_AUTO_RELOAD', '');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const event = <Args extends unknown[]>() => {
    const addListener = vi.fn<(listener: (...args: Args) => unknown) => void>();
    return {
      addListener,
      removeListener: vi.fn(),
      emit: (...args: Args) => addListener.mock.calls.map(([listener]) => listener(...args)),
    };
  };
  const messages = event<[unknown, chrome.runtime.MessageSender, (response: unknown) => void]>();
  const permissionsAdded = event<[chrome.permissions.Permissions]>();
  const storageChanged = event<[Record<string, chrome.storage.StorageChange>, string]>();
  const sync: Record<string, unknown> = {
    [StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED]: false,
    [StorageKeys.HIGHLIGHT_ENABLED]: false,
    ...initialSync,
  };
  const local: Record<string, unknown> = {};
  const area = (values: Record<string, unknown>, name: string) => ({
    get: vi.fn(async (keys?: unknown) => {
      if (keys == null) return { ...values };
      const defaults =
        typeof keys === 'object' && !Array.isArray(keys) ? (keys as Record<string, unknown>) : {};
      const names =
        typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(defaults);
      return Object.fromEntries(names.map((key: string) => [key, values[key] ?? defaults[key]]));
    }),
    set: vi.fn(async (updates: Record<string, unknown>) => {
      const changes: Record<string, chrome.storage.StorageChange> = {};
      for (const [key, value] of Object.entries(updates)) {
        if (Object.is(values[key], value)) continue;
        changes[key] = { oldValue: values[key], newValue: value };
        values[key] = value;
      }
      if (Object.keys(changes).length > 0) storageChanged.emit(changes, name);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      const changes: Record<string, chrome.storage.StorageChange> = {};
      for (const key of typeof keys === 'string' ? [keys] : keys) {
        if (!Object.hasOwn(values, key)) continue;
        changes[key] = { oldValue: values[key] };
        delete values[key];
      }
      if (Object.keys(changes).length > 0) storageChanged.emit(changes, name);
    }),
  });
  let granted = false;
  vi.stubGlobal('chrome', {
    ...chrome,
    runtime: {
      ...chrome.runtime,
      getManifest: () => ({ permissions: [], host_permissions: [], content_scripts: [] }),
      onMessage: messages,
      onInstalled: event(),
      onStartup: event(),
    },
    storage: {
      sync: area(sync, 'sync'),
      local: area(local, 'local'),
      session: area({}, 'session'),
      onChanged: storageChanged,
    },
    permissions: {
      contains: vi.fn(
        async (request: chrome.permissions.Permissions) =>
          request.permissions?.includes('notifications') === true && granted,
      ),
      getAll: vi.fn(async () => ({ origins: [] })),
      onAdded: permissionsAdded,
      onRemoved: event(),
    },
    notifications: { ...chrome.notifications, onClicked: event() },
    alarms: { ...chrome.alarms, create: vi.fn(async () => {}), onAlarm: event() },
    tabs: { ...chrome.tabs, onRemoved: event(), query: vi.fn(async () => []) },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 404 })),
  );
  await import('../index');
  const popup = { id: chrome.runtime.id, url: chrome.runtime.getURL('src/pages/popup/index.html') };
  const content = {
    id: chrome.runtime.id,
    url: 'https://gemini.google.com/app/chat',
    tab: { id: 7, url: 'https://gemini.google.com/app/chat' },
  } as chrome.runtime.MessageSender;
  const send = async (
    payload: NotificationEnablementPayload,
    sender: chrome.runtime.MessageSender = popup,
  ) => {
    const response = vi.fn();
    messages.emit({ type: NOTIFICATION_ENABLEMENT_MESSAGE, payload }, sender, response);
    await vi.waitFor(() => expect(response).toHaveBeenCalledOnce());
    return response.mock.calls[0][0];
  };
  return {
    sync,
    local,
    content,
    send,
    grant: () => {
      granted = true;
      permissionsAdded.emit({ permissions: ['notifications'] });
    },
  };
}

describe('MV3 background startup', () => {
  it.each(['chrome', 'firefox', 'safari'])(
    'turns off a legacy default-on Gemini quote preference on %s startup',
    async (buildTarget) => {
      const background = await startNotificationBackground(
        { [StorageKeys.QUOTE_REPLY_ENABLED]: true },
        buildTarget,
      );

      await vi.waitFor(() => {
        expect(background.sync[StorageKeys.QUOTE_REPLY_ENABLED]).toBe(false);
      });
    },
  );

  it('enables notifications on the first permission grant after the requesting popup has closed', async () => {
    const background = await startNotificationBackground();
    expect(await background.send({ action: 'begin', requestId: 'popup-first-click' })).toEqual({
      ok: true,
      enabled: false,
    });
    expect(background.sync[StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED]).toBe(false);
    expect(background.local[StorageKeys.RESPONSE_NOTIFICATION_ENABLE_PENDING]).toEqual({
      id: 'popup-first-click',
      requestedAt: expect.any(Number),
    });

    // No popup finish message: its window closed while Chrome showed the permission prompt.
    background.grant();
    await vi.waitFor(() => {
      expect(background.sync[StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED]).toBe(true);
      expect(background.local[StorageKeys.RESPONSE_NOTIFICATION_ENABLE_PENDING]).toBeUndefined();
    });
  });

  it.each([false, true])(
    'registers every browser event before pending startup I/O completes (dev auto-reload: %s)',
    async (devAutoReload) => {
      vi.resetModules();
      vi.stubEnv('VOYAGER_BUILD_TARGET', 'chrome');
      vi.stubEnv('VOYAGER_DEV_AUTO_RELOAD', devAutoReload ? 'true' : '');
      let release!: () => void;
      const startup = new Promise<void>((resolve) => {
        release = resolve;
      });
      let pendingReads = 0;
      let completedReads = 0;
      const read = vi.fn(async (keys: unknown) => {
        pendingReads++;
        await startup;
        pendingReads--;
        completedReads++;
        return keys && typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
      });
      const event = () => ({ addListener: vi.fn(), removeListener: vi.fn() });
      const events = {
        message: event(),
        installed: event(),
        browserStartup: event(),
        storage: event(),
        permissionAdded: event(),
        permissionRemoved: event(),
        notificationClick: event(),
        alarm: event(),
        tabRemoved: event(),
      };
      vi.stubGlobal('chrome', {
        ...chrome,
        runtime: {
          ...chrome.runtime,
          getManifest: () => ({ permissions: [], host_permissions: [], content_scripts: [] }),
          onMessage: events.message,
          onInstalled: events.installed,
          onStartup: events.browserStartup,
        },
        storage: {
          ...chrome.storage,
          local: { ...chrome.storage.local, get: read },
          sync: { ...chrome.storage.sync, get: read },
          session: { get: read, set: vi.fn(), remove: vi.fn() },
          onChanged: events.storage,
        },
        permissions: {
          contains: vi.fn(async () => false),
          getAll: vi.fn(async () => ({ origins: [] })),
          onAdded: events.permissionAdded,
          onRemoved: events.permissionRemoved,
        },
        notifications: { ...chrome.notifications, onClicked: events.notificationClick },
        alarms: {
          ...chrome.alarms,
          create: vi.fn(async () => {
            await startup;
          }),
          onAlarm: events.alarm,
        },
        tabs: { ...chrome.tabs, onRemoved: events.tabRemoved },
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          await startup;
          return new Response('', { status: 404 });
        }),
      );

      try {
        await import('../index');
        expect(pendingReads).toBeGreaterThan(0);
        expect(completedReads).toBe(0);
        const registrations = Object.values(events).map(({ addListener }) => {
          expect(addListener).toHaveBeenCalledWith(expect.any(Function));
          return [...addListener.mock.calls];
        });

        release();
        await vi.waitFor(() => expect(pendingReads).toBe(0));
        // Let continuations behind the held reads run, including a mistakenly deferred listener.
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(completedReads).toBeGreaterThan(0);
        expect(Object.values(events).map(({ addListener }) => addListener.mock.calls)).toEqual(
          registrations,
        );
      } finally {
        release();
      }
    },
  );
});
