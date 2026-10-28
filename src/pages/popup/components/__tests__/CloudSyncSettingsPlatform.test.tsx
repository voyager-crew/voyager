import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '@/contexts/LanguageContext';
import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import { type SyncState, DEFAULT_SYNC_STATE } from '@/core/types/sync';
import {
  handlePromptLibraryApplyMessage,
  isPromptLibraryApplyMessage,
} from '@/features/prompt/library/promptLibraryMessages';
import { createPromptLibraryOwner } from '@/features/prompt/library/promptLibraryOwner';
import { loadTranslations } from '@/utils/translations';

import { CloudSyncSettings } from '../CloudSyncSettings';

vi.mock('webextension-polyfill', () => ({
  default: {
    i18n: { getUILanguage: () => 'en' },
    storage: {
      local: {
        get: (keys: string | string[] | Record<string, unknown>) => chrome.storage.local.get(keys),
        set: (values: Record<string, unknown>) => chrome.storage.local.set(values),
      },
      sync: {
        get: (keys: string | string[] | Record<string, unknown>) => chrome.storage.sync.get(keys),
        set: (values: Record<string, unknown>) => chrome.storage.sync.set(values),
      },
      onChanged: {
        addListener: (listener: Parameters<typeof chrome.storage.onChanged.addListener>[0]) =>
          chrome.storage.onChanged.addListener(listener),
        removeListener: (listener: Parameters<typeof chrome.storage.onChanged.removeListener>[0]) =>
          chrome.storage.onChanged.removeListener(listener),
      },
    },
  },
}));

const t = await loadTranslations('en');
const state: SyncState = {
  ...DEFAULT_SYNC_STATE,
  mode: 'manual',
  lastUploadTimeAIStudio: Date.now(),
  lastSyncTimeAIStudio: Date.now(),
};

const localId = '11111111-1111-4111-8111-111111111111';
const cloudId = '22222222-2222-4222-8222-222222222222';
function folders(id: string, name: string): FolderData {
  return {
    folders: [{ id, name, parentId: null, isExpanded: true, createdAt: 1, updatedAt: 1 }],
    folderContents: {
      [id]: [
        {
          conversationId: `chatgpt:conv:${id}`,
          title: name,
          url: `https://chatgpt.com/c/${id}`,
          addedAt: 1,
        },
      ],
    },
  };
}

const localFolders = folders(localId, 'Local folder');
const cloudFolders = folders(cloudId, 'Cloud folder');

function downloadedData(data: unknown = cloudFolders) {
  return {
    folders: {
      format: 'gemini-voyager.folders.v1',
      platform: 'chatgpt',
      exportedAt: '2026-10-03T00:00:00.000Z',
      version: '1.9.0',
      data,
    },
    prompts: { items: [{ id: 'cloud-prompt', text: 'Cloud prompt', tags: [], createdAt: 1 }] },
    settings: { format: 'gemini-voyager.settings.v1', data: { language: 'fr' } },
    plugins: {
      format: 'gemini-voyager.plugins.v1',
      data: { 'chatgpt-folders': { enabled: false, settings: {} } },
    },
  };
}

type Message = { type: string; payload?: Record<string, unknown> };

function installChrome(tabUrl: string, download = downloadedData()) {
  const local: Record<string, unknown> = {
    [StorageKeys.FOLDER_DATA_CHATGPT]: localFolders,
    [StorageKeys.FOLDER_DATA]: folders('gemini-folder', 'Gemini folder'),
    [StorageKeys.FOLDER_DATA_AISTUDIO]: folders('studio-folder', 'Studio folder'),
    [StorageKeys.PROMPT_ITEMS]: [
      { id: 'local-prompt', text: 'Local prompt', tags: [], createdAt: 1 },
    ],
    [StorageKeys.PLUGINS_STATE]: { 'chatgpt-folders': { enabled: true, settings: {} } },
  };
  const sync: Record<string, unknown> = { [StorageKeys.LANGUAGE]: 'en' };
  const get = (values: Record<string, unknown>) =>
    vi.fn(async (keys: string | string[] | Record<string, unknown>) => {
      const names =
        typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      return Object.fromEntries(
        names.map((key) => [
          key,
          values[key] ?? (typeof keys === 'object' && !Array.isArray(keys) ? keys[key] : undefined),
        ]),
      );
    });
  const localSet = vi.fn(async (values: Record<string, unknown>) => {
    Object.assign(local, values);
  });
  const syncSet = vi.fn(async (values: Record<string, unknown>) => {
    Object.assign(sync, values);
  });
  const localGet = get(local);
  const prompts = createPromptLibraryOwner({ area: { get: localGet, set: localSet } });
  const sendMessage = vi.fn(async (message: Message): Promise<unknown> => {
    if (isPromptLibraryApplyMessage(message)) {
      return handlePromptLibraryApplyMessage(message, prompts);
    }
    if (message.type === 'gv.sync.download') return { ok: true, state, data: download };
    return { ok: true, state };
  });
  const tabSendMessage = vi.fn(async (_id: number, message: Message): Promise<unknown> => {
    if (message.type === 'gv.sync.requestData') {
      return {
        ok: true,
        data: localFolders,
        accountScope: { accountKey: 'other-account', accountId: 4, routeUserId: '4' },
      };
    }
    return undefined;
  });
  const tabQuery = vi.fn().mockResolvedValue([{ id: 3, url: tabUrl }]);
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension-id', sendMessage, lastError: null },
    tabs: {
      get: vi.fn(),
      query: tabQuery,
      sendMessage: tabSendMessage,
    },
    storage: {
      local: { get: localGet, set: localSet, remove: vi.fn() },
      sync: { get: get(sync), set: syncSet, remove: vi.fn() },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
  return { local, sync, sendMessage, tabSendMessage, tabQuery, localSet, syncSet };
}

describe('CloudSyncSettings platform routing', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const mount = async () => {
    await act(async () =>
      root.render(
        <LanguageProvider>
          <CloudSyncSettings />
        </LanguageProvider>,
      ),
    );
  };
  const click = async (label: string) => {
    const button = Array.from(container.querySelectorAll('button')).find(
      (element) => element.textContent?.trim() === label,
    );
    expect(button).toBeDefined();
    await act(async () => button!.click());
  };

  it('shows ChatGPT Cloud Sync with its own never-uploaded and never-synced timestamps', async () => {
    installChrome(`https://chatgpt.com/c/${localId}`);
    await mount();
    expect(container.textContent).toContain(t.cloudSync);
    const summary = container.querySelector('[data-testid="sync-platform-summary"]');
    expect(summary?.textContent).toContain(t.platformChatGPT);
    expect(summary?.textContent).toContain(t.neverUploaded);
    expect(summary?.textContent).toContain(t.neverSynced);
    expect(container.textContent).not.toContain(t.highlightCloudSync);
  });

  it('uploads ChatGPT folders without shared data or a Google account scope', async () => {
    const { sendMessage } = installChrome(`https://chatgpt.com/c/${localId}`);
    await mount();
    await click(t.syncUpload);
    const message = sendMessage.mock.calls
      .map(([sent]) => sent)
      .find((sent) => sent.type === 'gv.sync.upload');
    expect(message?.payload).toEqual({
      platform: 'chatgpt',
      accountScope: null,
      timelineHierarchyAccountScope: null,
      highlightAccountScope: null,
      includeHighlights: false,
      folders: localFolders,
      prompts: [],
    });
    expect(container.textContent).toContain(t.syncSuccess);
  });

  it.each(['merge', 'overwrite'] as const)(
    '%s restores only the ChatGPT bucket and notifies its tab',
    async (mode) => {
      const { local, sync, sendMessage, tabSendMessage, localSet, syncSet } = installChrome(
        `https://chatgpt.com/c/${localId}`,
      );
      const beforeLocal = structuredClone(local);
      const beforeSync = structuredClone(sync);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await mount();
      await click(mode === 'merge' ? t.syncMerge : t.syncOverwrite);
      const message = sendMessage.mock.calls
        .map(([sent]) => sent)
        .find((sent) => sent.type === 'gv.sync.download');
      expect(message?.payload).toEqual({
        platform: 'chatgpt',
        accountScope: null,
        timelineHierarchyAccountScope: null,
        highlightAccountScope: null,
        includeHighlights: false,
      });
      const restored = local[StorageKeys.FOLDER_DATA_CHATGPT] as FolderData;
      expect(restored.folders.map((folder) => folder.id)).toEqual(
        mode === 'merge' ? [localId, cloudId] : [cloudId],
      );
      expect(restored.folderContents[cloudId]).toEqual(cloudFolders.folderContents[cloudId]);
      expect({
        ...local,
        [StorageKeys.FOLDER_DATA_CHATGPT]: beforeLocal[StorageKeys.FOLDER_DATA_CHATGPT],
      }).toEqual(beforeLocal);
      expect(sync).toEqual(beforeSync);
      expect(localSet).toHaveBeenCalledOnce();
      expect(Object.keys(localSet.mock.calls[0][0])).toEqual([StorageKeys.FOLDER_DATA_CHATGPT]);
      expect(syncSet).not.toHaveBeenCalled();
      expect(tabSendMessage).toHaveBeenCalledWith(3, { type: 'gv.folders.reload' });
      expect(container.textContent).toContain(t.syncSuccess);
    },
  );

  it('Merge does not resurrect stored Gemini folders after a successful empty live snapshot', async () => {
    const empty = { folders: [], folderContents: {} };
    const { local, sync, tabSendMessage } = installChrome(
      'https://gemini.google.com/app',
      downloadedData(empty),
    );
    sync[StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI] = false;
    const beforeChatGPT = structuredClone(local[StorageKeys.FOLDER_DATA_CHATGPT]);
    tabSendMessage.mockImplementation(async (_id, message) =>
      message.type === 'gv.sync.requestData'
        ? {
            ok: true,
            data: empty,
          }
        : undefined,
    );
    await mount();
    await click(t.syncMerge);
    expect(local[StorageKeys.FOLDER_DATA]).toEqual(empty);
    expect(local[StorageKeys.FOLDER_DATA_CHATGPT]).toEqual(beforeChatGPT);
    expect(container.textContent).toContain(t.syncSuccess);
  });

  it.each(['before request', 'during request'] as const)(
    'Merge never uses Gemini folders after the source tab navigates %s',
    async (navigation) => {
      const { local, sendMessage, tabSendMessage, tabQuery } = installChrome(
        `https://chatgpt.com/c/${localId}`,
      );
      const foreign = folders('gemini-folder', 'Gemini folder');
      foreign.folderContents['gemini-folder'][0].url = 'https://gemini.google.com/app/abc';
      const navigate = () => {
        tabQuery.mockResolvedValue([
          { id: 3, url: 'https://gemini.google.com/app/abc' } as chrome.tabs.Tab,
        ]);
      };
      sendMessage.mockImplementation(async (message) => {
        if (message.type === 'gv.sync.download') {
          if (navigation === 'before request') navigate();
          return { ok: true, state, data: downloadedData() };
        }
        return { ok: true, state };
      });
      tabSendMessage.mockImplementation(async (_id, message) => {
        if (message.type === 'gv.sync.requestData') {
          if (navigation === 'during request') navigate();
          return {
            ok: true,
            data: foreign,
            accountScope: { accountKey: 'other-account', accountId: 4, routeUserId: '4' },
          };
        }
        return undefined;
      });
      await mount();
      await click(t.syncMerge);
      const restored = local[StorageKeys.FOLDER_DATA_CHATGPT] as FolderData;
      expect(restored.folders.map((folder) => folder.id)).toEqual([localId, cloudId]);
      expect(restored.folderContents[localId]).toEqual(localFolders.folderContents[localId]);
      expect(restored.folderContents['gemini-folder']).toBeUndefined();
      expect(container.textContent).toContain(t.syncSuccess);
    },
  );

  it.each([
    { symptom: 'a malformed bucket', bucket: null },
    {
      symptom: 'a malformed entry',
      bucket: [...cloudFolders.folderContents[cloudId], { title: 'Broken' }],
    },
  ])(
    'Overwrite refuses a cloud file containing $symptom without losing local folders',
    async ({ bucket }) => {
      const malformed = { ...cloudFolders, folderContents: { [cloudId]: bucket } };
      const { local, localSet, syncSet } = installChrome(
        `https://chatgpt.com/c/${localId}`,
        downloadedData(malformed),
      );
      const before = structuredClone(local);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await mount();
      await click(t.syncOverwrite);
      expect(local).toEqual(before);
      expect(localSet).not.toHaveBeenCalled();
      expect(syncSet).not.toHaveBeenCalled();
      expect(container.textContent).toContain(t.folder_import_invalid_format);
      expect(container.textContent).not.toContain(t.syncSuccess);
    },
  );

  it.each([
    { symptom: 'an empty array', contents: [] },
    { symptom: 'an array of buckets', contents: [[]] },
  ])(
    'Overwrite refuses $symptom as folderContents without deleting local conversations',
    async ({ contents }) => {
      const malformed = { ...cloudFolders, folderContents: contents };
      const { local, localSet, syncSet } = installChrome(
        `https://chatgpt.com/c/${localId}`,
        downloadedData(malformed),
      );
      const before = structuredClone(local);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await mount();
      await click(t.syncOverwrite);
      expect(local).toEqual(before);
      expect(localSet).not.toHaveBeenCalled();
      expect(syncSet).not.toHaveBeenCalled();
      expect(container.textContent).toContain(t.folder_import_invalid_format);
      expect(container.textContent).not.toContain(t.syncSuccess);
    },
  );

  it('rejects downloaded folders containing a foreign URL without writing storage', async () => {
    const foreign = folders(cloudId, 'Foreign folder');
    foreign.folderContents[cloudId][0].url = `https://gemini.google.com/app/${cloudId}`;
    const { local, localSet, syncSet } = installChrome(
      `https://chatgpt.com/c/${localId}`,
      downloadedData(foreign),
    );
    const before = structuredClone(local);
    await mount();
    await click(t.syncMerge);
    expect(local).toEqual(before);
    expect(localSet).not.toHaveBeenCalled();
    expect(syncSet).not.toHaveBeenCalled();
    expect(container.textContent).toContain(t.folder_import_wrong_site);
  });

  it('shows Gemini and AI Studio their own sync timestamps', async () => {
    installChrome('https://aistudio.google.com/prompts/new_chat');
    await mount();
    let summary = container.querySelector('[data-testid="sync-platform-summary"]');
    expect(summary?.textContent).toContain(t.platformAIStudio);
    expect(summary?.textContent).toContain(t.lastUploaded.replace('{time}', t.justNow));
    expect(summary?.textContent).toContain(t.lastSynced.replace('{time}', t.justNow));
    expect(summary?.textContent).not.toContain(t.neverSynced);

    await act(async () => root.unmount());
    root = createRoot(container);
    installChrome('https://gemini.google.com/app');
    await mount();
    summary = container.querySelector('[data-testid="sync-platform-summary"]');
    expect(summary?.textContent).toContain(t.platformGemini);
    expect(summary?.textContent).toContain(t.neverUploaded);
    expect(summary?.textContent).toContain(t.neverSynced);
  });
});
