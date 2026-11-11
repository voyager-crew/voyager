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
  /** The page's chat model, when it is one that usually cannot write a plugin. */
  model: 'gv.create.model',
  /** The page outline a creation message would carry from this page now. */
  outline: 'gv.create.outline',
} as const;

/** A chat model on the page that usually cannot write a plugin, as the page reads it. */
export interface CreateModelWarning {
  /** The model's name as the site shows it. */
  readonly model: string;
  /** Its thinking level, only when the page or the applied default says it; never guessed. */
  readonly thinking: string | null;
  /** A model on the site that can, to choose instead. */
  readonly suggested: string;
}

const MAX_MODEL_LABEL_CHARS = 80;

/** Ceiling on the page outline a creation message carries (`pages/content/createMode/pageOutline.ts`). */
export const MAX_PAGE_OUTLINE_CHARS = 3000;

export type CreateStartRequest = {
  readonly type: typeof CREATE_MODE_MESSAGES.start;
  readonly request: string;
  /** Attach the outline of the page the request starts on. */
  readonly structure: boolean;
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
  return request
    ? { type: CREATE_MODE_MESSAGES.start, request, structure: value.structure === true }
    : null;
}

/** The outline text, or null when the page sent none or something else. */
export function parseCreateOutlineReply(value: unknown): string | null {
  if (!isRecord(value) || typeof value.outline !== 'string') return null;
  const { outline } = value;
  return outline && outline.length <= MAX_PAGE_OUTLINE_CHARS ? outline : null;
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

function modelLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const label = value.trim();
  return label && label.length <= MAX_MODEL_LABEL_CHARS ? label : null;
}

/** The warning in a reply to `model`; null when there is none, or the reply is malformed. */
export function parseCreateModelReply(value: unknown): CreateModelWarning | null {
  if (!isRecord(value) || !isRecord(value.warning)) return null;
  const model = modelLabel(value.warning.model);
  const suggested = modelLabel(value.warning.suggested);
  if (!model || !suggested) return null;
  return { model, thinking: modelLabel(value.warning.thinking), suggested };
}
