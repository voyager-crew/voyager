import { expect, it, vi } from 'vitest';

import type { CloudSyncPayload } from '@/core/services/CloudSyncTransferContext';
import { scopedDriveFileName } from '@/core/services/GoogleDriveIdentity';
import type { FakeSyncDrive } from '@/core/services/__tests__/fixtures/fakeSyncDrive';
import type { CloudUploadWrittenFile } from '@/core/types/syncUploadReceipt';
import { hashString } from '@/core/utils/hash';

import { restoreRowFiles } from '../sync/syncTransfer';
import { undoRowUpload } from '../sync/syncUploadUndo';
import { GEMINI, extensionApi } from './panelHarness';
import { FOLDER_FILES, folderEnvelope, folders, startSyncBackground } from './panelSyncHarness';

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./panelBrowserApi')).extensionApi,
}));

function history(
  drive: FakeSyncDrive,
  name: string,
  previous: unknown,
  current: unknown,
): CloudUploadWrittenFile {
  drive.put(name, current);
  const id = name.replace('.json', '.backup-2026-10-28-120000.json');
  drive.put(id, previous);
  const metadata = drive.metadata.get(id);
  if (!metadata) throw new Error('The seeded history has no metadata');
  drive.metadata.set(id, { ...metadata, appProperties: { voyagerHistorySource: name } });
  const currentMetadata = drive.metadata.get(name);
  if (!currentMetadata?.md5Checksum) throw new Error('The current file has no checksum');
  return {
    name,
    fileId: currentMetadata.id,
    md5Checksum: currentMetadata.md5Checksum,
    replaced: { kind: 'history', historyId: id },
  };
}

it.each(
  ['restore previous', 'undo upload'].flatMap((action) =>
    [false, true].map((fallback) => ({ action, fallback })),
  ),
)(
  '$action keeps actual file scopes with folder isolation off (writer fallback=$fallback)',
  async ({ action, fallback }) => {
    const { drive } = await startSyncBackground({ context: GEMINI });
    const folderScope = { accountKey: 'email:folder-person', accountId: 3, routeUserId: '0' };
    const hierarchyScope = fallback
      ? folderScope
      : { accountKey: 'email:hierarchy-person', accountId: 1, routeUserId: '0' };
    const highlightScope = fallback
      ? folderScope
      : { accountKey: 'email:highlight-person', accountId: 2, routeUserId: '0' };
    const payload: CloudSyncPayload = {
      platform: 'gemini',
      selection: 'site',
      accountScope: fallback ? folderScope : null,
      timelineHierarchyAccountScope: fallback ? null : hierarchyScope,
      highlightAccountScope: fallback ? null : highlightScope,
      includeHighlights: true,
    };
    const hierarchyName = scopedDriveFileName(
      'gemini-voyager-timeline-hierarchy.json',
      hierarchyScope.accountKey,
    );
    const highlightName = scopedDriveFileName(
      'gemini-voyager-highlights.json',
      highlightScope.accountKey,
    );
    const previousFolders = folderEnvelope('gemini', folders('gemini', 'G', ['previous']));
    const previousHierarchy = {
      format: 'gemini-voyager.timeline-hierarchy.v1',
      exportedAt: '2026-10-28T00:00:00.000Z',
      version: '2.2.1',
      data: { conversations: {} },
    };
    const previousHighlights = {
      format: 'gemini-voyager.annotations.v1',
      exportedAt: '2026-10-28T00:00:00.000Z',
      version: '2.2.1',
      accountScope: { platform: 'gemini', accountHash: hashString(highlightScope.accountKey) },
      items: [],
    };
    const written = [
      history(
        drive,
        FOLDER_FILES.gemini,
        previousFolders,
        folderEnvelope('gemini', folders('gemini', 'G', ['current'])),
      ),
      history(drive, hierarchyName, previousHierarchy, { ...previousHierarchy, version: '2.2.2' }),
      history(drive, highlightName, previousHighlights, {
        ...previousHighlights,
        version: '2.2.2',
      }),
    ];

    const result =
      action === 'restore previous'
        ? await restoreRowFiles(
            extensionApi.runtime.sendMessage,
            payload,
            written.map((file) => file.name),
          )
        : await undoRowUpload(extensionApi.runtime.sendMessage, payload, {
            files: written,
            complete: true,
          });

    expect(result).toMatchObject({ restored: 3, failed: 0 });
    expect(drive.payload(FOLDER_FILES.gemini)).toEqual(previousFolders);
    expect(drive.payload(hierarchyName)).toEqual(previousHierarchy);
    expect(drive.payload(highlightName)).toEqual(previousHighlights);
  },
);
