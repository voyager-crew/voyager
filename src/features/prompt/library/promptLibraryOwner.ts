import { recordCloudSyncWrites } from '@/core/services/CloudSyncSnapshotService';
/**
 * The single writer of the prompt library (`gvPromptItems`).
 *
 * chrome.storage has no compare-and-set, so two writers that each read the
 * whole list, change it and write it back drop each other's edits: a template
 * saved on one tab rolls back a prompt edited on another, and two tabs saving
 * at once keep only one. The background therefore applies every routed edit
 * through one queue, re-reading the stored list inside it, as the research
 * pack's owner does.
 *
 * The stored format is unchanged: the same array of prompt objects under the
 * same key. Prompts an op does not touch are written back exactly as read.
 * A stored value that is not a list is never overwritten, except by a restore
 * overwrite, which the user chose to replace the library with a backup.
 */
import { StorageKeys } from '@/core/types/common';
import { getPromptNameComparisonKey, getPromptNameConflictIds } from '@/core/utils/promptName';
import type { PromptItem } from '@/features/backup/types/backup';
import { type Serialize, createWriteQueue } from '@/features/storage/writeQueue';
import { mergePromptsWithStats } from '@/utils/merge';

import { type PromptImportStats, mergeImportedPrompts } from './mergeImportedPrompts';

export const PROMPT_LIBRARY_KEY = StorageKeys.PROMPT_ITEMS;

export interface PromptLibraryArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** Fields an update may change. `pinnedAt: null` unpins and is stored as `null`. */
export interface PromptChanges {
  name?: string;
  text?: string;
  tags?: string[];
  pinnedAt?: number | null;
  updatedAt?: number;
}

export type PromptLibraryOp =
  /** Add new prompts ahead of the library; any whose id, text or name is taken is skipped. */
  | { kind: 'add'; items: PromptItem[] }
  | { kind: 'update'; id: string; changes: PromptChanges }
  | { kind: 'delete'; id: string }
  /** Put the listed prompts in this order, in the places they hold; others stay put. */
  | { kind: 'reorder'; ids: string[] }
  /** The prompts import: merge by id or text, as `mergeImportedPrompts` does. */
  | { kind: 'import'; items: PromptItem[] }
  /**
   * A Drive restore: merge keeps every stored prompt and lets a newer same-id
   * cloud copy win (`mergePromptsWithStats`); overwrite stores the backup's list.
   */
  | { kind: 'restore'; mode: 'merge' | 'overwrite'; items: PromptItem[]; snapshotId?: string }
  /**
   * The one-time copy of a page's legacy localStorage library: stored as given,
   * and only while the key holds nothing at all.
   */
  | { kind: 'seed'; items: unknown[] };

export interface PromptLibraryResult {
  /** Prompts the op added. */
  added: number;
  /** Prompts the op skipped (add) or merged into stored ones (import). */
  skipped: number;
  /** Prompts in the library after the op. */
  total: number;
  /** Prompts whose name another prompt also uses, after the op. */
  nameConflicts: number;
  /** The library as stored after the op, for a writer to adopt as its state. */
  items: unknown[];
}

export interface PromptLibraryOwner {
  apply(op: PromptLibraryOp): Promise<PromptLibraryResult>;
  /** The library as stored now, read in turn with the writes. */
  read(): Promise<unknown[]>;
  /**
   * Run `change` on the freshly read library inside the queue. It returns the
   * list to store, or null to leave storage untouched, and a result.
   */
  transact<T>(change: (stored: unknown[]) => { items: unknown[] | null; result: T }): Promise<T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a stored library holds only prompts a merge can key and keep. */
export function isPromptItemArray(value: unknown): value is PromptItem[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.text === 'string' &&
        Array.isArray(item.tags) &&
        item.tags.every((tag) => typeof tag === 'string') &&
        typeof item.createdAt === 'number',
    )
  );
}

/** How Prompt Manager tells two prompt bodies apart: trimmed, ignoring case. */
export function promptTextKey(text: string): string {
  return text.trim().toLowerCase();
}

function namedPrompts(items: unknown[]): Array<{ id: string; name?: string }> {
  return items.flatMap((item) =>
    isRecord(item) && typeof item.id === 'string'
      ? [{ id: item.id, name: typeof item.name === 'string' ? item.name : undefined }]
      : [],
  );
}

function summarize(items: unknown[], added: number, skipped: number): PromptLibraryResult {
  return {
    added,
    skipped,
    total: items.length,
    nameConflicts: getPromptNameConflictIds(namedPrompts(items)).size,
    items,
  };
}

function addPrompts(stored: unknown[], incoming: PromptItem[]) {
  const records = stored.filter(isRecord);
  const ids = new Set(records.flatMap((item) => (typeof item.id === 'string' ? [item.id] : [])));
  const texts = new Set(
    records.flatMap((item) => (typeof item.text === 'string' ? [promptTextKey(item.text)] : [])),
  );
  const names = new Set(
    records.flatMap((item) =>
      typeof item.name === 'string' && item.name.trim()
        ? [getPromptNameComparisonKey(item.name)]
        : [],
    ),
  );
  const added: PromptItem[] = [];
  for (const item of incoming) {
    const text = promptTextKey(item.text);
    const name = item.name?.trim() ? getPromptNameComparisonKey(item.name) : null;
    if (ids.has(item.id) || texts.has(text) || (name !== null && names.has(name))) continue;
    ids.add(item.id);
    texts.add(text);
    if (name !== null) names.add(name);
    added.push(item);
  }
  if (added.length === 0) return { items: null, result: summarize(stored, 0, incoming.length) };
  // Ahead of the library, as Prompt Manager adds a prompt, in the order given.
  const items = [...added, ...stored];
  return { items, result: summarize(items, added.length, incoming.length - added.length) };
}

function updatePrompt(stored: unknown[], id: string, changes: PromptChanges) {
  const index = stored.findIndex((item) => isRecord(item) && item.id === id);
  if (index < 0) return { items: null, result: summarize(stored, 0, 0) };
  const next: Record<string, unknown> = { ...(stored[index] as Record<string, unknown>) };
  for (const [field, value] of Object.entries(changes)) {
    if (value !== undefined) next[field] = value;
  }
  const items = stored.slice();
  items[index] = next;
  return { items, result: summarize(items, 0, 0) };
}

function deletePrompt(stored: unknown[], id: string) {
  const items = stored.filter((item) => !(isRecord(item) && item.id === id));
  if (items.length === stored.length) return { items: null, result: summarize(stored, 0, 0) };
  return { items, result: summarize(items, 0, 0) };
}

function reorderPrompts(stored: unknown[], ids: string[]) {
  const order = new Map(ids.map((id, position) => [id, position]));
  const rank = (item: unknown): number | undefined =>
    isRecord(item) && typeof item.id === 'string' ? order.get(item.id) : undefined;
  const slots = stored.flatMap((item, index) => (rank(item) === undefined ? [] : [index]));
  const listed = slots.map((index) => stored[index]).sort((a, b) => rank(a)! - rank(b)!);
  const items = stored.slice();
  slots.forEach((slot, position) => {
    items[slot] = listed[position];
  });
  const changed = items.some((item, index) => item !== stored[index]);
  return { items: changed ? items : null, result: summarize(items, 0, 0) };
}

function importPrompts(stored: unknown[], incoming: PromptItem[]) {
  // The import has always treated the stored list as prompts; that is unchanged.
  const merged: PromptImportStats & { items: PromptItem[] } = mergeImportedPrompts(
    stored as PromptItem[],
    incoming,
  );
  return {
    items: merged.items,
    result: {
      added: merged.imported,
      skipped: merged.duplicates,
      total: merged.total,
      nameConflicts: merged.nameConflicts,
      items: merged.items,
    },
  };
}

function restorePrompts(stored: unknown[], mode: 'merge' | 'overwrite', incoming: PromptItem[]) {
  if (mode === 'overwrite') {
    return { items: incoming, result: summarize(incoming, incoming.length, 0) };
  }
  // Merging into an unreadable base would drop it; refuse rather than treat it as empty.
  if (!isPromptItemArray(stored)) throw new Error('The prompt library holds an invalid prompt');
  const { items } = mergePromptsWithStats(stored, incoming);
  const added = items.length - stored.length;
  return { items, result: summarize(items, added, incoming.length - added) };
}

/** Applies an op to a library. Pure: every time an op stores travels in the op. */
export function applyPromptLibraryOp(
  stored: unknown[],
  op: PromptLibraryOp,
): { items: unknown[] | null; result: PromptLibraryResult } {
  switch (op.kind) {
    case 'add':
      return addPrompts(stored, op.items);
    case 'update':
      return updatePrompt(stored, op.id, op.changes);
    case 'delete':
      return deletePrompt(stored, op.id);
    case 'reorder':
      return reorderPrompts(stored, op.ids);
    case 'import':
      return importPrompts(stored, op.items);
    case 'restore':
      return restorePrompts(stored, op.mode, op.items);
    case 'seed':
      // Only reached for an empty library; the owner checks the raw value first.
      return stored.length === 0
        ? { items: op.items, result: summarize(op.items, op.items.length, 0) }
        : { items: null, result: summarize(stored, 0, op.items.length) };
  }
}

export function createPromptLibraryOwner(options: {
  area: PromptLibraryArea;
  /** A queue shared with other owners; a private one by default. */
  serialize?: Serialize;
}): PromptLibraryOwner {
  const serialize = options.serialize ?? createWriteQueue();

  const readRaw = async (): Promise<unknown> =>
    (await options.area.get(PROMPT_LIBRARY_KEY))?.[PROMPT_LIBRARY_KEY];

  const readStored = async (): Promise<unknown[]> => {
    const stored = await readRaw();
    if (stored === undefined) return [];
    if (!Array.isArray(stored)) throw new Error('The prompt library is not a list');
    return stored;
  };

  /** A seed never replaces anything stored, a non-list included, as the migration always skipped it. */
  const seed = (items: unknown[]): Promise<PromptLibraryResult> =>
    serialize(async () => {
      const stored = await readRaw();
      if (stored !== undefined) {
        return summarize(Array.isArray(stored) ? stored : [], 0, items.length);
      }
      await options.area.set({ [PROMPT_LIBRARY_KEY]: items });
      return summarize(items, items.length, 0);
    }, [PROMPT_LIBRARY_KEY]);

  /** A restore overwrite replaces whatever was read, a corrupt value included; a failed read refuses it. */
  const restore = (
    op: Extract<PromptLibraryOp, { kind: 'restore' }>,
  ): Promise<PromptLibraryResult> =>
    serialize(async () => {
      const stored = await readRaw();
      if (op.mode === 'merge' && stored !== undefined && !Array.isArray(stored))
        throw new Error('The prompt library is not a list');
      const { items, result } = restorePrompts(
        Array.isArray(stored) ? stored : [],
        op.mode,
        op.items,
      );
      // Persist undo protection first; receipt failure must leave the library untouched.
      if (op.snapshotId)
        await recordCloudSyncWrites(op.snapshotId, [
          {
            area: 'local',
            key: PROMPT_LIBRARY_KEY,
            kind: 'prompts',
            value: items,
          },
        ]);
      await options.area.set({ [PROMPT_LIBRARY_KEY]: items });
      return result;
    }, [PROMPT_LIBRARY_KEY]);

  const transact = <T>(
    change: (stored: unknown[]) => { items: unknown[] | null; result: T },
  ): Promise<T> =>
    serialize(async () => {
      const { items, result } = change(await readStored());
      if (items) await options.area.set({ [PROMPT_LIBRARY_KEY]: items });
      return result;
    }, [PROMPT_LIBRARY_KEY]);

  return {
    apply: (op) =>
      op.kind === 'seed'
        ? seed(op.items)
        : op.kind === 'restore'
          ? restore(op)
          : transact((stored) => applyPromptLibraryOp(stored, op)),
    read: () => serialize(readStored, [PROMPT_LIBRARY_KEY]),
    transact,
  };
}
