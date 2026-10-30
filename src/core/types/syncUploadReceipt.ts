/** One cloud mutation, identified by its own write response rather than a later status query. */
export interface CloudUploadWrittenFile {
  name: string;
  fileId: string;
  md5Checksum: string;
  replaced: { kind: 'history'; historyId: string } | { kind: 'created' };
}

export interface CloudUploadReceipt {
  files: CloudUploadWrittenFile[];
  /** False means at least one attempted mutation lacks a confirmed, reversible receipt. */
  complete: boolean;
  /** Safari Drive: the Google account the files were written to; Undo runs only there. */
  driveAccount?: string;
}

export function parseCloudUploadReceipt(value: unknown): CloudUploadReceipt | null {
  if (
    !value ||
    typeof value !== 'object' ||
    !('complete' in value) ||
    typeof value.complete !== 'boolean' ||
    !('files' in value) ||
    !Array.isArray(value.files)
  )
    return null;
  const files: CloudUploadWrittenFile[] = [];
  const names = new Set<string>();
  const candidates: unknown[] = value.files;
  for (const raw of candidates) {
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('name' in raw) ||
      typeof raw.name !== 'string' ||
      !raw.name ||
      !('fileId' in raw) ||
      typeof raw.fileId !== 'string' ||
      !raw.fileId ||
      !('md5Checksum' in raw) ||
      typeof raw.md5Checksum !== 'string' ||
      !raw.md5Checksum ||
      !('replaced' in raw) ||
      !raw.replaced ||
      typeof raw.replaced !== 'object' ||
      !('kind' in raw.replaced) ||
      names.has(raw.name)
    )
      return null;
    const replaced = raw.replaced;
    if (replaced.kind === 'created')
      files.push({
        name: raw.name,
        fileId: raw.fileId,
        md5Checksum: raw.md5Checksum,
        replaced: { kind: 'created' },
      });
    else if (
      replaced.kind === 'history' &&
      'historyId' in replaced &&
      typeof replaced.historyId === 'string' &&
      replaced.historyId
    )
      files.push({
        name: raw.name,
        fileId: raw.fileId,
        md5Checksum: raw.md5Checksum,
        replaced: { kind: 'history', historyId: replaced.historyId },
      });
    else return null;
    names.add(raw.name);
  }
  if (!('driveAccount' in value)) return { files, complete: value.complete };
  if (typeof value.driveAccount !== 'string' || !value.driveAccount) return null;
  return { files, complete: value.complete, driveAccount: value.driveAccount };
}
