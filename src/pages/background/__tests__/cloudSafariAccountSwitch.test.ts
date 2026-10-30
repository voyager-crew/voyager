import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CloudSyncPayload } from '@/core/services/CloudSyncTransferContext';
import { parseCloudUploadReceipt } from '@/core/types/syncUploadReceipt';
import { undoRowUpload } from '@/pages/panel/sync/syncUploadUndo';

import {
  createGuardDevice,
  guardEnvelope,
  guardFiles,
  guardFolders,
  guardPrompt,
  GUARD_TIME,
  interceptGuardNative,
} from './fixtures/uploadGuardDevice';

type Account = 'a' | 'b';
const accountName = (account: Account) => `account-${account}`;
const isTransfer = (action: string) =>
  action.startsWith('googleDrive') &&
  !['googleDriveGetSession', 'googleDriveSignOut'].includes(action);

/**
 * The Voyager app's signed-in Google account in front of the device's Drive, which is account A's.
 * It keeps the native contract: a request naming another account than the stored one is refused
 * before it is sent, and an answer names its account. B's Drive is not modelled, so any request
 * that would reach it is recorded and fails.
 */
function voyagerAppAccounts() {
  let current: Account = 'a';
  let switchAfter: string | null = null;
  let refusal = 'drive_account_changed';
  const reachedB: string[] = [];
  interceptGuardNative(async (message, next) => {
    const action = String(message.action);
    if (!isTransfer(action)) return next(message);
    const { expectedDriveAccount: expected, ...forwarded } = message;
    if (typeof expected === 'string' && expected !== accountName(current)) {
      const code = refusal;
      refusal = 'drive_account_changed';
      return { success: false, code, error: 'Account changed' };
    }
    if (current === 'b') {
      reachedB.push(action);
      throw new Error(`B's Drive was asked to ${action}`);
    }
    const response = await next(forwarded);
    if (switchAfter === action) {
      switchAfter = null;
      current = 'b';
    }
    return response && typeof response === 'object' && 'success' in response && response.success
      ? { ...response, driveAccount: accountName('a') }
      : response;
  });
  return {
    reachedB,
    /**
     * The app signs in B right after the first answer to `action`. `afterWrite`: the next action
     * had already written to A when the native side noticed.
     */
    switchToBAfter(action: string, afterWrite = false) {
      switchAfter = action;
      if (afterWrite) refusal = 'drive_account_changed_after_write';
    },
    switchTo(account: Account) {
      current = account;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(GUARD_TIME));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Safari upload when the Voyager app signs in another account midway', () => {
  it('reports what reached the old account, and Undo restores it there and nowhere else', async () => {
    const d = await createGuardDevice({ safari: true });
    const cloudFolders = guardEnvelope('folders', guardFolders(1));
    const cloudPrompts = guardEnvelope('prompts', [guardPrompt('cloud')]);
    d.drive.put(guardFiles.folders, cloudFolders);
    d.drive.put(guardFiles.prompts, cloudPrompts);
    d.setLocal('folders', 2);
    d.setLocal('prompts', 2);
    const app = voyagerAppAccounts();
    // The first sync file lands on A; the app signs in B before the next one.
    app.switchToBAfter('googleDriveUploadFile');

    const reply = await d.request();

    expect(reply).toMatchObject({ ok: false, error: 'account_changed', partial: true });
    const receipt = parseCloudUploadReceipt((reply as { uploadReceipt?: unknown }).uploadReceipt);
    expect(receipt).toMatchObject({ complete: true, driveAccount: accountName('a') });
    expect(receipt?.files).toHaveLength(1);
    const [written] = receipt?.files ?? [];
    expect(written).toMatchObject({ name: guardFiles.folders, replaced: { kind: 'history' } });
    expect(d.drive.payload(guardFiles.folders)).toMatchObject({ data: guardFolders(2) });
    expect(d.drive.payload(guardFiles.prompts)).toEqual(cloudPrompts);
    expect(app.reachedB).toEqual([]);

    // The panel's Undo, while the app holds B: refused before anything is written.
    const payload: CloudSyncPayload = {
      platform: 'gemini',
      selection: 'all',
      accountScope: null,
      timelineHierarchyAccountScope: null,
      highlightAccountScope: null,
      includeHighlights: false,
    };
    const undo = () =>
      undoRowUpload(
        (message) => d.request(message.type, message.payload as Record<string, unknown>),
        payload,
        receipt!,
      );
    const writes = [...d.drive.writes];
    await expect(undo()).resolves.toEqual({
      restored: 0,
      kept: 0,
      failed: 1,
      accountChanged: true,
    });
    expect(d.drive.writes).toEqual(writes);
    expect(app.reachedB).toEqual([]);

    // Back on A, Undo puts A's previous version back.
    app.switchTo('a');
    await expect(undo()).resolves.toEqual({
      restored: 1,
      kept: 0,
      failed: 0,
      accountChanged: false,
    });
    expect(d.drive.payload(guardFiles.folders)).toEqual(cloudFolders);
  });

  it('offers no Undo when the refused action may already have written to the old account', async () => {
    const d = await createGuardDevice({ safari: true });
    d.drive.put(guardFiles.folders, guardEnvelope('folders', guardFolders(1)));
    d.drive.put(guardFiles.prompts, guardEnvelope('prompts', [guardPrompt('cloud')]));
    d.setLocal('folders', 2);
    d.setLocal('prompts', 2);
    const app = voyagerAppAccounts();
    app.switchToBAfter('googleDriveUploadFile', true);

    const reply = await d.request();

    expect(reply).toMatchObject({ ok: false, error: 'account_changed', partial: true });
    const receipt = parseCloudUploadReceipt((reply as { uploadReceipt?: unknown }).uploadReceipt);
    expect(receipt).toMatchObject({ complete: false, driveAccount: accountName('a') });
    expect(receipt?.files.map(({ name }) => name)).toEqual([guardFiles.folders]);
    expect(app.reachedB).toEqual([]);
  });
});
