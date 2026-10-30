import type { CloudSyncPayload } from '@/core/services/CloudSyncTransferContext';
import type { CloudUploadReceipt } from '@/core/types/syncUploadReceipt';

import { historyTargets } from './syncHistoryTargets';
import { type SyncSend, parseRestoredFiles } from './syncProtocol';

/**
 * Exact upload Undo: the backend rechecks each receipted version immediately before mutation.
 * `accountChanged`: Drive is signed in to another account than the one the upload wrote to.
 */
export async function undoRowUpload(
  send: SyncSend,
  payload: CloudSyncPayload,
  uploadReceipt: CloudUploadReceipt,
): Promise<{ restored: number; kept: number; failed: number; accountChanged: boolean }> {
  const files = uploadReceipt.files.map((file) => file.name);
  if (!files.length) return { restored: 0, kept: 0, failed: 0, accountChanged: false };
  const reply = await send({
    type: 'gv.sync.restorePreviousVersion',
    payload: {
      files,
      targets: historyTargets(payload, files),
      platform: payload.platform,
      uploadReceipt,
      interactive: true,
    },
  }).catch(() => undefined);
  const results = new Map(parseRestoredFiles(reply).map((file) => [file.name, file]));
  let restored = 0;
  let kept = 0;
  for (const name of files) {
    const result = results.get(name);
    if (result?.restored) restored += 1;
    else if (result?.kept) kept += 1;
  }
  const accountChanged =
    typeof reply === 'object' &&
    reply !== null &&
    'error' in reply &&
    reply.error === 'account_changed';
  return { restored, kept, failed: files.length - restored - kept, accountChanged };
}
