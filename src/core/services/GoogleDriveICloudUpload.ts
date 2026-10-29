import type { CloudUploadWrittenFile } from '@/core/types/syncUploadReceipt';
import { isSafariICloudConflictError } from '@/core/utils/safariICloudSync';
import { readICloudUploadVersion, writeICloudUpload } from '@/core/utils/safariICloudUploadReceipt';

/** CloudKit supports a real record-change-tag condition; refresh the plan after a conflict. */
export async function uploadICloudWithReceipt(
  name: string,
  payload: unknown,
): Promise<{ receipt: CloudUploadWrittenFile; previousText: string | null }> {
  for (let attempt = 0; ; attempt++) {
    const current = await readICloudUploadVersion(name);
    try {
      return {
        receipt: await writeICloudUpload(name, payload, current.version),
        previousText: current.json,
      };
    } catch (error) {
      if (!isSafariICloudConflictError(error) || attempt === 2) throw error;
    }
  }
}
