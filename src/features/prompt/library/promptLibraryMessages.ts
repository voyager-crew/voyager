/**
 * Message boundary between prompt-library writers (content scripts, the
 * popup) and the background owner. Writers read the library straight from
 * storage and send every change here as an op.
 */
import type { PromptItem } from '@/features/backup/types/backup';

import type {
  PromptChanges,
  PromptLibraryOp,
  PromptLibraryOwner,
  PromptLibraryResult,
} from './promptLibraryOwner';

export const PROMPT_LIBRARY_APPLY_MESSAGE = 'gv.promptLibrary.apply';

/**
 * Bounds on what one op may carry. Prompt Manager enforces no length on a
 * prompt's text, and imports keep names and tags as written, so the string
 * caps sit at chrome.storage.local's default 10 MiB quota: nothing longer can
 * have been stored without `unlimitedStorage`. The whole op is held to 32 MiB
 * of JSON, half of Chrome's 64 MiB message limit.
 */
export const PROMPT_LIBRARY_OP_LIMITS = {
  maxItems: 100_000,
  maxIdChars: 1024,
  maxTextChars: 10 * 1024 * 1024,
  maxNameChars: 10 * 1024 * 1024,
  maxTags: 1000,
  maxTagChars: 1024,
  maxOpBytes: 32 * 1024 * 1024,
} as const;
const LIMITS = PROMPT_LIBRARY_OP_LIMITS;

export interface PromptLibraryApplyRequest {
  type: typeof PROMPT_LIBRARY_APPLY_MESSAGE;
  op: PromptLibraryOp;
}

export type PromptLibraryApplyResponse =
  | { ok: true; result: PromptLibraryResult }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= LIMITS.maxIdChars;

const isPromptText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= LIMITS.maxTextChars;

const isPromptName = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= LIMITS.maxNameChars;

const isTagList = (value: unknown): value is string[] =>
  isStringList(value) &&
  value.length <= LIMITS.maxTags &&
  value.every((tag) => tag.length <= LIMITS.maxTagChars);

/** Whether the op fits the byte budget as UTF-8 JSON; one that cannot be serialized does not. */
function fitsOpBudget(value: unknown): boolean {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return false;
  }
  // A UTF-16 code unit is at most 3 UTF-8 bytes, so most ops skip the encode.
  if (json.length * 3 <= LIMITS.maxOpBytes) return true;
  return (
    json.length <= LIMITS.maxOpBytes &&
    new TextEncoder().encode(json).byteLength <= LIMITS.maxOpBytes
  );
}

/** A prompt as the library stores it, rebuilt from its known fields only. */
function parsePromptItem(value: unknown): PromptItem | null {
  if (!isRecord(value)) return null;
  const { id, text, tags, createdAt, updatedAt, name, pinnedAt } = value;
  if (!isId(id) || !isPromptText(text)) return null;
  if (!isTagList(tags) || !isFiniteNumber(createdAt)) return null;
  if (updatedAt !== undefined && !isFiniteNumber(updatedAt)) return null;
  if (pinnedAt !== undefined && pinnedAt !== null && !isFiniteNumber(pinnedAt)) return null;
  if (name !== undefined && !isPromptName(name)) return null;
  const item: PromptItem = { id, text, tags, createdAt };
  if (updatedAt !== undefined) item.updatedAt = updatedAt;
  if (name !== undefined) item.name = name;
  if (pinnedAt !== undefined) item.pinnedAt = pinnedAt;
  return item;
}

function parseItems(value: unknown, allowEmpty = false): PromptItem[] | null {
  if (!Array.isArray(value) || value.length > LIMITS.maxItems) return null;
  if (value.length === 0 && !allowEmpty) return null;
  const items = value.map(parsePromptItem);
  return items.every((item): item is PromptItem => item !== null) ? items : null;
}

function parseChanges(value: unknown): PromptChanges | null {
  if (!isRecord(value)) return null;
  const { name, text, tags, pinnedAt, updatedAt } = value;
  const changes: PromptChanges = {};
  if (name !== undefined) {
    if (!isPromptName(name)) return null;
    changes.name = name;
  }
  if (text !== undefined) {
    if (!isPromptText(text)) return null;
    changes.text = text;
  }
  if (tags !== undefined) {
    if (!isTagList(tags)) return null;
    changes.tags = tags;
  }
  if (pinnedAt !== undefined) {
    if (pinnedAt !== null && !isFiniteNumber(pinnedAt)) return null;
    changes.pinnedAt = pinnedAt;
  }
  if (updatedAt !== undefined) {
    if (!isFiniteNumber(updatedAt)) return null;
    changes.updatedAt = updatedAt;
  }
  return changes;
}

export function parsePromptLibraryOp(value: unknown): PromptLibraryOp | null {
  if (!isRecord(value) || !fitsOpBudget(value)) return null;
  switch (value.kind) {
    case 'add':
    case 'import': {
      const items = parseItems(value.items);
      return items ? { kind: value.kind, items } : null;
    }
    case 'restore': {
      // An overwrite from a backup without prompts stores an empty library.
      const items = parseItems(value.items, true);
      if (
        value.snapshotId !== undefined &&
        (typeof value.snapshotId !== 'string' || !value.snapshotId)
      )
        return null;
      return items && (value.mode === 'merge' || value.mode === 'overwrite')
        ? {
            kind: 'restore',
            mode: value.mode,
            items,
            ...(value.snapshotId ? { snapshotId: value.snapshotId } : {}),
          }
        : null;
    }
    case 'update': {
      const changes = parseChanges(value.changes);
      return isId(value.id) && changes ? { kind: 'update', id: value.id, changes } : null;
    }
    case 'delete':
      return isId(value.id) ? { kind: 'delete', id: value.id } : null;
    case 'reorder':
      return Array.isArray(value.ids) &&
        value.ids.length <= LIMITS.maxItems &&
        value.ids.every(isId)
        ? { kind: 'reorder', ids: value.ids }
        : null;
    case 'seed':
      // Legacy records go in as the page stored them; only their count and size are bounded.
      return Array.isArray(value.items) &&
        value.items.length <= LIMITS.maxItems &&
        value.items.every(isRecord)
        ? { kind: 'seed', items: value.items }
        : null;
    default:
      return null;
  }
}

export function isPromptLibraryApplyMessage(message: unknown): boolean {
  return isRecord(message) && message.type === PROMPT_LIBRARY_APPLY_MESSAGE;
}

/** Background side: validate the op and apply it through the owner. */
export async function handlePromptLibraryApplyMessage(
  message: unknown,
  owner: PromptLibraryOwner,
): Promise<PromptLibraryApplyResponse> {
  const op = isRecord(message) ? parsePromptLibraryOp(message.op) : null;
  if (!op) return { ok: false, error: 'invalid_op' };
  try {
    return { ok: true, result: await owner.apply(op) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function isResult(value: unknown): value is PromptLibraryResult {
  return (
    isRecord(value) &&
    isFiniteNumber(value.added) &&
    isFiniteNumber(value.skipped) &&
    isFiniteNumber(value.total) &&
    isFiniteNumber(value.nameConflicts) &&
    Array.isArray(value.items)
  );
}

/** A lost reply may follow a committed write; check storage before retrying an op. */
export function createPromptLibraryClient(
  send: (request: PromptLibraryApplyRequest) => Promise<unknown>,
): { apply: (op: PromptLibraryOp) => Promise<PromptLibraryResult> } {
  return {
    async apply(op) {
      const response = await send({ type: PROMPT_LIBRARY_APPLY_MESSAGE, op });
      if (!isRecord(response) || response.ok !== true || !isResult(response.result)) {
        const error =
          isRecord(response) && typeof response.error === 'string' ? response.error : '';
        throw new Error(`Prompt library update failed${error ? `: ${error}` : ''}`);
      }
      return response.result;
    },
  };
}

/** A client that reaches the owner in this extension's background. */
export function createRuntimePromptLibraryClient(): ReturnType<typeof createPromptLibraryClient> {
  return createPromptLibraryClient((request) => chrome.runtime.sendMessage(request));
}
