/**
 * The conversation's full list of user turns, read from the host's history
 * reader for one route (#1112). A virtualized host mounts only the turns near
 * the viewport, and one that reserves no height for the rest (ChatGPT) gives
 * the DOM no way to know they exist.
 *
 * Phases run on `startMachine`: a read the route outlives is aborted with its
 * stay, so a late answer never reaches the next conversation. A mounted turn
 * the list lacks (a prompt just sent, an edit) asks for a fresh read after a
 * short wait, a bounded number of times per route. A failed read keeps the
 * list it had, or none: the rail then lists the turns it has seen mounted.
 */
import { logger } from '@/core/services/LoggerService';
import { type Machine, startMachine } from '@/features/plugins/runtime/stateMachine';

/** One user turn, in conversation order. */
export interface HistoryTurn {
  /** The host's key for the turn, as a mounted turn's key attribute carries it. */
  readonly key: string;
  /** The prompt as the rail summarises a mounted bubble: whitespace collapsed. */
  readonly summary: string;
  /** Original history hash when host metadata was removed from the displayed summary. */
  readonly sourceHash?: string;
  readonly assistantSummary: string;
}

/** A site's reader and how a mounted turn names the key it reports. */
export interface CatalogTimelineHistory {
  readonly keyAttributes: readonly string[];
  load(conversationId: string, signal: AbortSignal): Promise<readonly HistoryTurn[]>;
}

/** Reads per route, the first included; a long session past it relies on mounted turns. */
export const MAX_HISTORY_READS = 10;
/** Wait after a mounted turn the list lacks, so a send is saved before the read. */
export const HISTORY_REFETCH_DELAY_MS = 3000;
/** Give the complete list a head start, then let a slow host fall back to mounted turns. */
export const INITIAL_HISTORY_WAIT_MS = 6500;

type Turns = readonly HistoryTurn[] | null;

export type HistoryState =
  | { readonly status: 'reading'; readonly turns: Turns; readonly reads: number }
  | { readonly status: 'settled'; readonly turns: Turns; readonly reads: number }
  | { readonly status: 'waiting'; readonly turns: Turns; readonly reads: number };

export type HistoryEvent =
  | { readonly type: 'loaded'; readonly turns: readonly HistoryTurn[] }
  | { readonly type: 'failed' }
  | { readonly type: 'unknownTurn' }
  | { readonly type: 'due' };

export function historyTransition(state: HistoryState, event: HistoryEvent): HistoryState {
  switch (event.type) {
    case 'loaded':
      return state.status === 'reading'
        ? { status: 'settled', turns: event.turns, reads: state.reads }
        : state;
    case 'failed':
      return state.status === 'reading' ? { ...state, status: 'settled' } : state;
    case 'unknownTurn':
      return state.status === 'settled' && state.reads < MAX_HISTORY_READS
        ? { ...state, status: 'waiting' }
        : state;
    case 'due':
      return state.status === 'waiting'
        ? { ...state, status: 'reading', reads: state.reads + 1 }
        : state;
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

export interface HistoryLoader {
  /** Releases the initial rail on the first result or the bounded startup wait. */
  readonly initialReady: Promise<void>;
  /** The latest list read for this route, or null before one succeeds. */
  turns(): Turns;
  /** A mounted turn's key is missing from the list. */
  reportUnknown(): void;
  stop(): Promise<void>;
}

export function startHistoryLoader(
  history: CatalogTimelineHistory,
  conversationId: string,
  onChange: () => void,
): HistoryLoader {
  let releaseInitial = () => {};
  const initialReady = new Promise<void>((resolve) => {
    releaseInitial = resolve;
  });
  const machine: Machine<HistoryState, HistoryEvent> = startMachine<HistoryState, HistoryEvent>(
    {
      id: 'timeline-history',
      transition: historyTransition,
      effects: {
        reading: (stay) => {
          if (stay.state().reads === 1) stay.scope.timer(releaseInitial, INITIAL_HISTORY_WAIT_MS);
          history.load(conversationId, stay.signal).then(
            (turns) => stay.send({ type: 'loaded', turns }),
            (error: unknown) => {
              if (!stay.signal.aborted)
                logger.debug('Timeline history read failed; keeping mounted turns', {
                  error: String(error),
                });
              stay.send({ type: 'failed' });
            },
          );
        },
        waiting: (stay) => {
          stay.scope.timer(() => stay.send({ type: 'due' }), HISTORY_REFETCH_DELAY_MS);
        },
      },
    },
    { status: 'reading', turns: null, reads: 1 },
  );
  machine.subscribe((state, previous) => {
    if (state.status === 'settled') releaseInitial();
    if (state.turns !== previous.turns) onChange();
  });
  return {
    initialReady,
    turns: () => machine.state.turns,
    reportUnknown: () => machine.send({ type: 'unknownTurn' }),
    stop: () => {
      releaseInitial();
      return machine.stop();
    },
  };
}
