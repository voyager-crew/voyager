import { hashString } from '@/core/utils/hash';
import type { ExtractedContent } from '@/features/export/services/DOMContentExtractor';
import type { ExportAttachment } from '@/features/export/types/export';

import { plainReplyMarkdown } from './chatgptReplyMarkup';
import { wait } from './chatgptShared';
import { type ChatGptThreadMessage, assistantMessageId, userMessageId } from './chatgptThread';

/**
 * The turns before the first one ChatGPT's page will render, read from its
 * own conversation endpoint.
 *
 * Measured live (November 2026, #1071): the thread loads older history only on
 * a trusted wheel or touch. Setting `scrollTop`, stepping it up, and dispatched
 * wheel or key events all leave "Loading older messages" spinning, so a long
 * conversation cannot be crawled from its start. The endpoint
 * `GET /backend-api/conversation/<id>` answers the whole message tree:
 * - `mapping` holds nodes `{ id, parent, message }`; a node's ancestors are the
 *   branch it sits on, whichever branch `current_node` names;
 * - a turn's `data-turn-key` on the page is its prompt's message id;
 * - the page shows a reply as the turn's assistant `text` messages addressed to
 *   `all` outside the `commentary` channel; thoughts, tool calls and tool
 *   output are not shown, and `data-chatgpt-search-message-ids` lists exactly
 *   the prompt's id and those replies' ids.
 */

/** One turn read from the endpoint, in the shape the page renders it. */
export interface ChatGptApiTurn {
  readonly key: string;
  readonly user: string;
  readonly attachments: readonly ExportAttachment[];
  readonly assistant: string;
  /** The prompt's id and the shown replies' ids, as the page lists them. */
  readonly ids: readonly string[];
}

type Json = Record<string, unknown>;

function record(value: unknown): Json | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Citation spans ChatGPT writes between private-use markers, e.g. `citeturn0search1`. */
const CITATION_SPAN = new RegExp('\ue200[^\ue201]*\ue201', 'g');

function stripCitations(body: string, message: Json): string {
  let result = body;
  const references = record(message.metadata)?.content_references;
  if (Array.isArray(references)) {
    for (const reference of references) {
      const matched = text(record(reference)?.matched_text);
      if (matched) result = result.split(matched).join(text(record(reference)?.alt));
    }
  }
  return result.replace(CITATION_SPAN, '');
}

function stringParts(message: Json): string[] {
  const parts = record(message.content)?.parts;
  return Array.isArray(parts)
    ? parts.filter((part): part is string => typeof part === 'string')
    : [];
}

function attachmentsOf(message: Json): ExportAttachment[] {
  const list = record(message.metadata)?.attachments;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    const name = text(record(entry)?.name).trim();
    if (!name) return [];
    return [{ name, type: name.match(/\.([a-z0-9]{1,12})$/i)?.[1].toLowerCase() ?? 'file' }];
  });
}

function isShown(message: Json): boolean {
  return record(message.metadata)?.is_visually_hidden_from_conversation !== true;
}

function role(message: Json): string {
  return text(record(message.author)?.role);
}

function isPrompt(message: Json): boolean {
  const type = text(record(message.content)?.content_type);
  return (
    role(message) === 'user' &&
    text(message.recipient) === 'all' &&
    isShown(message) &&
    (type === 'text' || type === 'multimodal_text')
  );
}

function isShownReply(message: Json): boolean {
  return (
    role(message) === 'assistant' &&
    text(message.recipient) === 'all' &&
    text(record(message.content)?.content_type) === 'text' &&
    text(message.channel) !== 'commentary' &&
    isShown(message)
  );
}

/**
 * The turns strictly before the node `beforeId`, oldest first, on that node's
 * own branch. Throws when the tree does not hold the node.
 */
export function parseTurnsBefore(data: unknown, beforeId: string): ChatGptApiTurn[] {
  const mapping = record(record(data)?.mapping);
  if (!mapping || !record(mapping[beforeId])) throw new Error('chatgpt_export_history_mismatch');
  const branch: Json[] = [];
  const seen = new Set<string>();
  for (
    let id = text(record(mapping[beforeId])?.parent);
    id && !seen.has(id);
    id = text(record(mapping[id])?.parent)
  ) {
    seen.add(id);
    const message = record(record(mapping[id])?.message);
    if (message) branch.unshift(message);
  }

  interface Draft {
    key: string;
    user: string;
    attachments: ExportAttachment[];
    replies: string[];
    ids: string[];
  }
  const turns: Draft[] = [];
  let current: Draft | null = null;
  for (const message of branch) {
    const id = text(message.id);
    if (!id) continue;
    if (isPrompt(message)) {
      current = {
        key: id,
        user: stringParts(message).join('\n\n').trim(),
        attachments: attachmentsOf(message),
        replies: [],
        ids: [id],
      };
      turns.push(current);
    } else if (isShownReply(message)) {
      const body = plainReplyMarkdown(stripCitations(stringParts(message).join(''), message));
      if (!current) {
        // A reply before any prompt, such as a GPT's greeting, is its own item.
        current = { key: id, user: '', attachments: [], replies: [], ids: [] };
        turns.push(current);
      }
      current.ids.push(id);
      if (body) current.replies.push(body);
    }
  }
  return turns.map((turn) => ({
    key: turn.key,
    user: turn.user,
    attachments: turn.attachments,
    assistant: turn.replies.join('\n\n'),
    ids: turn.ids,
  }));
}

function content(body: string, attachments: readonly ExportAttachment[]): ExtractedContent {
  const lines = attachments.map(({ name }) => `📎 ${name}`).join('\n');
  return {
    text: [lines, body].filter(Boolean).join('\n\n'),
    // Empty, so PDF and image export lay the text out as plain paragraphs.
    html: '',
    attachments: [...attachments],
    hasImages: false,
    hasFormulas: false,
    hasTables: false,
    hasCode: false,
  };
}

/** Thread messages for turns the page never mounted; their hosts are detached placeholders. */
export function apiTurnMessages(turns: readonly ChatGptApiTurn[]): ChatGptThreadMessage[] {
  return turns.flatMap((turn) => {
    const fingerprint = `ids:${[...new Set(turn.ids)].sort().join(' ')}`;
    // The timeline hashes the bubble's text, which is the prompt as typed.
    const summary = turn.user.replace(/\s+/g, ' ').trim();
    const starHash = summary ? hashString(summary) : undefined;
    const messages: ChatGptThreadMessage[] = [];
    if (turn.user || turn.attachments.length) {
      messages.push({
        id: userMessageId(turn.key),
        turnKey: turn.key,
        role: 'user',
        content: content(turn.user, turn.attachments),
        host: document.createElement('div'),
        fingerprint,
        starHash,
      });
    }
    if (turn.assistant) {
      messages.push({
        id: assistantMessageId(turn.key),
        turnKey: turn.key,
        role: 'assistant',
        content: content(turn.assistant, []),
        host: document.createElement('div'),
        fingerprint,
        starHash,
      });
    }
    return messages;
  });
}

/** The conversation id of a `/c/<id>` route, project and GPT routes included. */
export function chatGptConversationId(url: string): string | null {
  const match = new URL(url, location.href).pathname.match(/\/c\/([A-Za-z0-9_-]{1,128})\/?$/);
  return match?.[1] ?? null;
}

/** The session's request headers. The token stays in this content script. */
async function readSessionHeaders(signal?: AbortSignal): Promise<Record<string, string>> {
  const response = await fetch('/api/auth/session', {
    credentials: 'include',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error(`chatgpt_export_history_session:${response.status}`);
  const session = record(await response.json());
  const token = text(session?.accessToken);
  if (!token) throw new Error('chatgpt_export_history_session');
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  const account = record(session?.account);
  const accountId = text(account?.id);
  // A workspace's conversations are read under its account, as ChatGPT's own requests do.
  if (account?.structure === 'workspace' && accountId) headers['ChatGPT-Account-Id'] = accountId;
  return headers;
}

/** The longest Retry-After the export waits out once, in seconds. */
const MAX_RETRY_AFTER_S = 20;
/** Answers that mean the remembered session no longer holds: expired, or another account. */
const STALE_SESSION = new Set([401, 403, 404]);

/**
 * Reads older turns from the conversation endpoint, sparing ChatGPT's read
 * quota (#1071): a burst of reads answers 429. It remembers the session's
 * headers until ChatGPT refuses them, and the last conversation tree it read.
 * A node's ancestors never change (an edit or a regenerated reply starts a new
 * node), so the tree answers every later export of that conversation whose
 * first loaded turn it holds.
 */
export class ChatGptHistoryReader {
  private headers: Promise<Record<string, string>> | null = null;
  private tree: { readonly conversationId: string; readonly data: unknown } | null = null;

  /** Read the turns before `beforeId` in the conversation at `url`. */
  async turnsBefore(
    url: string,
    beforeId: string,
    signal?: AbortSignal,
  ): Promise<ChatGptApiTurn[]> {
    const conversationId = chatGptConversationId(url);
    if (!conversationId) throw new Error('chatgpt_export_history_unavailable');
    if (this.tree?.conversationId === conversationId && hasNode(this.tree.data, beforeId)) {
      return parseTurnsBefore(this.tree.data, beforeId);
    }
    const data = await this.readConversation(conversationId, signal);
    const turns = parseTurnsBefore(data, beforeId);
    this.tree = { conversationId, data };
    return turns;
  }

  private sessionHeaders(signal?: AbortSignal): Promise<Record<string, string>> {
    if (!this.headers) {
      const pending = readSessionHeaders(signal);
      this.headers = pending;
      pending.catch(() => {
        if (this.headers === pending) this.headers = null;
      });
    }
    return this.headers;
  }

  private async readConversation(conversationId: string, signal?: AbortSignal): Promise<unknown> {
    const endpoint = `/backend-api/conversation/${encodeURIComponent(conversationId)}`;
    const remembered = this.headers !== null;
    const request = async () =>
      fetch(endpoint, {
        credentials: 'include',
        cache: 'no-store',
        headers: await this.sessionHeaders(signal),
        signal,
      });
    let response = await request();
    if (remembered && STALE_SESSION.has(response.status)) {
      this.headers = null;
      response = await request();
    }
    // Measured live: a burst of reads answers 429 with a Retry-After of ~15s.
    const retryAfter = Number(response.headers.get('retry-after'));
    if (response.status === 429 && retryAfter > 0 && retryAfter <= MAX_RETRY_AFTER_S) {
      await wait(retryAfter * 1000, signal);
      response = await request();
    }
    if (!response.ok) throw new Error(`chatgpt_export_history_fetch:${response.status}`);
    return response.json();
  }
}

function hasNode(data: unknown, id: string): boolean {
  return record(record(record(data)?.mapping)?.[id]) !== null;
}

/** The reader the page's exports share for the content script's life. */
export const chatGptHistory = new ChatGptHistoryReader();
