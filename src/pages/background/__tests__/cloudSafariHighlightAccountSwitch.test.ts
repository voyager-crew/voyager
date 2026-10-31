import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseUploadReply } from '@/core/services/cloudSyncTransferReplies';
import { StorageKeys } from '@/core/types/common';
import { HIGHLIGHT_EXPORT_FORMAT, type HighlightExportPayloadV1 } from '@/core/types/highlight';
import { hashString } from '@/core/utils/hash';

import {
  createGuardDevice,
  guardEnvelope,
  guardFiles,
  guardFolders,
  guardPrompt,
  GUARD_TIME,
  interceptGuardNative,
  scopedGuardFile,
} from './fixtures/uploadGuardDevice';

const scope = { accountKey: 'email:highlight-person', accountId: 1, routeUserId: '1' };
const highlightsFile = scopedGuardFile('gemini-voyager-highlights.json', scope);

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

describe('Safari upload receipts after highlights end the session', () => {
  it.each(['upload', 'verification'] as const)(
    'keeps the main files written to A when highlights %s is refused on B',
    async (phase) => {
      const d = await createGuardDevice({ safari: true });
      d.values[StorageKeys.HIGHLIGHT_CLOUD_SYNC_ENABLED] = true;
      d.drive.put(guardFiles.folders, guardEnvelope('folders', guardFolders(1)));
      d.drive.put(guardFiles.prompts, guardEnvelope('prompts', [guardPrompt('cloud')]));
      d.drive.put(highlightsFile, {
        format: HIGHLIGHT_EXPORT_FORMAT,
        version: '2.2.1',
        exportedAt: GUARD_TIME,
        accountScope: { platform: 'gemini', accountHash: hashString(scope.accountKey) },
        items: [],
      } satisfies HighlightExportPayloadV1);
      d.setLocal('folders', 2);
      d.setLocal('prompts', 2);
      let currentAccount = 'account-a';
      let highlightsWritten = false;
      const refused: string[] = [];
      const reachedB: string[] = [];
      const refusedAction =
        phase === 'upload' ? 'googleDriveUploadFile' : 'googleDriveDownloadFile';
      interceptGuardNative(async (message, next) => {
        const action = String(message.action);
        if (!action.startsWith('googleDrive') || action === 'googleDriveGetSession')
          return next(message);
        if (
          message.fileID === highlightsFile &&
          action === refusedAction &&
          (phase === 'upload' || highlightsWritten)
        )
          currentAccount = 'account-b';
        const { expectedDriveAccount, ...forwarded } = message;
        if (expectedDriveAccount && expectedDriveAccount !== currentAccount) {
          refused.push(action);
          return { success: false, code: 'drive_account_changed', error: 'Account changed' };
        }
        if (currentAccount === 'account-b') {
          reachedB.push(action);
          throw new Error(`B's Drive was asked to ${action}`);
        }
        const response = await next(forwarded);
        if (action === 'googleDriveUploadFile' && message.fileID === highlightsFile)
          highlightsWritten = true;
        return response && typeof response === 'object' && 'success' in response && response.success
          ? { ...response, driveAccount: currentAccount }
          : response;
      });

      const reply = parseUploadReply(
        await d.request('gv.sync.upload', {
          includeHighlights: true,
          highlightAccountScope: scope,
        }),
      );

      expect(refused).toEqual([refusedAction]);
      expect(reachedB).toEqual([]);
      expect(d.drive.payload(guardFiles.folders)).toMatchObject({ data: guardFolders(2) });
      expect(d.drive.payload(guardFiles.prompts)).toMatchObject({
        items: [guardPrompt('prompt-0'), guardPrompt('prompt-1')],
      });
      expect(reply).toMatchObject({
        kind: 'failed',
        error: 'account_changed',
        partial: true,
        uploadReceipt: {
          complete: true,
          driveAccount: 'account-a',
          files: expect.arrayContaining([
            expect.objectContaining({ name: guardFiles.folders }),
            expect.objectContaining({ name: guardFiles.prompts }),
          ]),
        },
      });
    },
  );
});
