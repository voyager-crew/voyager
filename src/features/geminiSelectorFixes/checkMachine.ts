/**
 * One host's selector check in the background, as explicit state for `startMachine`.
 *
 *   idle ─check─▶ preparing ─due─▶ fetching ─fetched─▶ committing ─committed─▶ recording
 *                    │ skipped/withdrawn │ failed/timedOut/withdrawn                │ recorded
 *                    └─────────┐         └──────────────▶ recording                  ▼
 *                              └─────────────────────────────────────────────▶ reporting ─reported─▶ idle
 *
 * A `check` while busy joins the running check, so tabs and manual checks share
 * one request and one reply. The check stays busy until its attempt time is saved:
 * OFF then ON cannot start a second request inside the six-hour window.
 *
 * `withdrawn` (consent turned off) leaves `preparing` and `fetching`; leaving
 * aborts the request, and a transport that answers anyway reaches a dead stay.
 * `committing` is not left, because its cache write cannot be recalled: the
 * effect finishes it and removes it again when `withdrawn` was set meanwhile.
 */
import type { GeminiSelectorFile } from '@/core/gemini/selectors/types';
import { logger } from '@/core/services/LoggerService';
import type { StateEffects } from '@/features/plugins/runtime/stateMachine';

import type {
  GeminiSelectorRefreshResult,
  GeminiSelectorResponse,
  GeminiSelectorStatus,
} from './messages';
import { isGeminiSelectorCheckDue } from './policy';

export type CheckReply = (response: GeminiSelectorResponse) => void;

interface Busy {
  /** Everyone waiting for this check, answered together from `reporting`. */
  readonly replies: readonly CheckReply[];
}

export type SelectorCheckState =
  | { readonly status: 'idle' }
  | ({ readonly status: 'preparing'; readonly force: boolean } & Busy)
  | ({ readonly status: 'fetching'; readonly attemptedAt: number } & Busy)
  | ({
      readonly status: 'committing';
      readonly attemptedAt: number;
      readonly file: GeminiSelectorFile;
      /** Consent was withdrawn while the cache write could still be in flight. */
      readonly withdrawn: boolean;
    } & Busy)
  | ({
      readonly status: 'recording';
      readonly attemptedAt: number;
      readonly result: GeminiSelectorRefreshResult;
    } & Busy)
  | ({
      readonly status: 'reporting';
      readonly outcome: GeminiSelectorRefreshResult | 'storageError';
    } & Busy);

export type SelectorCheckEvent =
  | { readonly type: 'check'; readonly force: boolean; readonly reply: CheckReply }
  /** Consent is off, or the request has to stop now. */
  | { readonly type: 'withdrawn' }
  | { readonly type: 'skipped'; readonly result: 'notDue' | 'disabled' }
  | { readonly type: 'due'; readonly attemptedAt: number }
  | { readonly type: 'fetched'; readonly file: GeminiSelectorFile }
  | { readonly type: 'fetchFailed' }
  | { readonly type: 'timedOut' }
  | { readonly type: 'committed'; readonly result: GeminiSelectorRefreshResult }
  | { readonly type: 'recorded'; readonly result: GeminiSelectorRefreshResult }
  | { readonly type: 'storageFailed' }
  | { readonly type: 'reported' };

export const IDLE_CHECK: SelectorCheckState = { status: 'idle' };

export function selectorCheckTransition(
  state: SelectorCheckState,
  event: SelectorCheckEvent,
): SelectorCheckState {
  if (event.type === 'check') {
    if (state.status === 'idle') {
      return { status: 'preparing', force: event.force, replies: [event.reply] };
    }
    return { ...state, replies: [...state.replies, event.reply] };
  }
  switch (state.status) {
    case 'idle':
      return state;
    case 'preparing':
      if (event.type === 'withdrawn') return report(state, 'disabled');
      if (event.type === 'skipped') return report(state, event.result);
      if (event.type === 'storageFailed') return report(state, 'storageError');
      if (event.type === 'due') {
        return { status: 'fetching', attemptedAt: event.attemptedAt, replies: state.replies };
      }
      return state;
    case 'fetching':
      if (event.type === 'fetched') {
        return { ...state, status: 'committing', file: event.file, withdrawn: false };
      }
      if (event.type === 'fetchFailed' || event.type === 'timedOut' || event.type === 'withdrawn') {
        return record(state, 'failed');
      }
      return state;
    case 'committing':
      if (event.type === 'withdrawn')
        return state.withdrawn ? state : { ...state, withdrawn: true };
      if (event.type === 'committed') return record(state, event.result);
      return state;
    case 'recording':
      if (event.type === 'recorded') return report(state, event.result);
      if (event.type === 'storageFailed') return report(state, 'storageError');
      return state;
    case 'reporting':
      return event.type === 'reported' ? IDLE_CHECK : state;
  }
}

function record(
  state: Busy & { readonly attemptedAt: number },
  result: GeminiSelectorRefreshResult,
): SelectorCheckState {
  return { status: 'recording', attemptedAt: state.attemptedAt, result, replies: state.replies };
}

function report(
  state: Busy,
  outcome: GeminiSelectorRefreshResult | 'storageError',
): SelectorCheckState {
  return { status: 'reporting', outcome, replies: state.replies };
}

/** The storage and network one host's check acts on. */
export interface SelectorCheckPorts {
  readonly timeoutMs: number;
  now(): number;
  status(result?: GeminiSelectorRefreshResult): Promise<GeminiSelectorStatus>;
  /** Re-reads consent; an unreadable value counts as off. */
  isEnabled(): Promise<boolean>;
  fetchFile(signal: AbortSignal): Promise<GeminiSelectorFile>;
  /** Stores a newer file; `withdrawn` is read again after each storage step. */
  commit(file: GeminiSelectorFile, withdrawn: () => boolean): Promise<GeminiSelectorRefreshResult>;
  recordAttempt(attemptedAt: number): Promise<void>;
}

const STORAGE_ERROR: GeminiSelectorResponse = { ok: false, error: 'storage' };

function storageFailed(error: unknown): void {
  logger.warn('Gemini selector refresh could not persist its state', { error: String(error) });
}

export function createSelectorCheckEffects(
  ports: SelectorCheckPorts,
): StateEffects<SelectorCheckState, SelectorCheckEvent> {
  return {
    preparing: (stay) => {
      void (async () => {
        const current = await ports.status();
        if (!current.enabled) return stay.send({ type: 'skipped', result: 'disabled' });
        if (!stay.state().force && !isGeminiSelectorCheckDue(current.lastAttemptAt, ports.now())) {
          return stay.send({ type: 'skipped', result: 'notDue' });
        }
        // Consent is read again right before fetch; force only bypasses the due time.
        if (!(await ports.isEnabled())) return stay.send({ type: 'skipped', result: 'disabled' });
        stay.send({ type: 'due', attemptedAt: ports.now() });
      })().catch((error: unknown) => {
        storageFailed(error);
        stay.send({ type: 'storageFailed' });
      });
    },
    fetching: (stay) => {
      stay.scope.timer(() => stay.send({ type: 'timedOut' }), ports.timeoutMs);
      ports.fetchFile(stay.signal).then(
        (file) => stay.send({ type: 'fetched', file }),
        (error: unknown) => {
          if (stay.signal.aborted) return;
          logger.warn('Gemini selector check failed', { error: String(error) });
          stay.send({ type: 'fetchFailed' });
        },
      );
    },
    committing: (stay) => {
      ports
        .commit(stay.state().file, () => stay.state().withdrawn)
        .then(
          (result) => stay.send({ type: 'committed', result }),
          (error: unknown) => {
            logger.warn('Gemini selector check failed', { error: String(error) });
            stay.send({ type: 'committed', result: 'failed' });
          },
        );
    },
    recording: (stay) => {
      const { attemptedAt, result } = stay.state();
      void (async () => {
        // Only completed attempts are saved; a worker dying mid-fetch may retry once on restart.
        await ports.recordAttempt(attemptedAt);
        const enabled = await ports.isEnabled();
        stay.send({ type: 'recorded', result: enabled ? result : 'disabled' });
      })().catch((error: unknown) => {
        storageFailed(error);
        stay.send({ type: 'storageFailed' });
      });
    },
    reporting: (stay) => {
      const { outcome } = stay.state();
      const response =
        outcome === 'storageError'
          ? Promise.resolve(STORAGE_ERROR)
          : ports.status(outcome).catch((error: unknown) => {
              storageFailed(error);
              return STORAGE_ERROR;
            });
      void response.then((reply) => {
        // Read at the end: a check that joined while this status was read gets the same answer.
        for (const answer of stay.state().replies) answer(reply);
        stay.send({ type: 'reported' });
      });
    },
  };
}
