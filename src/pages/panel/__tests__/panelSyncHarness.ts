import { act } from 'react';

import { vi } from 'vitest';

import { FakeSyncDrive } from '@/core/services/__tests__/fixtures/fakeSyncDrive';
import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import { PANEL_PAGE_PATH, type PanelContext } from '@/features/panel/protocol';

import {
  CLAUDE,
  SESSION_ID,
  click,
  container,
  extensionApi,
  flush,
  granted,
  local,
  mount,
  sync,
} from './panelHarness';

/** The tab and frame the panel's one-time token was redeemed in. */
const TAB_ID = 9;
const FRAME_ID = 4;
const DOCUMENT_ID = 'panel-document';
const SITE_HOSTS: Readonly<Record<string, string>> = {
  gemini: 'https://gemini.google.com/app/',
  claude: 'https://claude.ai/chat/',
  chatgpt: 'https://chatgpt.com/c/',
};
export const FOLDER_KEYS = {
  gemini: StorageKeys.FOLDER_DATA,
  claude: StorageKeys.FOLDER_DATA_CLAUDE,
  chatgpt: StorageKeys.FOLDER_DATA_CHATGPT,
} as const;
export const FOLDER_FILES = {
  gemini: 'gemini-voyager-folders.json',
  claude: 'gemini-voyager-claude-folders.json',
  chatgpt: 'gemini-voyager-chatgpt-folders.json',
} as const;
export const PROMPTS_FILE = 'gemini-voyager-prompts.json';

export const prompt = (id: string) => ({ id, text: `${id} prompt`, tags: [], createdAt: 1 });

/** One folder named `name` holding the site's conversations `ids`, keyed as each site keys them. */
export function folders(site: keyof typeof FOLDER_KEYS, name: string, ids: string[]): FolderData {
  const id = `${site}-${name}`;
  return {
    folders: [{ id, name, parentId: null, isExpanded: true, createdAt: 1, updatedAt: 1 }],
    folderContents: {
      [id]: ids.map((bare) => ({
        conversationId: site === 'gemini' ? bare : `${site}:conv:${bare}`,
        title: bare,
        url: `${SITE_HOSTS[site]}${bare}`,
        addedAt: 1,
      })),
    },
  };
}

/** The bare conversation ids a folder set holds, sorted. */
export function conversationIds(data: unknown): string[] {
  const contents = (data as Partial<FolderData> | undefined)?.folderContents ?? {};
  return Object.values(contents)
    .flat()
    .map((entry) => entry.conversationId.split(':').at(-1) ?? '')
    .sort();
}

export function folderEnvelope(site: keyof typeof FOLDER_KEYS, data: FolderData) {
  return {
    format: 'gemini-voyager.folders.v1',
    version: '2.2.1',
    exportedAt: '2026-10-29T00:00:00.000Z',
    ...(site === 'gemini' ? {} : { platform: site }),
    data,
  };
}

export interface HandledCall {
  readonly type: string;
  readonly row: string;
  readonly force: boolean;
}

/**
 * The real background sync handler and its owners behind the panel's
 * `runtime.sendMessage`, over a fake Drive; only the browser and HTTP are fake.
 * The panel sends as its redeemed frame unless `redeemed` is false.
 */
export async function startSyncBackground(
  options: { context?: PanelContext; redeemed?: boolean } = {},
) {
  const context = options.context ?? CLAUDE;
  Object.assign(local, {
    gvAccessToken: 'fake-authorized-token',
    gvTokenExpiry: Date.now() + 3_600_000,
    gvSyncMode: 'manual',
    [StorageKeys.PROMPT_ITEMS]: [prompt('local')],
    [StorageKeys.FORK_NODES]: { nodes: {}, groups: {} },
    [StorageKeys.TIMELINE_HIERARCHY]: { conversations: {} },
    [StorageKeys.HIGHLIGHT_CLOUD_SYNC_ENABLED]: false,
  });
  Object.assign(sync, {
    [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED]: false,
    [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI]: false,
  });
  for (const pattern of ['https://claude.ai/*', 'https://chatgpt.com/*']) granted.add(pattern);
  const drive = new FakeSyncDrive();
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    drive.fetch(input, init),
  );
  // A fresh background, as a new service worker would load it; the panel keeps its own modules.
  vi.resetModules();
  const { createCloudSyncMessageHandler } = await import('@/pages/background/cloudSyncMessages');
  const { createForkMessagesOwner } = await import('@/pages/background/forkMessages');
  const { createStarStore } = await import('@/features/savedLibrary/starStore');
  const { redeemedPanelFrames } = await import('@/pages/background/panelTrust');
  const stars = createStarStore(chrome.storage.local);
  const forks = createForkMessagesOwner(chrome.storage.local);
  const handler = createCloudSyncMessageHandler({
    getAllStarredMessages: stars.getAll,
    getAllForkNodes: forks.getAllForkNodes,
    starStore: stars,
  });
  const hostOrigin = new URL(context.pageUrl).origin;
  if (options.redeemed !== false) {
    redeemedPanelFrames.replace([
      {
        sessionId: SESSION_ID,
        context,
        hostOrigin,
        tabId: TAB_ID,
        frameId: FRAME_ID,
        documentId: DOCUMENT_ID,
        hostDocumentId: null,
      },
    ]);
  }
  const panel: chrome.runtime.MessageSender = {
    id: extensionApi.runtime.id,
    url: `${extensionApi.runtime.getURL(PANEL_PAGE_PATH)}?t=redeemed`,
    frameId: FRAME_ID,
    documentId: DOCUMENT_ID,
    tab: { id: TAB_ID, url: context.pageUrl } as chrome.tabs.Tab,
  };
  const popup: chrome.runtime.MessageSender = {
    id: extensionApi.runtime.id,
    url: extensionApi.runtime.getURL('src/pages/popup/index.html'),
  };
  // A download applies prompts through the background's prompt library owner, over `chrome.runtime`.
  const library = await import('@/features/prompt/library/promptLibraryMessages');
  const { promptLibraryOwner, isAllowedPromptLibrarySender } =
    await import('@/pages/background/promptLibraryOwner');
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(async (message: unknown) => {
    if (!library.isPromptLibraryApplyMessage(message)) return undefined;
    if (!isAllowedPromptLibrarySender(panel)) return { ok: false, error: 'sender_not_allowed' };
    return library.handlePromptLibraryApplyMessage(message, promptLibraryOwner);
  });
  const calls: HandledCall[] = [];
  const fallback = extensionApi.runtime.sendMessage.getMockImplementation();
  extensionApi.runtime.sendMessage.mockImplementation(
    (message: { type?: string; payload?: Record<string, unknown> }) => {
      const type = message?.type ?? '';
      if (type.startsWith('gv.sync.')) {
        const payload = message.payload ?? {};
        calls.push({
          type: type.slice('gv.sync.'.length),
          row: payload.selection === 'shared' ? 'shared' : String(payload.platform ?? ''),
          force: payload.force === true,
        });
      }
      const reply = type ? handler({ type, payload: message.payload }, panel) : null;
      return reply ?? fallback?.(message);
    },
  );
  return {
    drive,
    calls,
    /** The transfers the panel ran, in order: `upload shared`, `download claude`, … */
    transfers: () =>
      calls
        .filter((call) => ['upload', 'download', 'completeDownload'].includes(call.type))
        .map((call) =>
          call.type === 'completeDownload'
            ? 'complete'
            : `${call.type} ${call.row}${call.force ? ' force' : ''}`,
        ),
    /** The popup (or another device) syncing through the same background. */
    fromPopup: (type: string, payload: Record<string, unknown> = {}) =>
      handler({ type, payload: { interactive: false, platform: 'gemini', ...payload } }, popup),
    cloudFolders: (site: keyof typeof FOLDER_FILES): FolderData | undefined =>
      (drive.payload(FOLDER_FILES[site]) as { data?: FolderData } | undefined)?.data,
  };
}

export const sheet = () => container.querySelector<HTMLElement>('#panel-sync-sheet');
export const cloudButton = () => container.querySelector<HTMLButtonElement>('.ib.cloud');
export const syncRow = (key: string) =>
  container.querySelector<HTMLElement>(`[data-sync-row="${key}"]`);
export const rowStatus = (key: string) => syncRow(key)?.querySelector('.st')?.textContent ?? '';
export const rowSwitch = (key: string) =>
  syncRow(key)?.querySelector<HTMLButtonElement>('.sw') ?? null;
export const primary = () =>
  container.querySelector<HTMLButtonElement>('#panel-sync-sheet #sync-foot .pri');
export const footButton = (label: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('#sync-foot button')).find(
    (button) => button.textContent === label,
  ) ?? null;
export const toastText = () =>
  container.querySelector('[role="status"] .toast.open')?.textContent ?? '';
export const toastUndo = () =>
  container.querySelector<HTMLButtonElement>('[role="status"] .toast.open button');

/** Lets the panel and background run, one 0ms task at a time, until `check` holds. */
export async function until(check: () => boolean, rounds = 400): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    if (check()) return;
    await act(flush);
  }
  throw new Error('The panel never reached the expected state');
}

/**
 * One device, synced once: then a prompt edited here (通用 newer here), a
 * Claude folder changed on both sides, and ChatGPT folders never uploaded.
 */
export async function startDivergedDevice() {
  const bg = await startSyncBackground();
  local[FOLDER_KEYS.gemini] = folders('gemini', 'G', ['g1']);
  local[FOLDER_KEYS.claude] = folders('claude', 'C', ['c1']);
  await bg.fromPopup('gv.sync.upload');
  await bg.fromPopup('gv.sync.upload', { platform: 'claude', selection: 'site' });
  local[StorageKeys.PROMPT_ITEMS] = [prompt('local'), prompt('edit')];
  local[FOLDER_KEYS.claude] = folders('claude', 'C', ['c1', 'c2']);
  bg.drive.put(FOLDER_FILES.claude, folderEnvelope('claude', folders('claude', 'C', ['c1', 'c3'])));
  local[FOLDER_KEYS.chatgpt] = folders('chatgpt', 'X', ['x1']);
  return bg;
}

/** Opens the sheet on a Claude page and waits for `row`'s status. */
export async function openSheet(row = 'chatgpt'): Promise<void> {
  await mount(CLAUDE);
  await click(cloudButton());
  await until(() => rowStatus(row) !== '');
}
