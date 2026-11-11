/**
 * Reviewing a reply the user picked on the page, as phases (see
 * `features/plugins/runtime/stateMachine.ts`):
 *
 * idle → loading (fetch the pick once from the page) → checking (the gate,
 * again: the panel never trusts the page's verdict) → reviewing | rejected →
 * installing → installed (→ turningOn when site access was refused). A
 * refused import or enable because the install changed meanwhile goes back
 * to checking, flagged, so the user reviews what is there now.
 *
 * The page holds only the latest pick. A pick made while a fetch is out is
 * fetched again before the result counts; one made during a write waits for
 * the write and is then fetched, so the panel always acts on the latest pick.
 */
import type { CreationReviewCandidate } from '@/features/plugins/local/creation/messages';
import type { CheckedPluginReply } from '@/features/plugins/local/pluginReply';
import type { ManifestIssue } from '@/features/plugins/manifest/validate';
import type { StateEffects } from '@/features/plugins/runtime/stateMachine';
import type { PluginManifest } from '@/features/plugins/types';

import type { AcceptedReply, InstallOutcome } from './installReviewed';

type RejectedReply = Extract<CheckedPluginReply, { ok: false }>;

export type ReviewState =
  | { readonly status: 'idle' }
  /** `requests` counts the picks made during this fetch; each one needs another. */
  | { readonly status: 'loading'; readonly requests: number }
  | {
      readonly status: 'checking';
      readonly candidate: CreationReviewCandidate;
      readonly changed: boolean;
    }
  | {
      readonly status: 'reviewing';
      readonly candidate: CreationReviewCandidate;
      readonly checked: AcceptedReply;
      readonly changed: boolean;
    }
  | { readonly status: 'rejected'; readonly checked: RejectedReply }
  | {
      readonly status: 'installing';
      readonly candidate: CreationReviewCandidate;
      readonly checked: AcceptedReply;
      /** A newer pick waits on the page for this write to finish. */
      readonly queued: boolean;
    }
  | {
      readonly status: 'installed';
      readonly manifest: PluginManifest;
      readonly enabled: boolean;
      readonly reload: boolean;
    }
  | {
      readonly status: 'turningOn';
      readonly manifest: PluginManifest;
      readonly reload: boolean;
      readonly queued: boolean;
    }
  | { readonly status: 'failed'; readonly issues: readonly ManifestIssue[] };

export type ReviewEvent =
  /** The page says the user picked a reply. */
  | { readonly type: 'request' }
  | { readonly type: 'loaded'; readonly candidate: CreationReviewCandidate | null }
  | { readonly type: 'checked'; readonly result: CheckedPluginReply }
  | { readonly type: 'install' }
  | { readonly type: 'outcome'; readonly outcome: InstallOutcome }
  | { readonly type: 'turnOn' }
  | { readonly type: 'turnedOn'; readonly enabled: boolean }
  | { readonly type: 'dismiss' };

export const REVIEW_IDLE: ReviewState = { status: 'idle' };
const LOADING: ReviewState = { status: 'loading', requests: 0 };

const busy = (state: ReviewState): boolean =>
  state.status === 'installing' || state.status === 'turningOn';

export function reviewTransition(state: ReviewState, event: ReviewEvent): ReviewState {
  switch (event.type) {
    case 'request':
      if (state.status === 'loading') return { ...state, requests: state.requests + 1 };
      // A write in flight finishes first; the pick waits on the page until then.
      return state.status === 'installing' || state.status === 'turningOn'
        ? { ...state, queued: true }
        : LOADING;
    case 'loaded':
      if (state.status !== 'loading') return state;
      return event.candidate
        ? { status: 'checking', candidate: event.candidate, changed: false }
        : REVIEW_IDLE;
    case 'checked':
      if (state.status !== 'checking') return state;
      return event.result.ok
        ? {
            status: 'reviewing',
            candidate: state.candidate,
            checked: event.result,
            changed: state.changed,
          }
        : { status: 'rejected', checked: event.result };
    case 'install':
      return state.status === 'reviewing'
        ? {
            status: 'installing',
            candidate: state.candidate,
            checked: state.checked,
            queued: false,
          }
        : state;
    case 'outcome': {
      if (state.status !== 'installing') return state;
      if (state.queued) return LOADING;
      const { outcome } = event;
      if (outcome.kind === 'changed')
        return { status: 'checking', candidate: state.candidate, changed: true };
      if (outcome.kind === 'failed') return { status: 'failed', issues: outcome.issues };
      return {
        status: 'installed',
        manifest: outcome.manifest,
        enabled: outcome.enabled,
        reload: outcome.reload,
      };
    }
    case 'turnOn':
      return state.status === 'installed' && !state.enabled
        ? { status: 'turningOn', manifest: state.manifest, reload: state.reload, queued: false }
        : state;
    case 'turnedOn':
      if (state.status !== 'turningOn') return state;
      if (state.queued) return LOADING;
      return {
        status: 'installed',
        manifest: state.manifest,
        enabled: event.enabled,
        reload: state.reload,
      };
    case 'dismiss':
      return busy(state) ? state : REVIEW_IDLE;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export interface ReviewPorts {
  fetchPending(): Promise<CreationReviewCandidate | null>;
  check(text: string): Promise<CheckedPluginReply>;
  install(checked: AcceptedReply): Promise<InstallOutcome>;
  turnOn(manifest: PluginManifest): Promise<boolean>;
}

const failure = (error: unknown): readonly ManifestIssue[] => [
  { path: '', message: error instanceof Error ? error.message : String(error) },
];

export function reviewEffects(ports: ReviewPorts): StateEffects<ReviewState, ReviewEvent> {
  return {
    loading: (stay) => {
      // An overtaken fetch may have taken either pick; a later empty answer keeps it.
      const fetchFor = (requests: number, newest: CreationReviewCandidate | null): void => {
        void ports
          .fetchPending()
          .catch(() => null)
          .then((candidate) => {
            const latest = candidate ?? newest;
            const now = stay.state().requests;
            if (now !== requests && !stay.signal.aborted) fetchFor(now, latest);
            else stay.send({ type: 'loaded', candidate: latest });
          });
      };
      fetchFor(stay.state().requests, null);
    },
    checking: (stay) => {
      void ports
        .check(stay.state().candidate.text)
        .then((result) => stay.send({ type: 'checked', result }))
        .catch((error: unknown) =>
          stay.send({ type: 'checked', result: { ok: false, issues: failure(error) } }),
        );
    },
    installing: (stay) => {
      void ports
        .install(stay.state().checked)
        .then((outcome) => stay.send({ type: 'outcome', outcome }))
        .catch((error: unknown) =>
          stay.send({ type: 'outcome', outcome: { kind: 'failed', issues: failure(error) } }),
        );
    },
    turningOn: (stay) => {
      void ports
        .turnOn(stay.state().manifest)
        .then((enabled) => stay.send({ type: 'turnedOn', enabled }))
        .catch(() => stay.send({ type: 'turnedOn', enabled: false }));
    },
  };
}
