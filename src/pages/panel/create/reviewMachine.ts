/**
 * Reviewing a reply the user picked on the page, as phases (see
 * `features/plugins/runtime/stateMachine.ts`):
 *
 * idle → loading (fetch the pick once from the page) → checking (the gate,
 * again: the panel never trusts the page's verdict) → reviewing | rejected →
 * installing → installed (→ turningOn when site access was refused). A
 * refused import or enable because the install changed meanwhile goes back
 * to checking, flagged, so the user reviews what is there now.
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
  | { readonly status: 'loading' }
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
    }
  | {
      readonly status: 'installed';
      readonly manifest: PluginManifest;
      readonly enabled: boolean;
      readonly reload: boolean;
    }
  | { readonly status: 'turningOn'; readonly manifest: PluginManifest; readonly reload: boolean }
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

const busy = (state: ReviewState): boolean =>
  state.status === 'installing' || state.status === 'turningOn';

export function reviewTransition(state: ReviewState, event: ReviewEvent): ReviewState {
  switch (event.type) {
    case 'request':
      // A write in flight finishes first; the pick waits on the page for the next request.
      return busy(state) ? state : { status: 'loading' };
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
        ? { status: 'installing', candidate: state.candidate, checked: state.checked }
        : state;
    case 'outcome': {
      if (state.status !== 'installing') return state;
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
        ? { status: 'turningOn', manifest: state.manifest, reload: state.reload }
        : state;
    case 'turnedOn':
      return state.status === 'turningOn'
        ? {
            status: 'installed',
            manifest: state.manifest,
            enabled: event.enabled,
            reload: state.reload,
          }
        : state;
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
      void ports
        .fetchPending()
        .then((candidate) => stay.send({ type: 'loaded', candidate }))
        .catch(() => stay.send({ type: 'loaded', candidate: null }));
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
