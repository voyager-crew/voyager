import { startMachine } from '@/features/plugins/runtime/stateMachine';
import type { TimelineMarker } from '@/features/timeline/types';

import { makeServerTurnId } from '../fork/turnId';
import { OBS_SRC, normalizeTurnText } from '../timestamp/historyTimestamps';

const COMMAND_SOURCE = 'gv-history-observer-cmd';
type HistoryTurn = Readonly<{ id: string; summary: string }>;
type HistoryPage = { readonly turns: HistoryTurn[]; readonly hasOlder: boolean };
type HistoryState = { readonly turns: readonly HistoryTurn[] } & (
  | { readonly status: 'loading'; readonly page: number }
  | { readonly status: 'done' }
);
type HistoryEvent =
  | { readonly type: 'loaded'; readonly page: HistoryPage }
  | { readonly type: 'timeout' };

function transition(state: HistoryState, event: HistoryEvent): HistoryState {
  if (state.status !== 'loading') return state;
  if (event.type !== 'loaded') return { ...state, status: 'done' };
  const known = new Set(state.turns.map(({ id }) => id));
  // The native API returns newest first, including within each older page.
  const older = event.page.turns
    .slice()
    .reverse()
    .filter(({ id }) => {
      if (known.has(id)) return false;
      known.add(id);
      return true;
    });
  const turns = older.length ? [...older, ...state.turns] : state.turns;
  return event.page.hasOlder
    ? { status: 'loading', page: state.page + 1, turns }
    : { status: 'done', turns };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPage(data: unknown, id: string, path: string, page: number): HistoryPage | null {
  if (!isRecord(data) || data.source !== OBS_SRC || data.type !== 'timeline-page') return null;
  const packet = data.payload;
  if (
    !isRecord(packet) ||
    packet.id !== id ||
    packet.path !== path ||
    packet.page !== page ||
    typeof packet.hasOlder !== 'boolean' ||
    !Array.isArray(packet.turns)
  )
    return null;
  const turns: HistoryTurn[] = [];
  for (const entry of packet.turns) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string' || typeof entry[1] !== 'string')
      return null;
    const turnId = makeServerTurnId(entry[0]);
    if (!turnId) return null;
    turns.push({ id: turnId, summary: normalizeTurnText(entry[1]) || '…' });
  }
  return { turns, hasOlder: packet.hasOlder };
}

/** Route-scoped history for the rail. Placeholders never enter Gemini's transcript. */
export function startGeminiTimelineHistory(path: string, onChange: () => void) {
  if (
    location.origin !== 'https://gemini.google.com' ||
    location.pathname !== path ||
    !/^(?:\/u\/\d+)?\/(?:app|gem\/[^/]+)\/[a-f0-9]{8,}\/?$/i.test(path)
  )
    return null;
  const id = crypto.randomUUID();
  const placeholders = new Map<string, HTMLElement>();
  const post = (type: 'timeline-start' | 'timeline-stop') =>
    window.postMessage({ source: COMMAND_SOURCE, type, payload: { id, path } }, location.origin);
  const machine = startMachine<HistoryState, HistoryEvent>(
    {
      id: 'gemini-timeline-history',
      transition,
      effects: {
        loading(stay) {
          const timeout = stay.scope.timer(() => stay.send({ type: 'timeout' }), 12_000);
          stay.scope.on(window, 'message', (event) => {
            if (
              !(event instanceof MessageEvent) ||
              event.source !== window ||
              event.origin !== location.origin ||
              location.pathname !== path
            )
              return;
            const data = readPage(event.data, id, path, stay.state().page);
            if (!data) return;
            void timeout();
            stay.send({ type: 'loaded', page: data });
          });
          post('timeline-start');
        },
        done() {
          post('timeline-stop');
        },
      },
    },
    { status: 'loading', page: 0, turns: [] },
  );
  machine.subscribe((state, previous) => {
    if (state.turns !== previous.turns) onChange();
  });

  return {
    prepend(mounted: TimelineMarker[]): TimelineMarker[] {
      if (location.pathname !== path || !mounted.length) return mounted;
      const history = machine.state.turns;
      // Match by Gemini's server ID. A partial DOM with positional fallback IDs
      // cannot prove which part of the history it represents.
      const start = history.findIndex((turn) => turn.id === mounted[0].id);
      if (start <= 0) return mounted;
      const mountedIds = new Set(mounted.map((marker) => marker.id));
      const older = history.slice(0, start).filter((turn) => !mountedIds.has(turn.id));
      if (!older.length) return mounted;
      const lastIndex = Math.max(1, older.length + mounted.length - 1);
      const mountedStart = older.length / lastIndex;
      const prefetched = older.map(({ id, summary }, index): TimelineMarker => {
        let element = placeholders.get(id);
        if (!element) {
          element = document.createElement('div');
          placeholders.set(id, element);
        }
        return {
          id,
          element,
          summary,
          assistantSummary: '',
          baseN: index / lastIndex,
          starred: false,
          historyOnly: true,
        };
      });
      return [
        ...prefetched,
        ...mounted.map((marker) => ({
          ...marker,
          baseN: mountedStart + (1 - mountedStart) * marker.baseN,
        })),
      ];
    },
    stop() {
      void machine.stop();
      post('timeline-stop');
    },
  };
}
