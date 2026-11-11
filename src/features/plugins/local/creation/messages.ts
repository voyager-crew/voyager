/**
 * The two requests the panel sends the page's content script for Create mode,
 * through the panel's tab relay, and the replies it reads back. Parsed on both
 * ends: any extension page can message a tab, and a reply is runtime data.
 */
import { MAX_PLUGIN_REQUEST_CHARS } from '../authoringSites';
import { MAX_LOCAL_PLUGIN_IMPORT_CHARS } from '../localPluginFiles';

export const CREATE_MODE_MESSAGES = {
  /** Open a new chat on this page and fill its composer with the creation message. */
  start: 'gv.create.start',
  /** Hand over, once, the reply block the user chose to review. */
  pending: 'gv.create.pending',
} as const;

export type CreateStartRequest = {
  readonly type: typeof CREATE_MODE_MESSAGES.start;
  readonly request: string;
};

/** Why the page refused before doing anything: no Create mode here, or text already in the composer. */
export type CreateStartRefusal = 'unsupported' | 'busy';
export type CreateStartReply =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: CreateStartRefusal };

/** The block a user chose on the page, as the panel re-checks it. */
export interface CreationReviewCandidate {
  readonly text: string;
  readonly siteId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The request text, trimmed; null when empty or past the request ceiling. */
export function parseCreateRequestText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= MAX_PLUGIN_REQUEST_CHARS ? text : null;
}

export function parseCreateStartRequest(value: unknown): CreateStartRequest | null {
  if (!isRecord(value) || value.type !== CREATE_MODE_MESSAGES.start) return null;
  const request = parseCreateRequestText(value.request);
  return request ? { type: CREATE_MODE_MESSAGES.start, request } : null;
}

export function parseCreateStartReply(value: unknown): CreateStartReply | null {
  if (!isRecord(value)) return null;
  if (value.ok === true) return { ok: true };
  return value.ok === false && (value.reason === 'unsupported' || value.reason === 'busy')
    ? { ok: false, reason: value.reason }
    : null;
}

/** The pending candidate, or null when none is waiting or the reply is malformed. */
export function parseCreatePendingReply(value: unknown): CreationReviewCandidate | null {
  if (!isRecord(value) || !isRecord(value.candidate)) return null;
  const { text, siteId } = value.candidate;
  if (typeof text !== 'string' || !text || text.length > MAX_LOCAL_PLUGIN_IMPORT_CHARS) return null;
  if (typeof siteId !== 'string' || !siteId || siteId.length > 64) return null;
  return { text, siteId };
}
