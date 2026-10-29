import browser from 'webextension-polyfill';

/**
 * The sheet's side of the phase 3 sync messages. The panel page sends them as
 * itself: the background treats its redeemed frame as an extension page and
 * reads the page and account from the session's tab. Every reply is parsed
 * here from `unknown`; nothing raw reaches the UI.
 */
export type RowStatus =
  | 'synced'
  | 'newer_here'
  | 'newer_in_cloud'
  | 'not_uploaded'
  | 'to_merge'
  | 'excluded'
  | 'account_unconfirmed'
  | 'failed';

export interface StatusFile {
  readonly name: string;
  readonly status: RowStatus;
  /** Drive's checksum of the cloud copy; null when the cloud has none. */
  readonly md5: string | null;
  readonly syncedAt: number | null;
}

export interface StatusRow {
  readonly row: string;
  readonly included: boolean;
  readonly status: RowStatus;
  readonly bothChanged: boolean;
  readonly files: readonly StatusFile[];
}

export interface Connection {
  readonly connected: boolean;
  readonly provider: string;
  readonly mode: string;
  /** The newest transfer time the sync state records, for the footer before any status. */
  readonly lastTransferAt: number | null;
}

export type SyncSend = (message: { type: string; payload?: unknown }) => Promise<unknown>;

export const sendSync: SyncSend = (message) => browser.runtime.sendMessage(message);

const STATUSES: readonly RowStatus[] = [
  'synced',
  'newer_here',
  'newer_in_cloud',
  'not_uploaded',
  'to_merge',
  'excluded',
  'account_unconfirmed',
  'failed',
];

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

const status = (value: unknown): RowStatus | null =>
  STATUSES.find((candidate) => candidate === value) ?? null;

const time = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

function parseFile(value: unknown): StatusFile | null {
  const file = record(value);
  const fileStatus = status(file?.status);
  if (!file || typeof file.name !== 'string' || !fileStatus) return null;
  const metadata = record(file.metadata);
  return {
    name: file.name,
    status: fileStatus,
    md5: typeof metadata?.md5Checksum === 'string' ? metadata.md5Checksum : null,
    syncedAt: time(file.syncedAt),
  };
}

export function parseStatusRows(value: unknown): StatusRow[] | null {
  const reply = record(value);
  if (!reply || !Array.isArray(reply.rows)) return null;
  return reply.rows.flatMap((raw: unknown) => {
    const row = record(raw);
    const rowStatus = status(row?.status);
    if (!row || typeof row.row !== 'string' || !rowStatus) return [];
    const files = Array.isArray(row.files) ? row.files.map(parseFile) : [];
    return [
      {
        row: row.row,
        included: row.included !== false,
        status: rowStatus,
        bothChanged: row.bothChanged === true,
        files: files.filter((file): file is StatusFile => file !== null),
      },
    ];
  });
}

export function parseConnection(value: unknown): Connection | null {
  const state = record(record(value)?.state);
  if (!state) return null;
  const times = Object.entries(state)
    .filter(([key]) => /^last(?:Sync|Upload)Time/.test(key))
    .map(([, stamp]) => time(stamp))
    .filter((stamp): stamp is number => stamp !== null);
  const provider = typeof state.provider === 'string' ? state.provider : 'googleDrive';
  const mode = typeof state.mode === 'string' ? state.mode : 'disabled';
  return {
    connected: provider === 'googleDrive' && mode !== 'disabled' && state.isAuthenticated === true,
    provider,
    mode,
    lastTransferAt: times.length ? Math.max(...times) : null,
  };
}

/** Per-file results of restoring the previous cloud version. */
export function parseRestoredFiles(
  value: unknown,
): { name: string; restored: boolean; kept: boolean }[] {
  const files = record(value)?.files;
  if (!Array.isArray(files)) return [];
  return files.flatMap((raw: unknown) => {
    const file = record(raw);
    return file && typeof file.name === 'string'
      ? [
          {
            name: file.name,
            restored: file.status === 'restored' || file.status === 'removed',
            kept: file.status === 'kept',
          },
        ]
      : [];
  });
}
