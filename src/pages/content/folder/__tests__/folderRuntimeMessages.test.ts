import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FolderStore } from '../FolderStore';
import type { FolderData } from '../types';
import { FolderManager } from './geminiFolderManager';

const { mockBrowser } = vi.hoisted(() => ({
  mockBrowser: {
    runtime: {
      id: 'test-extension-id',
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      sendMessage: vi.fn(),
    },
    storage: {
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
      sync: { get: vi.fn(), set: vi.fn() },
    },
  },
}));

vi.mock('webextension-polyfill', () => ({ default: mockBrowser }));

vi.mock('@/utils/i18n', () => ({
  onCachedLanguageChange: () => () => {},
  getTranslationSync: (key: string) => key,
  getTranslationSyncUnsafe: (key: string) => key,
  initI18n: () => Promise.resolve(),
}));

type MessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => true | undefined;

type TestableManager = {
  store: FolderStore;
  /** The page's folder session, which answers the popup. */
  session: { listen(): void };
  setupStorageListener(): void;
};

function makeManager(): { manager: FolderManager; internals: TestableManager } {
  const manager = new FolderManager();
  return { manager, internals: manager as unknown as TestableManager };
}

function makeFolderData(): FolderData {
  return {
    folders: [
      {
        id: 'folder-1',
        name: 'Folder One',
        parentId: null,
        isExpanded: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    folderContents: { 'folder-1': [] },
  };
}

describe('folder runtime message lifecycle', () => {
  let manager: FolderManager | null = null;

  beforeEach(() => {
    mockBrowser.runtime.onMessage.addListener.mockClear();
    mockBrowser.storage.onChanged.addListener.mockClear();
    mockBrowser.storage.local.get.mockResolvedValue({});
    (chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>).mockClear();
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  afterEach(() => {
    manager?.destroy();
    manager = null;
    document.body.innerHTML = '';
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('message dispatch', () => {
    function getMessageListener(internals: TestableManager): MessageListener {
      internals.session.listen();
      const call = mockBrowser.runtime.onMessage.addListener.mock.calls.at(-1);
      expect(call).toBeDefined();
      return call?.[0] as MessageListener;
    }

    it('does not register a duplicate raw chrome.runtime.onMessage listener', () => {
      const { manager: m, internals } = makeManager();
      manager = m;

      internals.setupStorageListener();
      internals.session.listen();

      // The duplicate gv.folders.reload listener used to be registered on the
      // raw chrome.runtime API from setupStorageListener.
      expect(chrome.runtime.onMessage.addListener).not.toHaveBeenCalled();
      expect(mockBrowser.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
    });

    it('handles gv.folders.reload exactly once', async () => {
      const { manager: m, internals } = makeManager();
      manager = m;
      internals.setupStorageListener();

      const loadSpy = vi.spyOn(internals.store, 'loadData').mockResolvedValue(undefined);
      // The folders' view shows what the reload brought.
      const view = m.view as unknown as { refresh(): void };
      const refreshSpy = vi.spyOn(view, 'refresh').mockImplementation(() => {});
      const sendResponse = vi.fn();

      const listener = getMessageListener(internals);
      const result = listener({ type: 'gv.folders.reload' }, {}, sendResponse);

      expect(result).toBe(true); // async response promised — channel stays open
      await Promise.resolve();
      await Promise.resolve();

      expect(loadSpy).toHaveBeenCalledTimes(1);
      expect(refreshSpy).toHaveBeenCalledTimes(1);
      expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });

    it('responds synchronously to gv.sync.requestData and keeps the channel open', async () => {
      const { manager: m, internals } = makeManager();
      manager = m;
      (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        gvFolderData: makeFolderData(),
      });
      await internals.store.init();

      const sendResponse = vi.fn();
      const listener = getMessageListener(internals);
      const result = listener({ type: 'gv.sync.requestData' }, {}, sendResponse);

      expect(result).toBe(true);
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, data: internals.store.data }),
      );
    });

    it('does not publish an empty Gemini snapshot before folders have loaded', async () => {
      const { manager: m, internals } = makeManager();
      manager = m;
      const listener = getMessageListener(internals);
      const sendResponse = vi.fn();
      listener({ type: 'gv.sync.requestData' }, {}, sendResponse);
      expect(sendResponse).toHaveBeenLastCalledWith({ ok: false });
      (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        gvFolderData: { folders: [], folderContents: {} },
      });
      await internals.store.init();
      listener({ type: 'gv.sync.requestData' }, {}, sendResponse);
      expect(sendResponse).toHaveBeenLastCalledWith(
        expect.objectContaining({ ok: true, data: { folders: [], folderContents: {} } }),
      );
    });

    it('returns undefined for unknown messages so the sender promise settles', () => {
      const { manager: m, internals } = makeManager();
      manager = m;

      const sendResponse = vi.fn();
      const listener = getMessageListener(internals);
      const result = listener({ type: 'gv.remoteAnnouncement.show' }, {}, sendResponse);

      expect(result).toBeUndefined();
      expect(sendResponse).not.toHaveBeenCalled();
    });
  });

  it('removes its permanent runtime and settings listeners on destroy', () => {
    const { manager: instance, internals } = makeManager();
    manager = instance;
    internals.setupStorageListener();
    internals.session.listen();
    const settingsListener = mockBrowser.storage.onChanged.addListener.mock.calls.at(-1)![0];
    const messageListener = mockBrowser.runtime.onMessage.addListener.mock.calls.at(-1)![0];
    expect(mockBrowser.storage.onChanged.removeListener).not.toHaveBeenCalledWith(settingsListener);
    expect(mockBrowser.runtime.onMessage.removeListener).not.toHaveBeenCalledWith(messageListener);
    instance.destroy();
    expect(mockBrowser.storage.onChanged.removeListener).toHaveBeenCalledWith(settingsListener);
    expect(mockBrowser.runtime.onMessage.removeListener).toHaveBeenCalledWith(messageListener);
  });
});
