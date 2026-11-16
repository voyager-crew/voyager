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
import { type GrokBranch, responseIdOf, selectGrokBranch } from './grokBranch';
import { record } from './grokMessageMarkdown';

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

interface RequestContext {
  readonly conversationId: string;
  readonly signal: AbortSignal | undefined;
  readonly timeoutMs: number;
  readonly fetchImpl: typeof fetch;
}

/** One same-origin JSON request. A miss is a `GrokApiMiss`; a cancel stays an `AbortError`. */
async function requestJson(
  context: RequestContext,
  suffix: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const { signal: parent, timeoutMs, fetchImpl } = context;
  throwIfExportCancelled(parent);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onParent = () => controller.abort();
  parent?.addEventListener('abort', onParent);
  let response: Response;
  try {
    response = await fetchImpl(`/rest/app-chat/conversations/${context.conversationId}${suffix}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Accept: 'application/json',
        'x-xai-request-id': crypto.randomUUID(),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
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
  if (!response.ok) throw new GrokApiMiss(`http-${response.status}`);
  try {
    return (await response.json()) as unknown;
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new GrokApiMiss('shape');
  }
}

function nodeIds(payload: unknown): string[] {
  const nodes = record(payload)?.responseNodes;
  if (!Array.isArray(nodes)) return [];
  const ids = new Set<string>();
  for (const node of nodes) {
    const id = responseIdOf(node);
    if (id) ids.add(id);
  }
  return [...ids];
}

function nextCursor(data: Record<string, unknown>, more: boolean): string | null {
  // `cursor` is only a continuation when the page says there is more. A finished
  // payload can echo the cursor it was given.
  const keys = more
    ? ['nextCursor', 'nextPageToken', 'next', 'cursor']
    : ['nextCursor', 'nextPageToken', 'next'];
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

async function loadBatch(
  context: RequestContext,
  responseIds: readonly string[],
): Promise<unknown[]> {
  const collected: unknown[] = [];
  const seenIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_RESPONSE_PAGES; page++) {
    const data = record(
      await requestJson(context, '/load-responses', {
        responseIds: [...responseIds],
        ...(cursor ? { cursor } : {}),
      }),
    );
    const responses = data?.responses;
    if (!data || !Array.isArray(responses)) throw new GrokApiMiss('shape');
    let added = 0;
    for (const response of responses) {
      const id = responseIdOf(response);
      if (id && seenIds.has(id)) continue;
      if (id) seenIds.add(id);
      collected.push(response);
      added += 1;
    }
    const more = data.hasMore === true || data.hasNextPage === true;
    const next = nextCursor(data, more);
    if (!more && !next) return collected;
    if (!next || seenCursors.has(next) || added === 0) throw new GrokApiMiss('incomplete');
    seenCursors.add(next);
    cursor = next;
  }
  throw new GrokApiMiss('incomplete');
}

export async function fetchGrokBranch(
  conversationId: string,
  leafId: string | null,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<GrokBranch> {
  const context: RequestContext = { conversationId, signal, timeoutMs, fetchImpl };
  const nodePayload = await requestJson(context, '/response-node?includeThreads=true');
  const ids = nodeIds(nodePayload);
  if (ids.length === 0) throw new GrokApiMiss('shape');
  const responses: unknown[] = [];
  for (let start = 0; start < ids.length; start += RESPONSE_BATCH) {
    responses.push(...(await loadBatch(context, ids.slice(start, start + RESPONSE_BATCH))));
  }
  throwIfExportCancelled(signal);
  const branch = selectGrokBranch(nodePayload, responses, leafId);
  if (!branch) throw new GrokApiMiss('shape');
  return branch;
}
