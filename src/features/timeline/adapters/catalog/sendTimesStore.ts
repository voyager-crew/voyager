/**
 * Where a catalog site keeps send times: one small `chrome.storage.local` key
 * per conversation (`gvMessageTimestamps:<site>:conv:<id>`), apart from
 * Gemini's `gvMessageTimestamps` blob. Gemini's `TimestampService` saves its
 * whole in-memory snapshot, so an entry another tab put in that blob vanishes
 * on Gemini's next save, and its cap would let catalog sends evict Gemini
 * times. A send rewrites only its own conversation's key.
 *
 * A conversation's value is columnar and compact (about 20 bytes a turn):
 * `{ v, b, k, d }` holds a base time `b` in Unix seconds, each turn's host key
 * as a 53-bit hash in `k`, and its send time as seconds after `b` in `d`,
 * appended in send order. Lookups hash the host key.
 *
 * A per-site index (`gvMessageTimestamps:<site>:index`) lists the site's
 * conversations, so the oldest can be dropped past the cap without reading all
 * of storage.
 *
 * Every read-modify-write and every prune holds the site's Web Lock. All of a
 * site's tabs share its origin, so the lock serializes them: two tabs sending
 * in one chat keep both times, and a prune never deletes a chat another tab
 * is writing. Without Web Locks the writes run unserialized and pruning
 * re-reads its victims before removing them. A failed or unrecognised read
 * never leads to a write: it would replace the chat's saved times.
 */
import { StorageKeys } from '@/core/types/common';
import { hasLegacySafariStorageLimit } from '@/core/utils/browser';
import { hashString53 } from '@/core/utils/hash';

/** Hashed host turn key → send time in ms (whole seconds), for one conversation, in send order. */
export type TurnTimes = Map<string, number>;

/** Per-site caps: generous where storage is unlimited, smaller under a browser quota. */
export const CATALOG_SEND_CONVERSATIONS_UNLIMITED = 5000;
export const CATALOG_SEND_CONVERSATIONS_LIMITED = 2000;

const FORMAT_VERSION = 1;
/** The format of Gemini's blob, which an earlier build of the catalog timeline wrote into. */
const GEMINI_FORMAT_VERSION = 2;

interface StoredConversation {
  v: typeof FORMAT_VERSION;
  /** Base time, Unix seconds. */
  b: number;
  /** Hashed host turn keys, in send order. */
  k: string[];
  /** Each turn's send time, seconds after `b`. */
  d: number[];
}

interface StoredIndex {
  v: typeof FORMAT_VERSION;
  conversations: string[];
}

function turnKeyHash(turnKey: string): string {
  return hashString53(turnKey);
}

/** `conversationKey` is `<site>:conv:<id>`, so no conversation's key can equal a site's index key. */
export function conversationTimesKey(conversationKey: string): string {
  return `${StorageKeys.CATALOG_MESSAGE_TIMESTAMPS_PREFIX}${conversationKey}`;
}

function indexKey(siteId: string): string {
  return `${StorageKeys.CATALOG_MESSAGE_TIMESTAMPS_PREFIX}${siteId}:index`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStoredConversation(value: unknown): value is StoredConversation {
  return (
    isRecord(value) &&
    value.v === FORMAT_VERSION &&
    Number.isFinite(value.b) &&
    Array.isArray(value.k) &&
    Array.isArray(value.d) &&
    value.k.length === value.d.length
  );
}

/** The turn times stored under one conversation's key; empty for anything else. */
function parseConversationTimes(value: unknown): TurnTimes {
  const times: TurnTimes = new Map();
  if (!isStoredConversation(value)) return times;
  value.k.forEach((key, i) => {
    const seconds = value.b + value.d[i];
    if (typeof key === 'string' && Number.isFinite(seconds)) times.set(key, seconds * 1000);
  });
  return times;
}

function toStoredConversation(times: TurnTimes): StoredConversation {
  const seconds = [...times.values()].map((time) => Math.floor(time / 1000));
  const base = Math.min(...seconds);
  return {
    v: FORMAT_VERSION,
    b: base,
    k: [...times.keys()],
    d: seconds.map((second) => second - base),
  };
}

/** A conversation's latest send: -Infinity when gone, null when its value is not one this build reads. */
function lastSendOf(value: unknown): number | null {
  if (value === undefined) return -Infinity;
  if (!isStoredConversation(value)) return null;
  const times = [...parseConversationTimes(value).values()];
  return times.length > 0 ? Math.max(...times) : -Infinity;
}

/** The index's conversations: empty when absent, null when its value is not one this build reads. */
function parseIndex(value: unknown): Set<string> | null {
  if (value === undefined) return new Set();
  if (!isRecord(value) || value.v !== FORMAT_VERSION || !Array.isArray(value.conversations)) {
    return null;
  }
  return new Set(value.conversations.filter((item): item is string => typeof item === 'string'));
}

/** The stored values for `keys`, or null when the read failed. */
async function readLocal(keys: string[]): Promise<Record<string, unknown> | null> {
  try {
    return ((await chrome.storage.local.get(keys)) ?? {}) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The site index, or null when it could not be read. */
async function readIndex(siteId: string): Promise<Set<string> | null> {
  const values = await readLocal([indexKey(siteId)]);
  return values === null ? null : parseIndex(values[indexKey(siteId)]);
}

async function writeIndex(siteId: string, conversations: Set<string>): Promise<void> {
  const stored: StoredIndex = { v: FORMAT_VERSION, conversations: [...conversations] };
  await chrome.storage.local.set({ [indexKey(siteId)]: stored });
}

/** Runs `task` holding the site's Web Lock, or unserialized where Web Locks are unavailable. */
function withSiteLock<T>(siteId: string, task: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (typeof locks?.request !== 'function') return task();
  // The lock is held until `task` settles; `then` unwraps its result.
  return locks.request(`gv-send-times:${siteId}`, task).then((result) => result);
}

/** For display: a failed read shows no times. */
export async function readConversationTimes(conversationKey: string): Promise<TurnTimes> {
  const key = conversationTimesKey(conversationKey);
  return parseConversationTimes((await readLocal([key]))?.[key]);
}

export function sendTimeOf(times: TurnTimes, turnKey: string): number | null {
  return times.get(turnKeyHash(turnKey)) ?? null;
}

/**
 * Adds one send to its conversation's key and lists the conversation in the
 * site index. Returns the conversation's times, or null when nothing was
 * written because a read failed or `canWrite` said no.
 */
export function recordSendTime(
  siteId: string,
  conversationKey: string,
  turnKey: string,
  at: number,
  canWrite: () => boolean = () => true,
): Promise<TurnTimes | null> {
  return withSiteLock(siteId, async () => {
    const key = conversationTimesKey(conversationKey);
    const values = await readLocal([key, indexKey(siteId)]);
    if (values === null || !canWrite()) return null;
    const stored = values[key];
    if (stored !== undefined && !isStoredConversation(stored)) return null;
    const times = parseConversationTimes(stored);
    const hashed = turnKeyHash(turnKey);
    if (!times.has(hashed)) {
      // Whole seconds, as stored, so the time reads the same before and after a reload.
      times.set(hashed, Math.floor(at / 1000) * 1000);
      await chrome.storage.local.set({ [key]: toStoredConversation(times) });
    }
    const index = parseIndex(values[indexKey(siteId)]);
    if (index && !index.has(conversationKey)) {
      index.add(conversationKey);
      await writeIndex(siteId, index);
    }
    return times;
  });
}

/**
 * This site's conversations in Gemini's blob, from a build that wrote them
 * there: unhashed host turn keys, ms times. Read only.
 */
export async function readLegacySendTimes(
  siteId: string,
): Promise<Map<string, Map<string, number>>> {
  const prefix = `${siteId}:conv:`;
  const key = StorageKeys.GV_MESSAGE_TIMESTAMPS;
  const blob = (await readLocal([key]))?.[key];
  const legacy = new Map<string, Map<string, number>>();
  if (!isRecord(blob) || blob.version !== GEMINI_FORMAT_VERSION || !isRecord(blob.conversations)) {
    return legacy;
  }
  for (const [conversationKey, turns] of Object.entries(blob.conversations)) {
    if (!conversationKey.startsWith(prefix) || !isRecord(turns)) continue;
    const times = new Map<string, number>();
    for (const [turnKey, time] of Object.entries(turns)) {
      if (typeof time === 'number' && Number.isFinite(time)) times.set(turnKey, time);
    }
    if (times.size > 0) legacy.set(conversationKey, times);
  }
  return legacy;
}

/** The per-site cap for this build: the larger one only when the manifest requires unlimited storage. */
export function catalogSendConversationCap(): number {
  let permissions: readonly string[] = [];
  try {
    permissions = chrome.runtime?.getManifest?.()?.permissions ?? [];
  } catch {
    // An invalidated context reads as a quota-limited one.
  }
  // An optional grant cannot be checked from a content script; Safari before 16 limits storage even when granted.
  return permissions.includes('unlimitedStorage') && !hasLegacySafariStorageLimit()
    ? CATALOG_SEND_CONVERSATIONS_UNLIMITED
    : CATALOG_SEND_CONVERSATIONS_LIMITED;
}

/** Removes the site's conversations whose latest send is oldest, beyond `cap`. */
export function pruneSite(siteId: string, cap: number): Promise<void> {
  return withSiteLock(siteId, async () => {
    const index = await readIndex(siteId);
    if (!index || index.size <= cap) return;
    const conversations = [...index];
    const snapshot = await readLocal(conversations.map(conversationTimesKey));
    if (snapshot === null) return;
    const lastAt = new Map<string, number>();
    for (const conversation of conversations) {
      const last = lastSendOf(snapshot[conversationTimesKey(conversation)]);
      // A value this build cannot read is never removed.
      if (last !== null) lastAt.set(conversation, last);
    }
    // One already gone sorts first, so the index forgets it.
    const victims = [...lastAt]
      .sort(([, a], [, b]) => (a === b ? 0 : a < b ? -1 : 1))
      .slice(0, Math.max(0, index.size - cap))
      .map(([conversation]) => conversation);
    // Without Web Locks another tab may have sent in a victim since the snapshot.
    const fresh = await readLocal(victims.map(conversationTimesKey));
    if (fresh === null) return;
    const dropped = victims.filter((conversation) => {
      const last = lastSendOf(fresh[conversationTimesKey(conversation)]);
      return last !== null && last <= (lastAt.get(conversation) ?? -Infinity);
    });
    if (dropped.length === 0) return;
    await chrome.storage.local.remove(dropped.map(conversationTimesKey));
    // Re-read so another unserialized tab's additions survive.
    const latest = await readIndex(siteId);
    if (!latest) return;
    dropped.forEach((conversation) => latest.delete(conversation));
    await writeIndex(siteId, latest);
  });
}
