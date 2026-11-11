import { afterEach, describe, expect, it, vi } from 'vitest';

import { startMachine } from '@/features/plugins/runtime/stateMachine';

import {
  PAGE_FACT_IDLE,
  type PageFactEvent,
  type PageFactState,
  pageFactEffects,
  pageFactTransition,
} from '../hooks/pageFact';

const SETTLE_MS = 400;

function pageWithAnswers() {
  const pending: ((fact: string | null) => void)[] = [];
  const machine = startMachine<PageFactState<string>, PageFactEvent<string>>(
    {
      id: 'test',
      transition: pageFactTransition,
      effects: pageFactEffects({
        settleMs: SETTLE_MS,
        ask: () => new Promise<string | null>((resolve) => pending.push(resolve)),
      }),
    },
    PAGE_FACT_IDLE,
  );
  return { machine, pending };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('a fact the panel asks the page for', () => {
  it('never shows the answer for a page the tab has already left', async () => {
    vi.useFakeTimers();
    const { machine, pending } = pageWithAnswers();
    machine.send({ type: 'want', key: 'https://chatgpt.com/c/one' });
    machine.send({ type: 'want', key: 'https://chatgpt.com/' });
    pending[0]('outline of the conversation');
    await vi.advanceTimersByTimeAsync(0);
    expect(machine.state.status).toBe('settling');

    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    pending[1]('outline of the home page');
    await vi.advanceTimersByTimeAsync(0);
    expect(machine.state).toEqual({
      status: 'known',
      key: 'https://chatgpt.com/',
      fact: 'outline of the home page',
    });
    await machine.stop();
  });

  it('reads a page that did not answer as unknown, and asks again once wanted again', async () => {
    const { machine, pending } = pageWithAnswers();
    machine.send({ type: 'want', key: 'page' });
    pending[0](null);
    await Promise.resolve();
    expect(machine.state.status).toBe('unknown');
    machine.send({ type: 'want', key: null });
    machine.send({ type: 'want', key: 'page' });
    expect(pending).toHaveLength(2);
    await machine.stop();
  });
});
