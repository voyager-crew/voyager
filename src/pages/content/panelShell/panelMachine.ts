/**
 * The panel window's phases, as a pure transition (see
 * `src/features/plugins/runtime/stateMachine.ts`):
 *
 * closed → requesting (the token is on its way) → shown → closing (the close
 * animation) → closed. A toggle while the token is pending cancels it; opening
 * again while the close plays keeps the same frame and session.
 */
import type { PanelToken } from '@/features/panel/protocol';

/** What the panel grows out of: a satellite, the ball itself, or nothing (the shortcut). */
export type PanelAnchor = 'satellite' | 'ball' | null;

export type PanelState =
  | { readonly status: 'closed' }
  | { readonly status: 'requesting'; readonly anchor: PanelAnchor }
  | {
      readonly status: 'shown';
      readonly anchor: PanelAnchor;
      readonly url: string;
      readonly token: PanelToken;
    }
  | {
      readonly status: 'closing';
      readonly anchor: PanelAnchor;
      readonly url: string;
      readonly token: PanelToken;
    };

export type PanelEvent =
  | { readonly type: 'open'; readonly anchor: PanelAnchor }
  | { readonly type: 'toggle'; readonly anchor: PanelAnchor }
  | { readonly type: 'close' }
  /** The secret stays in the content-script world; `url` has no redeemable authority. */
  | { readonly type: 'issued'; readonly url: string; readonly token: PanelToken }
  | { readonly type: 'refused' }
  /** The close animation ended. */
  | { readonly type: 'closed' }
  /** The frame left the page (the host replaced the body, say). */
  | { readonly type: 'gone' };

export const PANEL_CLOSED: PanelState = { status: 'closed' };

export function isPanelOpen(state: PanelState): boolean {
  return state.status === 'requesting' || state.status === 'shown';
}

export function transitionPanel(state: PanelState, event: PanelEvent): PanelState {
  switch (event.type) {
    case 'open':
      if (state.status === 'closed') {
        return { status: 'requesting', anchor: event.anchor };
      }
      if (state.status === 'closing') {
        return { status: 'shown', anchor: event.anchor, url: state.url, token: state.token };
      }
      return state;
    case 'toggle':
      return transitionPanel(
        state,
        isPanelOpen(state) ? { type: 'close' } : { type: 'open', anchor: event.anchor },
      );
    case 'close':
      if (state.status === 'requesting') return PANEL_CLOSED;
      if (state.status === 'shown') {
        return { status: 'closing', anchor: state.anchor, url: state.url, token: state.token };
      }
      return state;
    case 'issued':
      return state.status === 'requesting'
        ? { status: 'shown', anchor: state.anchor, url: event.url, token: event.token }
        : state;
    case 'refused':
      return state.status === 'requesting' ? PANEL_CLOSED : state;
    case 'closed':
      return state.status === 'closing' ? PANEL_CLOSED : state;
    case 'gone':
      return state.status === 'shown' || state.status === 'closing' ? PANEL_CLOSED : state;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
