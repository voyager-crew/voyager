/**
 * The open Grok conversation, read by Voyager's packaged export content script.
 *
 * A declarative plugin has no JavaScript, so it cannot call `fetch`. This file
 * runs in the isolated content script registered for grok.com. `fetch` with
 * `credentials: 'include'` sends that host's cookies when the extension holds
 * the host permission, the same way `chatgptHistoryApi.ts` reads ChatGPT. The
 * page CSP does not apply to that request, and the page's own scripts do not
 * either: this does not enter the page world and does not add anti-bot
 * signature headers. `x-xai-request-id` is a new UUID per request. Public
 * clients send that header; it is not a signature.
 *
 * Shape, from public export clients (ai-vault's grok-web provider, the Greasy
 * Fork exporter, kept's API notes): GET
 * `/rest/app-chat/conversations/<id>/response-node?includeThreads=true`, then
 * POST `/rest/app-chat/conversations/<id>/load-responses` with
 * `{ responseIds }`. A message has `responseId`, `parentResponseId`, `sender`
 * (`human` or `assistant`) and `message`. `webSearchResults`, `xposts` and
 * `cardAttachmentsJson` are kept when the payload includes them. The exported branch is the parent
 * chain of the `rid` query, or of the newest leaf when `rid` is absent or
 * unknown. A non-2xx response, a different shape, or a timeout returns nothing
 * so the caller can read the virtual list instead.
 */
import { logger } from '@/core/services/LoggerService';
import { hashString53 } from '@/core/utils/hash';
import type { ExtractedContent } from '@/features/export/services/DOMContentExtractor';
import type { SiteAdapter } from '@/features/plugins/types';

import type { ExportPlatformAdapter } from '../adapter/platformAdapters';
import type { ExportSelectionOptions } from '../adapter/type';
import { isAbortError, throwIfExportCancelled } from '../exportCancellation';
import {
  type CatalogReadResult,
  type CatalogSnapshot,
  readCatalogConversation,
} from './catalogReader';
import { embedYouTubeLinks, grokMessageMarkdown } from './grokMessageMarkdown';

/**
 * The 2026-11-15 capture did not include a stop control. This is not a selector.
 * Copying any selector into `export.generating` would let a finished DOM crawl
 * report itself complete.
 */
export const GROK_GENERATING_SELECTOR_PLACEHOLDER = 'UNVERIFIED';

/** How many response ids one `load-responses` body carries. Public clients batch. */
const RESPONSE_BATCH = 50;
/** Pages of one batch before the read is treated as unfinished. */
const MAX_RESPONSE_PAGES = 8;
const REQUEST_TIMEOUT_MS = 20_000;
const GROK_ORIGIN = 'https://grok.com';
const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GrokBranchMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly partial: boolean;
}

export interface GrokBranch {
  readonly messages: readonly GrokBranchMessage[];
  /** A selected message was still marked partial by the endpoint. */
  readonly partial: boolean;
}

export interface GrokReadDeps {
  readonly fetch?: typeof fetch;
  readonly readDom?: typeof readCatalogConversation;
  readonly timeoutMs?: number;
}

class GrokApiMiss extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'GrokApiMiss';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function responseIdOf(value: unknown): string | null {
  const id = record(value)?.responseId;
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : null;
}

/** `undefined` means the field is absent or unusable, so a node parent stays. */
function parentFrom(facts: Record<string, unknown> | null): string | null | undefined {
  if (!facts || !Object.hasOwn(facts, 'parentResponseId')) return undefined;
  const parent = facts.parentResponseId;
  if (parent === null || parent === '') return null;
  if (typeof parent !== 'string') return undefined;
  const trimmed = parent.trim();
  if (!trimmed) return null;
  return trimmed.length <= 200 ? trimmed : undefined;
}

function readTime(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Reply markdown, including YouTube covers and structured sources when the payload has them. */
function messageText(facts: Record<string, unknown>): string {
  return grokMessageMarkdown(facts);
}

function roleOf(facts: Record<string, unknown>): 'user' | 'assistant' | 'other' {
  const sender = typeof facts.sender === 'string' ? facts.sender.toLowerCase() : '';
  if (sender === 'human') return 'user';
  if (sender === 'assistant') return 'assistant';
  return 'other';
}

interface Draft {
  id: string;
  parentId: string | null;
  role: 'user' | 'assistant' | 'other' | 'pending';
  text: string;
  createdAt: number | null;
  partial: boolean;
  control: boolean;
  index: number;
}

function endpoint(conversationId: string, suffix: string): string {
  if (!CONVERSATION_ID.test(conversationId)) throw new GrokApiMiss('shape');
  return `/rest/app-chat/conversations/${encodeURIComponent(conversationId)}${suffix}`;
}

/** The `/c/<uuid>` id, and only that. A capture that is not a UUID is not requested. */
export function grokConversationId(url: string, pattern: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  let captured: string | undefined;
  try {
    captured = new RegExp(pattern).exec(pathname)?.[1];
  } catch {
    return null;
  }
  return captured !== undefined && CONVERSATION_ID.test(captured) ? captured : null;
}

/** `rid` is the response the page is showing, when the query is a UUID. */
export function grokDisplayedLeafId(url: string): string | null {
  try {
    const rid = new URL(url).searchParams.get('rid');
    return rid !== null && CONVERSATION_ID.test(rid) ? rid : null;
  } catch {
    return null;
  }
}

function chooseLeaf(drafts: ReadonlyMap<string, Draft>, leafId: string | null): string | null {
  if (leafId) {
    const wanted = leafId.toLowerCase();
    for (const id of drafts.keys()) {
      if (id.toLowerCase() === wanted) return id;
    }
  }
  const used = new Set<string>();
  for (const draft of drafts.values()) {
    if (draft.parentId && drafts.has(draft.parentId)) used.add(draft.parentId);
  }
  const leaves = [...drafts.values()].filter((draft) => !used.has(draft.id));
  if (leaves.length === 0) return null;
  leaves.sort((a, b) => {
    const at = a.createdAt ?? Number.NEGATIVE_INFINITY;
    const bt = b.createdAt ?? Number.NEGATIVE_INFINITY;
    if (at !== bt) return bt - at;
    return b.index - a.index;
  });
  return leaves[0]?.id ?? null;
}

function isShown(draft: Draft): draft is Draft & { role: 'user' | 'assistant' } {
  return (
    (draft.role === 'user' || draft.role === 'assistant') && !draft.control && draft.text.length > 0
  );
}

/**
 * The messages on one branch, oldest first. `null` when the payloads are not
 * the node tree and response list this reader understands, or the chain is
 * cyclic, unfinished, or empty.
 */
export function selectGrokBranch(
  nodePayload: unknown,
  responses: readonly unknown[],
  leafId: string | null,
): GrokBranch | null {
  const nodes = record(nodePayload)?.responseNodes;
  if (!Array.isArray(nodes)) return null;
  const drafts = new Map<string, Draft>();
  nodes.forEach((node, index) => {
    const id = responseIdOf(node);
    if (!id || drafts.has(id)) return;
    const facts = record(node);
    drafts.set(id, {
      id,
      parentId: parentFrom(facts) ?? null,
      role: 'pending',
      text: '',
      createdAt: facts ? readTime(facts.createTime) : null,
      partial: false,
      control: false,
      index,
    });
  });
  if (drafts.size === 0) return null;

  responses.forEach((response, index) => {
    const id = responseIdOf(response);
    const facts = record(response);
    const current = id ? drafts.get(id) : undefined;
    if (!id || !facts || !current) return;
    const parent = parentFrom(facts);
    drafts.set(id, {
      ...current,
      parentId: parent === undefined ? current.parentId : parent,
      role: roleOf(facts),
      text: messageText(facts),
      createdAt: readTime(facts.createTime) ?? current.createdAt,
      partial: facts.partial === true,
      control: facts.isControl === true,
      index,
    });
  });

  const leaf = chooseLeaf(drafts, leafId);
  if (!leaf) return null;
  const chain: Draft[] = [];
  const seen = new Set<string>();
  for (let id: string | null = leaf; id;) {
    if (seen.has(id)) return null;
    seen.add(id);
    const draft = drafts.get(id);
    if (!draft) break;
    if (draft.role === 'pending') return null;
    chain.push(draft);
    id = draft.parentId && drafts.has(draft.parentId) ? draft.parentId : null;
  }
  chain.reverse();
  const messages = chain.filter(isShown).map((draft) => ({
    id: draft.id,
    role: draft.role,
    text: draft.text,
    partial: draft.partial,
  }));
  if (messages.length === 0) return null;
  return { messages, partial: messages.some((message) => message.partial) };
}

function requestHeaders(jsonBody: boolean): Record<string, string> | null {
  const id = globalThis.crypto?.randomUUID?.();
  if (!id) return null;
  return {
    Accept: 'application/json',
    'x-xai-request-id': id,
    ...(jsonBody ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function request(
  url: string,
  init: RequestInit,
  parent: AbortSignal | undefined,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<Response> {
  throwIfExportCancelled(parent);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onParent = () => controller.abort();
  parent?.addEventListener('abort', onParent);
  try {
    return await fetchImpl(url, {
      ...init,
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch {
    if (parent?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    if (controller.signal.aborted) throw new GrokApiMiss('timeout');
    throw new GrokApiMiss('network');
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', onParent);
  }
}

async function readBody(response: Response): Promise<unknown> {
  if (!response.ok) throw new GrokApiMiss(`http-${response.status}`);
  try {
    return JSON.parse(await response.text()) as unknown;
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new GrokApiMiss('shape');
  }
}

async function getNodes(
  conversationId: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const headers = requestHeaders(false);
  if (!headers) throw new GrokApiMiss('request-id');
  const response = await request(
    endpoint(conversationId, '/response-node?includeThreads=true'),
    { method: 'GET', headers },
    signal,
    timeoutMs,
    fetchImpl,
  );
  return readBody(response);
}

function nodeIds(payload: unknown): string[] | null {
  const nodes = record(payload)?.responseNodes;
  if (!Array.isArray(nodes)) return null;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const id = responseIdOf(node);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function nextCursor(payload: unknown): string | null {
  const data = record(payload);
  if (!data) return null;
  // `cursor` is only a continuation when the page says there is more. A finished
  // payload can echo the cursor it was given.
  const keys =
    data.hasMore === true || data.hasNextPage === true
      ? (['nextCursor', 'nextPageToken', 'next', 'cursor'] as const)
      : (['nextCursor', 'nextPageToken', 'next'] as const);
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function hasMore(payload: unknown): boolean {
  const data = record(payload);
  return data?.hasMore === true || data?.hasNextPage === true;
}

async function postResponses(
  conversationId: string,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const headers = requestHeaders(true);
  if (!headers) throw new GrokApiMiss('request-id');
  const response = await request(
    endpoint(conversationId, '/load-responses'),
    { method: 'POST', headers, body: JSON.stringify(body) },
    signal,
    timeoutMs,
    fetchImpl,
  );
  return readBody(response);
}

async function loadBatch(
  conversationId: string,
  responseIds: readonly string[],
  signal: AbortSignal | undefined,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<unknown[]> {
  const collected: unknown[] = [];
  const seenIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_RESPONSE_PAGES; page++) {
    const body: Record<string, unknown> = { responseIds: [...responseIds] };
    if (cursor) body.cursor = cursor;
    const payload = await postResponses(conversationId, body, signal, timeoutMs, fetchImpl);
    const responses = record(payload)?.responses;
    if (!Array.isArray(responses)) throw new GrokApiMiss('shape');
    let added = 0;
    for (const response of responses) {
      const id = responseIdOf(response);
      if (id && seenIds.has(id)) continue;
      if (id) seenIds.add(id);
      collected.push(response);
      added += 1;
    }
    const next = nextCursor(payload);
    const more = hasMore(payload);
    if (!more && !next) return collected;
    if (!next || seenCursors.has(next) || added === 0) throw new GrokApiMiss('incomplete');
    seenCursors.add(next);
    cursor = next;
  }
  throw new GrokApiMiss('incomplete');
}

async function loadResponses(
  conversationId: string,
  responseIds: readonly string[],
  signal: AbortSignal | undefined,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<unknown[]> {
  const collected: unknown[] = [];
  for (let start = 0; start < responseIds.length; start += RESPONSE_BATCH) {
    const batch = responseIds.slice(start, start + RESPONSE_BATCH);
    collected.push(...(await loadBatch(conversationId, batch, signal, timeoutMs, fetchImpl)));
  }
  return collected;
}

async function fetchGrokBranch(
  conversationId: string,
  leafId: string | null,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<GrokBranch> {
  throwIfExportCancelled(signal);
  const nodePayload = await getNodes(conversationId, signal, timeoutMs, fetchImpl);
  const ids = nodeIds(nodePayload);
  if (!ids || ids.length === 0) throw new GrokApiMiss('shape');
  throwIfExportCancelled(signal);
  const responses = await loadResponses(conversationId, ids, signal, timeoutMs, fetchImpl);
  throwIfExportCancelled(signal);
  const branch = selectGrokBranch(nodePayload, responses, leafId);
  if (!branch) throw new GrokApiMiss('shape');
  return branch;
}

function snapshotsFor(messageKey: string, branch: GrokBranch): CatalogSnapshot[] {
  return branch.messages.map((message) => {
    const nativeId = `${messageKey}:gateway:${message.id}`;
    const element = document.createElement('div');
    element.textContent = message.text;
    const content: ExtractedContent = {
      text: message.text,
      html: '',
      attachments: [],
      hasImages: message.text.includes('!['),
      hasFormulas: false,
      hasTables: false,
      hasCode: message.text.includes('```'),
    };
    return {
      id: nativeId,
      nativeId,
      role: message.role,
      content,
      text: message.text,
      element,
      host: new WeakRef(element),
      fingerprint: hashString53(
        `${message.role}\u0000${content.text}\u0000${content.html}\u0000${JSON.stringify(content.attachments)}`,
      ),
    };
  });
}

function sameRoute(expected: string, page: string): boolean {
  const left = new URL(expected);
  const right = new URL(page);
  return (
    left.origin === right.origin && left.pathname === right.pathname && left.search === right.search
  );
}

/** Page text has no card payload; a bare YouTube URL still becomes a cover. */
function decorateGrokDom(result: CatalogReadResult): CatalogReadResult {
  let changed = false;
  const snapshots = result.snapshots.map((snapshot) => {
    const text = embedYouTubeLinks(snapshot.text);
    if (text === snapshot.text) return snapshot;
    changed = true;
    return {
      ...snapshot,
      text,
      content: {
        ...snapshot.content,
        text,
        hasImages: snapshot.content.hasImages || text.includes('!['),
      },
    };
  });
  return changed ? { ...result, snapshots } : result;
}

function logGrokExportRead(source: 'endpoint' | 'virtual-dom', count: number): void {
  if (!import.meta.env.DEV) return;
  logger.info(
    source === 'endpoint' ? 'Grok export read via endpoint' : 'Grok export read via virtual DOM',
    { source, count },
  );
}

function canReadGrokApi(site: SiteAdapter, expectedUrl: string | undefined): boolean {
  if (site.id !== 'grok' || location.origin !== GROK_ORIGIN) return false;
  if (!expectedUrl) return true;
  try {
    return sameRoute(expectedUrl, location.href);
  } catch {
    return false;
  }
}

/**
 * Grok tries its conversation endpoint first. Every other catalog site, and
 * Grok when that read fails, uses the DOM reader configured in `site.json`.
 */
export async function readCatalogOrGrokConversation(
  site: SiteAdapter,
  adapter: ExportPlatformAdapter,
  options: ExportSelectionOptions,
  deps: GrokReadDeps = {},
): Promise<CatalogReadResult> {
  const readDom = deps.readDom ?? readCatalogConversation;
  const readPage = async (): Promise<CatalogReadResult> => {
    const result = await readDom(site, adapter, options);
    const decorated = site.id === 'grok' ? decorateGrokDom(result) : result;
    if (site.id === 'grok') logGrokExportRead('virtual-dom', decorated.snapshots.length);
    return decorated;
  };
  if (!canReadGrokApi(site, options.expectedUrl)) return readPage();
  const pattern = site.conversationIdPattern;
  const conversationId = pattern ? grokConversationId(location.href, pattern) : null;
  if (!conversationId) return readPage();
  const messageKey = site.export?.messageKey;
  if (!messageKey) return readPage();
  try {
    const branch = await fetchGrokBranch(
      conversationId,
      grokDisplayedLeafId(location.href),
      options.signal,
      deps.timeoutMs ?? REQUEST_TIMEOUT_MS,
      deps.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    );
    const snapshots = snapshotsFor(messageKey, branch);
    logGrokExportRead('endpoint', snapshots.length);
    return {
      snapshots,
      completeness: branch.partial ? 'unknown' : 'complete',
    };
  } catch (error) {
    if (isAbortError(error)) throw error;
    logger.warn('Grok conversation endpoint was not used', {
      reason: error instanceof GrokApiMiss ? error.reason : 'error',
    });
    throwIfExportCancelled(options.signal);
    return readPage();
  }
}
