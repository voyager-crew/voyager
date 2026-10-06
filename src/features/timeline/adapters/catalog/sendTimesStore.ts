/**
 * Where a catalog site keeps send times: one small `chrome.storage.local` key
 * per conversation (`gvMessageTimestamps:<site>:conv:<id>`), apart from
 * Gemini's `gvMessageTimestamps` blob. Gemini's `TimestampService` saves its
 * whole in-memory snapshot, so an entry another tab put in that blob vanishes
 * on Gemini's next save, and its cap would let catalog sends evict Gemini
 * times. A send rewrites only its own conversation's key, so tabs stamping
 * different chats cannot overwrite each other.
 *
 * A conversation's value is columnar and compact (about 15 bytes a turn):
 * `{ v, b, k, d }` holds a base time `b` in Unix seconds, each turn's host key
 * as a short FNV-1a hash in `k`, and its send time as seconds after `b` in
 * `d`, appended in send order. Lookups hash the host key; a hash collision
 * within one conversation is negligible.
 *
 * A per-site index (`gvMessageTimestamps:<site>:index`) lists the site's
 * conversations, so the oldest can be dropped past the cap without reading all
 * of storage. It changes only when a conversation is first stamped or pruned.
 * It is advisory: a conversation an index race misses keeps its times, it is
 * only never pruned.
 */
import { StorageKeys } from '@/core/types/common';
import { hasLegacySafariStorageLimit } from '@/core/utils/browser';
import { hashString } from '@/core/utils/hash';

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

/** The stored form of a host turn key. */
export function turnKeyHash(turnKey: string): string {
  return hashString(turnKey);
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
export function parseConversationTimes(value: unknown): TurnTimes {
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

/** A stored conversation's latest send; pruning drops the oldest first. */
function lastSendOf(value: unknown): number {
  const times = [...parseConversationTimes(value).values()];
  return times.length > 0 ? Math.max(...times) : -Infinity;
}

async function readLocal(keys: string[]): Promise<Record<string, unknown>> {
  try {
    return ((await chrome.storage.local.get(keys)) ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function readConversationTimes(conversationKey: string): Promise<TurnTimes> {
  const key = conversationTimesKey(conversationKey);
  return parseConversationTimes((await readLocal([key]))[key]);
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
  const blob = (await readLocal([key]))[key];
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

/** Stores one conversation's times; only that conversation's key is written. */
export async function writeConversationTimes(
  conversationKey: string,
  times: TurnTimes,
): Promise<void> {
  if (times.size === 0) return;
  await chrome.storage.local.set({
    [conversationTimesKey(conversationKey)]: toStoredConversation(times),
  });
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

export async function readSiteIndex(siteId: string): Promise<Set<string>> {
  const key = indexKey(siteId);
  const stored = (await readLocal([key]))[key];
  if (!isRecord(stored) || stored.v !== FORMAT_VERSION || !Array.isArray(stored.conversations)) {
    return new Set();
  }
  return new Set(stored.conversations.filter((item): item is string => typeof item === 'string'));
}

/** Re-reads the index and applies one change, so another tab's additions are kept. */
async function updateSiteIndex(
  siteId: string,
  change: (index: Set<string>) => void,
): Promise<void> {
  const index = await readSiteIndex(siteId);
  change(index);
  const stored: StoredIndex = { v: FORMAT_VERSION, conversations: [...index] };
  await chrome.storage.local.set({ [indexKey(siteId)]: stored });
}

export function addToSiteIndex(siteId: string, conversationKey: string): Promise<void> {
  return updateSiteIndex(siteId, (index) => index.add(conversationKey));
}

/** Removes the site's conversations whose latest send is oldest, beyond `cap`. */
export async function pruneSite(siteId: string, cap: number): Promise<void> {
  const index = await readSiteIndex(siteId);
  if (index.size <= cap) return;
  const conversations = [...index];
  const values = await readLocal(conversations.map(conversationTimesKey));
  const dropped = conversations
    // One already gone sorts first, so the index forgets it.
    .map((conversation) => ({
      conversation,
      last: lastSendOf(values[conversationTimesKey(conversation)]),
    }))
    .sort((a, b) => (a.last === b.last ? 0 : a.last < b.last ? -1 : 1))
    .slice(0, index.size - cap)
    .map(({ conversation }) => conversation);
  await chrome.storage.local.remove(dropped.map(conversationTimesKey));
  await updateSiteIndex(siteId, (fresh) =>
    dropped.forEach((conversation) => fresh.delete(conversation)),
  );
}
