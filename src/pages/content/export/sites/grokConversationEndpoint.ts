/**
 * The open Grok conversation, read from grok.com by Voyager's packaged export
 * content script.
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
 * `cardAttachmentsJson` are kept when the payload includes them. The exported
 * branch is the parent chain of the `rid` query, or of the newest leaf when
 * `rid` is absent or unknown. A non-2xx response, a different shape, or a
 * timeout returns nothing so the caller can read the virtual list instead.
 */
import { isAbortError, throwIfExportCancelled } from '../exportCancellation';
import {
  type GrokBranch,
  isGrokConversationId,
  record,
  responseIdOf,
  selectGrokBranch,
} from './grokBranch';

/** How many response ids one `load-responses` body carries. Public clients batch. */
const RESPONSE_BATCH = 50;
/** Pages of one batch before the read is treated as unfinished. */
const MAX_RESPONSE_PAGES = 8;

export class GrokApiMiss extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'GrokApiMiss';
  }
}

function endpoint(conversationId: string, suffix: string): string {
  if (!isGrokConversationId(conversationId)) throw new GrokApiMiss('shape');
  return `/rest/app-chat/conversations/${encodeURIComponent(conversationId)}${suffix}`;
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

export async function fetchGrokBranch(
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
