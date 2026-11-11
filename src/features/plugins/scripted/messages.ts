/**
 * Runtime messages between the scripted runtime in the background and the
 * pages that use it. Senders and replies are checked in
 * `src/pages/background/scriptedCreations/messages.ts`.
 */
import { isLocalPluginId } from '../local/localPluginId';
import type { ScriptedRunState, UserScriptsAvailability } from './types';

export const SCRIPTED_MESSAGE = {
  /** Popup, panel or page: availability and each scripted plugin's run state. */
  status: 'gv.scripted.status',
  /** Probe again and reconcile, after the user flips "Allow User Scripts". Replies with status. */
  recheck: 'gv.scripted.recheck',
  /** Content script, top frame: this page loaded and its main thread is free. */
  loaded: 'gv.scripted.loaded',
  /** Drop the crash notice the user has seen. */
  clearNotice: 'gv.scripted.clearNotice',
  /** Open this extension's details page, where the "Allow User Scripts" toggle is. */
  openDetails: 'gv.scripted.openDetails',
} as const;

/**
 * Popup or panel to the page's content script, through the allowlisted tab
 * request: reload this page after the user clicked "Reload this page".
 */
export const SCRIPTED_RELOAD_PAGE_REQUEST = 'gv.scripted.reloadPage';

export type ScriptedMessage =
  | { readonly type: typeof SCRIPTED_MESSAGE.status }
  | { readonly type: typeof SCRIPTED_MESSAGE.recheck }
  | { readonly type: typeof SCRIPTED_MESSAGE.loaded }
  | {
      readonly type: typeof SCRIPTED_MESSAGE.clearNotice;
      readonly payload: { readonly id: string };
    }
  | { readonly type: typeof SCRIPTED_MESSAGE.openDetails };

export interface ScriptedStatus {
  readonly ok: true;
  readonly availability: UserScriptsAvailability;
  readonly stopped: boolean;
  readonly plugins: ReadonlyArray<{ readonly id: string; readonly runState: ScriptedRunState }>;
}

/**
 * How long a content script waits after `document.readyState` is `complete`
 * before it sends `loaded`: the timer firing proves the main thread is free,
 * and a page a script froze never sends it.
 */
export const SCRIPTED_LOADED_DELAY_MS = 3_000;

export function scriptedClearNoticeMessage(id: string): ScriptedMessage {
  return { type: SCRIPTED_MESSAGE.clearNotice, payload: { id } };
}

export function scriptedLoadedMessage(): ScriptedMessage {
  return { type: SCRIPTED_MESSAGE.loaded };
}

const TYPES = new Set<string>(Object.values(SCRIPTED_MESSAGE));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for any message whose `type` is one of ours, well-formed or not. */
export function isScriptedMessageType(value: unknown): boolean {
  return isRecord(value) && typeof value.type === 'string' && TYPES.has(value.type);
}

export function parseScriptedMessage(value: unknown): ScriptedMessage | undefined {
  if (!isRecord(value)) return undefined;
  switch (value.type) {
    case SCRIPTED_MESSAGE.status:
    case SCRIPTED_MESSAGE.recheck:
    case SCRIPTED_MESSAGE.loaded:
    case SCRIPTED_MESSAGE.openDetails:
      return { type: value.type };
    case SCRIPTED_MESSAGE.clearNotice: {
      const id = isRecord(value.payload) ? value.payload.id : undefined;
      return typeof id === 'string' && isLocalPluginId(id)
        ? { type: SCRIPTED_MESSAGE.clearNotice, payload: { id } }
        : undefined;
    }
    default:
      return undefined;
  }
}
