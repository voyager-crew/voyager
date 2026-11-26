import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type CatalogTimelineHistory,
  HISTORY_REFETCH_DELAY_MS,
  type HistoryTurn,
  MAX_HISTORY_READS,
  startHistoryLoader,
} from './historyLoader';

const TURNS: HistoryTurn[] = [{ key: 'a', summary: 'A', assistantSummary: '' }];

function deferredHistory() {
  const reads: { resolve: (turns: HistoryTurn[]) => void; signal: AbortSignal }[] = [];
  const history: CatalogTimelineHistory = {
    keyAttributes: ['data-turn-key'],
    load: (_id, signal) =>
      new Promise((resolve) => {
        reads.push({ resolve, signal });
      }),
  };
  return { history, reads };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('timeline history loader', () => {
  it('ignores a read that lands after its route ended', async () => {
    const { history, reads } = deferredHistory();
    const onChange = vi.fn();
    const loader = startHistoryLoader(history, 'first', onChange);
    await loader.stop();

    expect(reads[0].signal.aborted).toBe(true);
    reads[0].resolve(TURNS);
    await vi.advanceTimersByTimeAsync(0);
    expect(onChange).not.toHaveBeenCalled();
    expect(loader.turns()).toBeNull();
  });

  it('re-reads after an unknown turn, a bounded number of times per route', async () => {
    const { history, reads } = deferredHistory();
    const loader = startHistoryLoader(history, 'first', () => {});
    for (let read = 0; read < MAX_HISTORY_READS + 3; read++) {
      reads.at(-1)?.resolve(TURNS);
      await vi.advanceTimersByTimeAsync(0);
      loader.reportUnknown();
      await vi.advanceTimersByTimeAsync(HISTORY_REFETCH_DELAY_MS);
    }

    expect(reads).toHaveLength(MAX_HISTORY_READS);
    await loader.stop();
  });

  it('keeps the list it had when a re-read fails', async () => {
    let calls = 0;
    const history: CatalogTimelineHistory = {
      keyAttributes: ['data-turn-key'],
      load: async () => {
        calls += 1;
        if (calls > 1) throw new Error('429');
        return TURNS;
      },
    };
    const loader = startHistoryLoader(history, 'first', () => {});
    await vi.advanceTimersByTimeAsync(0);
    loader.reportUnknown();
    await vi.advanceTimersByTimeAsync(HISTORY_REFETCH_DELAY_MS);

    expect(calls).toBe(2);
    expect(loader.turns()).toBe(TURNS);
    await loader.stop();
  });
});
