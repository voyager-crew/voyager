import type { DriveHistoryFile } from '@/core/types/driveHistory';

import type { DriveFilesPort } from './GoogleDriveFiles';
import { isRecognizedHistoryContent } from './GoogleDriveHistoryPayload';

/** The approved D3 pattern; its UTC timestamp has second precision. */
export const DRIVE_HISTORY_NAME_PATTERN = '{source}.backup-{utc}.json';
export const DRIVE_HISTORY_KEEP_COUNT = 3;

export type DriveHistoryPort = Pick<
  DriveFilesPort,
  'supportsHistory' | 'downloadText' | 'createHistory' | 'listHistory' | 'trash'
>;

export interface PreparedDriveHistory {
  current: string | null;
  entries: DriveHistoryFile[];
  recognized: Array<{ entry: DriveHistoryFile; text: string }>;
  archived: Map<string, string>;
}

export function newestHistoryFirst(entries: readonly DriveHistoryFile[]): DriveHistoryFile[] {
  return [...entries].sort(
    (a, b) =>
      Date.parse(b.createdTime) - Date.parse(a.createdTime) ||
      b.name.localeCompare(a.name) ||
      b.id.localeCompare(a.id),
  );
}

function formatUtc(milliseconds: number): string {
  return new Date(milliseconds).toISOString().slice(0, 19).replace('T', '-').replaceAll(':', '');
}

function nextHistoryName(source: string, entries: readonly DriveHistoryFile[]): string {
  const used = new Set(entries.map((entry) => entry.name));
  const pattern = DRIVE_HISTORY_NAME_PATTERN.replace('{source}', source.replace(/\.json$/, ''));
  const [prefix, suffix] = pattern.split('{utc}');
  let milliseconds = Math.floor(Date.now() / 1000) * 1000;
  for (const entry of entries) {
    if (!entry.name.startsWith(prefix) || !entry.name.endsWith(suffix)) continue;
    const stamp = entry.name.slice(prefix.length, -suffix.length);
    const iso = stamp.replace(/^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})(\d{2})$/, '$1T$2:$3:$4Z');
    const previous = Date.parse(iso);
    if (Number.isFinite(previous) && formatUtc(previous) === stamp) {
      // Names are inspected only after marker-based discovery. Advancing beyond retained
      // timestamps prevents reusing a pruned same-second name on the fifth upload.
      milliseconds = Math.max(milliseconds, previous + 1000);
    }
  }
  for (;;) {
    const name = pattern.replace('{utc}', formatUtc(milliseconds));
    if (!used.has(name)) return name;
    milliseconds += 1000;
  }
}

/** Raw media and source metadata are read before any upload operation starts committing. */
export class GoogleDriveUploadHistory {
  constructor(private readonly files: DriveHistoryPort) {}

  async prepare(token: string, source: string, id: string | null): Promise<PreparedDriveHistory> {
    if (!this.files.supportsHistory())
      return { current: null, entries: [], recognized: [], archived: new Map() };
    const current = id ? await this.files.downloadText(token, id) : null;
    const entries = await this.files.listHistory(token, source);
    const recognized: PreparedDriveHistory['recognized'] = [];
    const archived = new Map<string, string>();
    for (const entry of newestHistoryFirst(entries)) {
      const text = await this.files.downloadText(token, entry.id);
      if (text !== null) archived.set(entry.id, text);
      if (text && isRecognizedHistoryContent(source, text)) recognized.push({ entry, text });
    }
    return { current, entries, recognized, archived };
  }

  async preserve(
    token: string,
    source: string,
    plan: PreparedDriveHistory,
    includeEmpty = false,
  ): Promise<DriveHistoryFile | null> {
    if (plan.current === null || (!includeEmpty && !plan.current) || !this.files.supportsHistory())
      return null;
    const latest = newestHistoryFirst(plan.entries)[0];
    if (latest && plan.archived.get(latest.id) === plan.current) return latest;
    const entry = await this.files.createHistory(
      token,
      nextHistoryName(source, plan.entries),
      source,
      plan.current,
    );
    plan.entries.push(entry);
    plan.archived.set(entry.id, plan.current);
    if (isRecognizedHistoryContent(source, plan.current)) {
      plan.recognized.push({ entry, text: plan.current });
    }
    return entry;
  }

  /** Failed replacements must never evict the actual previous versions. */
  async retain(token: string, plan: PreparedDriveHistory): Promise<void> {
    const discarded = newestHistoryFirst(plan.recognized.map(({ entry }) => entry)).slice(
      DRIVE_HISTORY_KEEP_COUNT,
    );
    for (const stale of discarded) await this.files.trash(token, stale.id);
    const trashed = new Set(discarded.map(({ id }) => id));
    for (const id of trashed) plan.archived.delete(id);
    plan.entries = plan.entries.filter(({ id }) => !trashed.has(id));
    plan.recognized = plan.recognized.filter(({ entry }) => !trashed.has(entry.id));
  }
}
