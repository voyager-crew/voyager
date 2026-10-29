/**
 * Delivery of one generation's finished reply, shared by the Gemini and
 * ChatGPT runs. Each run starts one machine per generation and stops the
 * previous one when the next generation starts or the page leaves the
 * conversation, so a notify answer, a deferred toast or a stop from an earlier
 * generation cannot act on a later one.
 *
 *   streaming ──completed (background)──▶ notifying ──answered ok──▶ ended(notified)
 *       │                                     └──answered not ok──▶ deferred ──returned──▶ showing
 *       ├──completed (foreground)───────────────────────────────────────────────────────▶ showing
 *       └──abandoned (stopped, failed, unprompted)──▶ ended            showing ──shown──▶ ended(shown)
 *
 * Detection (when a reply counts as finished) stays in each run; this owns
 * only what happens after.
 */
import {
  type Machine,
  type StateEffects,
  startMachine,
} from '@/features/plugins/runtime/stateMachine';

/** Why a generation ended with nothing to deliver. */
export type CompletionAbandonReason =
  /** The user pressed stop. */
  | 'stopped'
  /** The request failed or was cancelled. */
  | 'failed'
  /** A foreground completion the user did not prompt from this page. */
  | 'unprompted';

export type CompletionEndReason = CompletionAbandonReason | 'notified' | 'shown';

/** The reply the completion is about; null when the site reads it at show time. */
export type CompletionReply = HTMLElement | null;

export type CompletionState =
  /** The generation has not ended yet. */
  | { readonly status: 'streaming' }
  /** Waiting for the background to answer whether the system notification showed. */
  | { readonly status: 'notifying'; readonly reply: CompletionReply }
  /** The system notification did not show; the toast waits until the user is back. */
  | { readonly status: 'deferred'; readonly reply: CompletionReply }
  /** Showing the in-page toast. */
  | { readonly status: 'showing'; readonly reply: CompletionReply }
  | { readonly status: 'ended'; readonly reason: CompletionEndReason };

export type CompletionEvent =
  /** `background`: the user is not looking at the page, so the system notification is asked for. */
  | { readonly type: 'completed'; readonly reply: CompletionReply; readonly background: boolean }
  | { readonly type: 'answered'; readonly ok: boolean }
  /** The user is back on the page that still shows the reply. */
  | { readonly type: 'returned' }
  | { readonly type: 'shown' }
  | { readonly type: 'abandoned'; readonly reason: CompletionAbandonReason };

/** What delivery needs from the site's run. */
export interface CompletionPort {
  /** Asks for the system notification; resolves whether it was shown. */
  notify(reply: CompletionReply): Promise<boolean>;
  /** Shows the in-page toast that scrolls to the reply. */
  showToast(reply: CompletionReply): void;
  /** Whether a deferred toast may show now; it may first resync the page, stopping this machine. */
  canFlush(): boolean;
}

export const INITIAL_COMPLETION_STATE: CompletionState = { status: 'streaming' };

const ended = (reason: CompletionEndReason): CompletionState => ({ status: 'ended', reason });

export function completionTransition(
  state: CompletionState,
  event: CompletionEvent,
): CompletionState {
  switch (state.status) {
    case 'streaming':
      if (event.type === 'abandoned') return ended(event.reason);
      if (event.type !== 'completed') return state;
      return { status: event.background ? 'notifying' : 'showing', reply: event.reply };
    case 'notifying':
      if (event.type !== 'answered') return state;
      return event.ok ? ended('notified') : { status: 'deferred', reply: state.reply };
    case 'deferred':
      return event.type === 'returned' ? { status: 'showing', reply: state.reply } : state;
    case 'showing':
      return event.type === 'shown' ? ended('shown') : state;
    case 'ended':
      return state;
  }
}

export function completionEffects(
  port: CompletionPort,
): StateEffects<CompletionState, CompletionEvent> {
  return {
    notifying: (stay) => {
      void port.notify(stay.state().reply).then(
        (ok) => stay.send({ type: 'answered', ok }),
        () => stay.send({ type: 'answered', ok: false }),
      );
    },
    deferred: (stay) => {
      const flush = (): void => {
        // A resync inside canFlush may stop this machine; `send` is dead by then, so no toast.
        if (!stay.signal.aborted && port.canFlush()) stay.send({ type: 'returned' });
      };
      stay.scope.on(window, 'focus', flush);
      stay.scope.on(document, 'visibilitychange', flush);
    },
    showing: (stay) => {
      port.showToast(stay.state().reply);
      stay.send({ type: 'shown' });
    },
  };
}

/** Starts delivery for one generation; the run stops it when the next one starts. */
export function startCompletion(
  effects: StateEffects<CompletionState, CompletionEvent>,
): Machine<CompletionState, CompletionEvent> {
  return startMachine<CompletionState, CompletionEvent>(
    { id: 'response-completion', transition: completionTransition, effects },
    INITIAL_COMPLETION_STATE,
  );
}
