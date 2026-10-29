/** Stable UI reasons; Error.message and persisted state.error remain diagnostic text. */
const CLOUD_SYNC_FAILURE_CODES = [
  'upload_guard_refused',
  'account_unconfirmed',
  'account_changed',
  'download_cancelled',
  'sync_scope_excluded',
  'local_read_failed',
  'cloud_read_failed',
  'metadata_read_failed',
  'invalid_drive_metadata',
  'invalid_sync_payload',
  'snapshot_failed',
  'snapshot_receipt_failed',
  'snapshot_superseded',
  'highlight_upload_failed',
  'sync_metadata_unavailable',
  'stale_download',
  'invalid_sync_request',
  'sync_bookkeeping_failed',
  'not_authenticated',
  'google_drive_unavailable_on_device',
  'untrusted_sender',
  'invalid_sync_files',
  'unsupported_provider',
  'sync_status_failed',
] as const;

export type CloudSyncFailureCode = (typeof CLOUD_SYNC_FAILURE_CODES)[number];
export const DRIVE_NOT_AUTHENTICATED = 'Not authenticated';

export class CloudSyncFailure extends Error {
  constructor(
    readonly code: CloudSyncFailureCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CloudSyncFailure';
  }
}

function knownCode(value: unknown): CloudSyncFailureCode | undefined {
  return CLOUD_SYNC_FAILURE_CODES.find((code) => code === value);
}

/** Read structured reasons across owners and runtime error wrappers without guessing from prose. */
export function cloudSyncFailureCode(errorOrString: unknown): CloudSyncFailureCode | undefined {
  const seen = new Set<unknown>();
  let error = errorOrString;
  while (error !== undefined && !seen.has(error)) {
    seen.add(error);
    if (error instanceof CloudSyncFailure) return error.code;
    const object = typeof error === 'object' && error !== null ? error : undefined;
    const code = object && 'code' in object ? knownCode(object.code) : undefined;
    if (code) return code;
    const message =
      typeof error === 'string'
        ? error
        : object && 'message' in object
          ? object.message
          : undefined;
    const messageCode = knownCode(message);
    if (messageCode) return messageCode;
    if (message === DRIVE_NOT_AUTHENTICATED) return 'not_authenticated';
    error = object && 'cause' in object ? object.cause : undefined;
  }
  return undefined;
}
