import browser from 'webextension-polyfill';

import { isUndoneCloudSyncValue } from './CloudSyncUndoMarkers';
import { logger } from './LoggerService';

export interface BackupRecoveryCopy {
  readonly key: string;
  readonly source: 'page' | 'durable';
  readonly serialized: string;
}

export interface ParsedBackup<T> {
  readonly data: T;
  readonly timestamp: number;
}

/** The page slot and the hydrated durable cache are independent copies. */
export function readBackupRecoveryCopies(
  key: string,
  durableBackups: ReadonlyMap<string, string>,
): BackupRecoveryCopy[] {
  const copies: BackupRecoveryCopy[] = [];
  try {
    const serialized = localStorage.getItem(key);
    if (serialized) copies.push({ key, source: 'page', serialized });
  } catch {
    /* A durable copy can recover while page storage is unavailable. */
  }
  const serialized = durableBackups.get(key);
  if (serialized) copies.push({ key, source: 'durable', serialized });
  return copies;
}

/** Marker checks cross contexts: the hydrated cache cannot prove a slot is still current. */
export async function readLiveBackupRecoveryCopies(
  keys: readonly string[],
): Promise<BackupRecoveryCopy[]> {
  const stored = await browser.storage.local.get([...keys]);
  const durable = new Map<string, string>();
  for (const key of keys) {
    const value: unknown = stored[key];
    if (typeof value === 'string') durable.set(key, value);
  }
  return keys.flatMap((key) => readBackupRecoveryCopies(key, durable));
}

/** Only the page copy supports compare-delete in one synchronous task. */
export async function removeUndoneBackupCopy(
  copy: BackupRecoveryCopy,
  store: {
    version(key: string): number;
    isCurrent(key: string, version: number): boolean;
    write(operation: () => void): void | Promise<void>;
  },
): Promise<void> {
  // Undo/capture asks the background backup owner to compare-delete durable copies.
  // Recovery here only owns page storage; retained suppression also covers cleanup failures.
  if (copy.source === 'durable') return;
  const version = store.version(copy.key);
  try {
    await store.write(() => {
      if (!store.isCurrent(copy.key, version)) return;
      if (localStorage.getItem(copy.key) === copy.serialized) localStorage.removeItem(copy.key);
    });
  } catch (error) {
    // Cleanup failure must still leave matching data ineligible for recovery.
    logger.warn('Could not remove an undone backup copy', { key: copy.key, error: String(error) });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Both recovery entry points keep the existing age and owner-data validation. */
export function parseBackupRecoveryData<T>(
  serialized: string,
  options: { maxAge: number; validateData: (value: T) => boolean },
): ParsedBackup<T> | null {
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value) || !isRecord(value.metadata) || !('data' in value)) return null;
    const stamp = value.metadata.timestamp;
    if (typeof stamp !== 'string' && typeof stamp !== 'number') return null;
    const timestamp = new Date(stamp).getTime();
    const age = Date.now() - timestamp;
    if (!Number.isFinite(age) || age < 0 || age > options.maxAge) return null;
    // The service's supplied owner validator proves the generic backup payload.
    if (!options.validateData(value.data as T)) return null;
    return { data: value.data as T, timestamp };
  } catch {
    return null;
  }
}

type Candidate<T> = BackupRecoveryCopy & ParsedBackup<T>;

/** Continuous backup refreshes yield to the repository's existing read backoff. */
const RECOVERY_ATTEMPTS = 3;

function copyIdentity(copy: BackupRecoveryCopy): string {
  return JSON.stringify([copy.key, copy.source, copy.serialized]);
}

function copySetIdentity(copies: readonly BackupRecoveryCopy[]): string {
  return JSON.stringify(copies.map(copyIdentity).sort());
}

/**
 * Keep slot priority and choose the newest allowed copy within each slot.
 * A hash may outlast a page edit: discard that observation and inspect the
 * current copies again instead of deleting or recovering an older observation.
 */
export async function recoverBackupForKey<T>(options: {
  storageKey: string;
  slots: readonly string[];
  readCopies(): Promise<readonly BackupRecoveryCopy[]>;
  parse(serialized: string): ParsedBackup<T> | null;
  removeRejected(copy: BackupRecoveryCopy): Promise<void>;
  canRecover(): boolean;
}): Promise<T | null> {
  const candidates = async (): Promise<Candidate<T>[]> =>
    (await options.readCopies()).flatMap((copy) => {
      const parsed = options.parse(copy.serialized);
      return parsed ? [{ ...copy, ...parsed }] : [];
    });
  recovery: for (let attempt = 0; attempt < RECOVERY_ATTEMPTS; attempt += 1) {
    if (!options.canRecover()) return null;
    const observed = await candidates();
    if (!options.canRecover()) return null;
    for (const [index, key] of options.slots.entries()) {
      const slot = observed.filter((copy) => copy.key === key);
      slot.sort((a, b) => b.timestamp - a.timestamp);
      for (const candidate of slot) {
        const undone = await isUndoneCloudSyncValue({
          area: 'local',
          key: options.storageKey,
          value: candidate.data,
        });
        if (!options.canRecover()) return null;
        if (undone) {
          await options.removeRejected(candidate);
          if (!options.canRecover()) return null;
          continue;
        }
        // Re-read the whole prefix together: a primary may arrive while checking a fallback.
        const prefix = new Set(options.slots.slice(0, index + 1));
        const prefixIdentity = (copies: readonly BackupRecoveryCopy[]) =>
          copySetIdentity(copies.filter((copy) => prefix.has(copy.key)));
        const current = await candidates();
        if (!options.canRecover()) return null;
        if (prefixIdentity(current) !== prefixIdentity(observed)) continue recovery;
        return candidate.data;
      }
    }
    const current = await candidates();
    if (!options.canRecover()) return null;
    if (copySetIdentity(current) === copySetIdentity(observed)) return null;
  }
  // A failed verification must never fall through to unverified memory or older backups.
  throw new Error('Backup copies kept changing during recovery');
}
