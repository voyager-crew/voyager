import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { captureCloudSyncSnapshot } from '@/core/services/CloudSyncSnapshotService';
import { StorageKeys } from '@/core/types/common';
import { confirmDriver } from '@/tests/confirmDriver';
import { createMemoryStorage } from '@/tests/memoryStorage';
import { toastDriver } from '@/tests/toastDriver';

import { FolderDataSession } from '../FolderDataSession';
import { FolderFeedback } from '../FolderFeedback';
import { FolderTransferController } from '../FolderTransferController';
import type { FolderData } from '../types';

const { sendMessage } = vi.hoisted(() => ({
  sendMessage: vi.fn<(message: { type: string; payload?: unknown }) => Promise<unknown>>(),
}));
vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: { sendMessage },
    get storage() {
      return chrome.storage;
    },
  },
}));
vi.mock('@/utils/i18n', () => ({
  getTranslationSync: (key: string) => key,
  getTranslationSyncUnsafe: (key: string) => TEMPLATES[key] ?? key,
}));
const TEMPLATES: Record<string, string> = {
  syncGuardCount: '{kind}: {cloud} → {local}',
  syncGuardSiteKind: '{kind} ({site})',
  syncReasonSiteExcluded: '{site} excluded',
};

function folders(...names: string[]): FolderData {
  return {
    folders: names.map((name, index) => ({
      id: name,
      name,
      parentId: null,
      isExpanded: true,
      sortIndex: index,
      createdAt: 1,
      updatedAt: 1,
    })),
    folderContents: Object.fromEntries(names.map((name) => [name, []])),
  };
}
const refusal = (guardToken: string) => ({
  ok: false,
  error: 'upload_guard_refused',
  guardToken,
  refusedFiles: [{ kind: 'folders', localCount: 1, cloudCount: 9, reason: 'large_drop' }],
});

describe('folder panel guard and Undo on Gemini', () => {
  let feedback: FolderFeedback;
  let session: FolderDataSession;
  let activation: number;
  let transfer: FolderTransferController;
  const sent = (type: string) =>
    sendMessage.mock.calls.filter(([message]) => message.type === type).map(([m]) => m.payload);
  const names = () => session.data.folders.map(({ name }) => name);

  beforeEach(async () => {
    vi.stubGlobal('chrome', { ...chrome, storage: createMemoryStorage().api });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    feedback = new FolderFeedback();
    session = new FolderDataSession('gvFolderData', 'guard-undo-test', null, () => true);
    session.data = folders('local');
    session.ready = true;
    await chrome.storage.local.set({ [session.storageKey]: session.data });
    activation = 1;
    transfer = new FolderTransferController({
      getContext: () => ({ session, activation, data: session.data }),
      applyData: async (next, beforeWrite) => {
        const items = { [session.storageKey]: next };
        await beforeWrite?.(items);
        await chrome.storage.local.set(items);
        session.data = next;
        return true;
      },
      refresh: () => {},
      // The Gemini view's wiring: transfer notices share one channel.
      notify: (message, type) => feedback.showNotification(message, type, 'transfer'),
    });
  });
  afterEach(() => {
    confirmDriver.pressEscape();
    feedback.destroy();
    sendMessage.mockReset();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  async function download() {
    sendMessage.mockImplementation(async ({ type }) =>
      type === 'gv.sync.download'
        ? { ok: true, operationId: 'op', data: { folders: { data: folders('cloud') } } }
        : { ok: true },
    );
    await transfer.sync();
    const toast = toastDriver.find('downloadMergeSuccess')!;
    expect(toastDriver.labels(toast)).toContain('syncUndo');
    return toast;
  }

  it('resends a refused upload with its token on Upload anyway, and asks again on a new refusal', async () => {
    sendMessage.mockImplementation(async ({ payload }) => {
      const { guardToken } = payload as { guardToken?: string };
      return guardToken === 'guard-2' ? { ok: true } : refusal(guardToken ? 'guard-2' : 'guard-1');
    });
    const uploading = transfer.upload();
    for (const round of [1, 2]) {
      await vi.waitFor(() => expect(confirmDriver.isOpen()).toBe(true));
      expect(confirmDriver.details()).toEqual(['folder_title (Gemini): 9 → 1']);
      expect(confirmDriver.emphasis('syncGuardForce')).toBe('danger');
      confirmDriver.answer('syncGuardForce');
      if (round === 1) await vi.waitFor(() => expect(sent('gv.sync.upload')).toHaveLength(2));
    }
    await uploading;

    expect(
      sent('gv.sync.upload').map((payload) => (payload as { guardToken?: string }).guardToken),
    ).toEqual([undefined, 'guard-1', 'guard-2']);
    expect(toastDriver.find('uploadSuccess')?.tone).toBe('success');
  });

  it('sends nothing more when the account changes while the confirm is open', async () => {
    sendMessage.mockResolvedValue(refusal('guard-1'));
    const uploading = transfer.upload();
    await vi.waitFor(() => expect(confirmDriver.isOpen()).toBe(true));
    activation += 2;
    confirmDriver.answer('syncGuardForce');
    await uploading;

    expect(sent('gv.sync.upload')).toHaveLength(1);
    const toast = toastDriver.find('syncUploadFailed')!;
    expect(toast.message).toContain('syncReasonAccountChanged');
  });

  it('uploads nothing and says why when this site is turned off in what syncs', async () => {
    await chrome.storage.local.set({
      [StorageKeys.CLOUD_SYNC_SCOPE]: { version: 1, shared: true, sites: { gemini: false } },
    });
    await transfer.upload();

    expect(sent('gv.sync.upload')).toEqual([]);
    expect(toastDriver.all().map(({ message }) => message)).toContain('Gemini excluded');
  });

  it('puts the folders back with Undo after a download', async () => {
    const toast = await download();
    expect(names()).toEqual(['local', 'cloud']);

    toastDriver.press(toast, 'syncUndo');
    await vi.waitFor(() => expect(toastDriver.find('syncUndoDone')).toBeDefined());
    const stored = await chrome.storage.local.get(session.storageKey);
    expect((stored[session.storageKey] as FolderData).folders.map(({ name }) => name)).toEqual([
      'local',
    ]);
  });

  it('leaves a later download alone when Undo belongs to an earlier one', async () => {
    const toast = await download();
    await captureCloudSyncSnapshot({
      context: { source: 'popup-restore', platform: 'gemini', accountScope: null },
      keys: [{ area: 'local', key: session.storageKey }],
    });

    toastDriver.press(toast, 'syncUndo');
    await vi.waitFor(() => expect(toastDriver.find('syncUndoReplaced')).toBeDefined());
    expect(names()).toEqual(['local', 'cloud']);
  });

  it('keeps Undo past ten seconds while the pointer is on it', async () => {
    const toast = await download();
    vi.useFakeTimers();
    toastDriver.hover(toast);
    vi.advanceTimersByTime(15_000);
    expect(toastDriver.find('downloadMergeSuccess')).toBeDefined();

    toastDriver.leave(toast);
    vi.advanceTimersByTime(10_001);
    expect(toastDriver.find('downloadMergeSuccess')).toBeUndefined();
  });
});
