import { describe, expect, it, vi } from 'vitest';

import type { HighlightAccountSnapshot } from '@/core/services/HighlightAnnotationService';
import type {
  HighlightDrivePort,
  HighlightLocalPort,
} from '@/core/services/HighlightDriveSyncCoordinator';
import { HighlightDriveSyncCoordinator } from '@/core/services/HighlightDriveSyncCoordinator';
import type { HighlightExportPayloadV1, HighlightRecordV1 } from '@/core/types/highlight';
import type { SyncAccountScope } from '@/core/types/sync';

const accountScope: SyncAccountScope = {
  accountKey: 'route:1',
  accountId: 1,
  routeUserId: '1',
};

const record: HighlightRecordV1 = {
  id: 'highlight-one',
  schemaVersion: 1,
  platform: 'gemini',
  accountHash: 'account-hash',
  conversationId: 'conversation-one',
  conversationUrl: 'https://gemini.google.com/u/1/app/abc',
  turnId: 'turn-one',
  role: 'assistant',
  anchor: {
    quote: { exact: 'selected text', prefix: '', suffix: '' },
    position: { start: 0, end: 13 },
    sourceTextHash: 'source-hash',
  },
  color: 'yellow',
  createdAt: 1,
  updatedAt: 1,
  revision: { counter: 1, deviceId: 'device-one' },
};

const remotePayload: HighlightExportPayloadV1 = {
  format: 'gemini-voyager.annotations.v1',
  exportedAt: '2026-07-12T00:00:00.000Z',
  version: '1.5.5',
  accountScope: { platform: 'gemini', accountHash: 'account-hash' },
  items: [record],
};

function createPorts(remote: HighlightExportPayloadV1 | null = remotePayload): {
  drive: HighlightDrivePort;
  local: HighlightLocalPort;
} {
  const snapshot: HighlightAccountSnapshot = {
    accountScope: remotePayload.accountScope,
    records: [record],
  };
  return {
    drive: {
      kind: 'sync-turn',
      downloadHighlightsOnly: vi.fn().mockResolvedValue(remote),
      uploadHighlightsOnly: vi.fn().mockResolvedValue(true),
      getState: vi.fn().mockResolvedValue({ error: null }),
    },
    local: {
      getAccountSnapshot: vi.fn().mockResolvedValue(snapshot),
      importMerge: vi.fn().mockResolvedValue({
        imported: 1,
        updated: 0,
        duplicates: 0,
        skippedByClearMarker: 0,
        total: 1,
      }),
    },
  };
}

async function drivePush(coordinator: HighlightDriveSyncCoordinator, scope: SyncAccountScope) {
  const plan = await coordinator.preparePush(scope);
  return plan.ok ? plan.commit() : plan.result;
}

describe('HighlightDriveSyncCoordinator', () => {
  it('pulls and merges a strict account-scoped payload', async () => {
    const { drive, local } = createPorts();
    const result = await new HighlightDriveSyncCoordinator(drive, local).pull(accountScope);

    expect(result).toMatchObject({ ok: true, count: 1 });
    expect(local.importMerge).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'gemini', accountKey: 'route:1' }),
      [record],
      { clearMarker: undefined },
    );
  });

  it('downloads and merges before uploading the converged payload', async () => {
    const { drive, local } = createPorts();
    const result = await drivePush(new HighlightDriveSyncCoordinator(drive, local), accountScope);

    expect(result).toMatchObject({ ok: true, count: 1 });
    expect(local.importMerge).toHaveBeenCalledTimes(2);
    expect(drive.uploadHighlightsOnly).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'gemini-voyager.annotations.v1',
        items: [record],
      }),
      accountScope,
      true,
    );
    expect(vi.mocked(local.importMerge).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(drive.uploadHighlightsOnly).mock.invocationCallOrder[0],
    );
  });

  it('treats a missing remote file as an empty pull and still allows first push', async () => {
    const { drive, local } = createPorts(null);
    vi.mocked(drive.downloadHighlightsOnly)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(remotePayload);
    const coordinator = new HighlightDriveSyncCoordinator(drive, local);

    await expect(coordinator.pull(accountScope)).resolves.toMatchObject({
      ok: true,
      empty: true,
    });
    await expect(drivePush(coordinator, accountScope)).resolves.toMatchObject({
      ok: true,
      count: 1,
    });
    expect(local.importMerge).toHaveBeenCalledOnce();
    expect(drive.uploadHighlightsOnly).toHaveBeenCalledOnce();
  });

  it('re-merges and retries when post-upload verification misses a local revision', async () => {
    const { drive, local } = createPorts();
    const emptyPayload: HighlightExportPayloadV1 = { ...remotePayload, items: [] };
    vi.mocked(drive.downloadHighlightsOnly)
      .mockResolvedValueOnce(remotePayload)
      .mockResolvedValueOnce(emptyPayload)
      .mockResolvedValueOnce(remotePayload);

    const result = await drivePush(new HighlightDriveSyncCoordinator(drive, local), accountScope);

    expect(result).toMatchObject({ ok: true, count: 1 });
    expect(drive.uploadHighlightsOnly).toHaveBeenCalledTimes(2);
    expect(local.importMerge).toHaveBeenCalledTimes(3);
  });

  it('does not upload when the remote download failed', async () => {
    const { drive, local } = createPorts(null);
    vi.mocked(drive.getState).mockResolvedValue({ error: 'Drive unavailable' });

    const result = await drivePush(new HighlightDriveSyncCoordinator(drive, local), accountScope);
    expect(result).toEqual({ ok: false, count: 0, error: 'Drive unavailable' });
    expect(drive.uploadHighlightsOnly).not.toHaveBeenCalled();
  });
});
