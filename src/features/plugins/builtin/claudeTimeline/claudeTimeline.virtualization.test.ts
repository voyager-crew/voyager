import './__tests__/claudeTimelineHarness';
/** The Claude timeline while Claude virtualizes turns: stable ids, ordering, homing and stop. */
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { hashString } from '@/core/utils/hash';
import { buildTurnId } from '@/features/timeline/adapters/catalog/turnMerge';

import {
  startClaudeTimeline,
  stopClaudeTimeline,
  createTurn,
  addTurn,
  queryDots,
  dotLabels,
  flush,
  settleRefresh,
  useClaudeTimelinePage,
} from './__tests__/claudeTimelineHarness';

describe('Claude timeline', () => {
  useClaudeTimelinePage();

  it('keeps dots and ids stable when Claude virtualizes turns out during scroll', async () => {
    const first = addTurn('first prompt');
    addTurn('second prompt');
    startClaudeTimeline();
    await flush();
    expect(queryDots()).toHaveLength(2);
    const secondDotId = queryDots()[1].dataset.targetTurnId;

    // Scroll: Claude unmounts the first turn and mounts a newly visible one.
    first.remove();
    addTurn('third prompt');
    await settleRefresh();

    expect(dotLabels()).toEqual(['first prompt', 'second prompt', 'third prompt']);
    expect(queryDots()[1].dataset.targetTurnId).toBe(secondDotId);

    // Scrolling back re-mounts the first turn: nothing is duplicated.
    document.body.insertBefore(first, document.body.firstChild);
    await settleRefresh();
    expect(dotLabels()).toEqual(['first prompt', 'second prompt', 'third prompt']);
  });

  it('stitches older turns ahead of known ones when scrolling up', async () => {
    const third = addTurn('third prompt');
    const fourth = addTurn('fourth prompt');
    startClaudeTimeline();
    await flush();
    expect(queryDots()).toHaveLength(2);

    // Scrolling up: Claude mounts [first, second, third] and unmounts fourth.
    fourth.remove();
    document.body.insertBefore(createTurn('second prompt'), third);
    document.body.insertBefore(createTurn('first prompt'), third.previousSibling);
    await settleRefresh();

    expect(dotLabels()).toEqual(['first prompt', 'second prompt', 'third prompt', 'fourth prompt']);
  });

  it('files a remounted window of repeats past a turn measured before the page above shrank', async () => {
    // All fixture turns are visible; thousands of jsdom cascade reads obscure the merge behavior.
    const visibleStyle = getComputedStyle(document.body);
    const computedStyle = vi.spyOn(globalThis, 'getComputedStyle').mockReturnValue(visibleStyle);
    onTestFinished(() => computedStyle.mockRestore());
    const placeAt = (turn: HTMLElement, top: number): void => {
      turn.getBoundingClientRect = () => ({ top, bottom: top + 40, height: 40 }) as DOMRect;
    };
    // 700 identical prompts below a 100000px answer.
    const turns = Array.from({ length: 700 }, (_, index) => {
      const turn = addTurn('continue');
      placeAt(turn, 100_000 + 100 * index);
      return turn;
    });
    startClaudeTimeline();
    await flush();
    const ids = turns.map((turn) => turn.getAttribute('data-gv-turn-id'));
    expect(new Set(ids).size).toBe(700);

    // The answer collapses while turn 1 is virtualized out: only it keeps its old place.
    turns[1].remove();
    turns.forEach((turn, index) => placeAt(turn, 100 * index));
    document.body.appendChild(createTurn('marker'));
    await settleRefresh();

    // Claude remounts its thread; extension-owned UI stays outside that host subtree.
    document
      .querySelectorAll('[data-testid="user-message"]')
      .forEach((element) => element.remove());
    const window = Array.from({ length: 400 }, (_, r) => {
      const turn = addTurn('continue');
      placeAt(turn, 100 * (300 + r));
      return turn;
    });
    await settleRefresh();

    expect(window.map((turn) => turn.getAttribute('data-gv-turn-id'))).toEqual(ids.slice(300));
  });

  it('never shrinks when the mounted window turns sparse mid-transition', async () => {
    const turns = ['one', 'two', 'three', 'four', 'five'].map((text) => addTurn(text));
    startClaudeTimeline();
    await flush();
    expect(queryDots()).toHaveLength(5);

    // Jump from bottom to top: Claude briefly mounts a non-contiguous set
    // (top + bottom windows coexist) — the accumulated timeline must not drop
    // the unmounted turns in between.
    turns[1].remove();
    turns[2].remove();
    turns[3].remove();
    await settleRefresh();
    expect(dotLabels()).toEqual(['one', 'two', 'three', 'four', 'five']);

    // Turns re-mount as their region scrolls back in: still no duplicates.
    document.body.insertBefore(turns[2], turns[4]);
    await settleRefresh();
    expect(dotLabels()).toEqual(['one', 'two', 'three', 'four', 'five']);
  });

  it('keeps the opening turns ahead of the bottom window when Claude leaves the latest turn mounted', async () => {
    const rect = (top: number) => vi.fn(() => ({ top, bottom: top + 40, height: 40 }) as DOMRect);
    // Loaded at the bottom: only the last turns are mounted.
    const lateOne = addTurn('late one');
    const lateTwo = addTurn('late two');
    const last = addTurn('last prompt');
    lateOne.getBoundingClientRect = rect(38000);
    lateTwo.getBoundingClientRect = rect(38500);
    last.getBoundingClientRect = rect(39000);
    startClaudeTimeline();
    await flush();
    expect(dotLabels()).toEqual(['late one', 'late two', 'last prompt']);

    // Scrolled to the top: Claude mounts the opening turns, unmounts the late
    // ones, but keeps the latest turn mounted (and re-measured further down).
    lateOne.remove();
    lateTwo.remove();
    const first = createTurn('first prompt');
    const second = createTurn('second prompt');
    first.getBoundingClientRect = rect(100);
    second.getBoundingClientRect = rect(1200);
    document.body.insertBefore(second, last);
    document.body.insertBefore(first, second);
    last.getBoundingClientRect = rect(41600);
    await settleRefresh();

    expect(dotLabels()).toEqual([
      'first prompt',
      'second prompt',
      'late one',
      'late two',
      'last prompt',
    ]);
  });

  it('places a new turn by the drift of its nearer anchor when the two anchors drifted differently', async () => {
    const rect = (top: number) => vi.fn(() => ({ top, bottom: top + 40, height: 40 }) as DOMRect);
    const a = addTurn('turn a');
    const b = addTurn('turn b');
    const c = addTurn('turn c');
    const d = addTurn('turn d');
    a.getBoundingClientRect = rect(1000);
    b.getBoundingClientRect = rect(2000);
    c.getBoundingClientRect = rect(3000);
    d.getBoundingClientRect = rect(4000);
    startClaudeTimeline();
    await flush();

    // b and c unmount; a stays where it was, d is re-measured 2000px lower, and
    // a new turn x mounts between them at 2600. Under a's drift (0) x sits
    // after b; only under d's drift would it land before b.
    b.remove();
    c.remove();
    const x = createTurn('turn x');
    x.getBoundingClientRect = rect(2600);
    document.body.insertBefore(x, d);
    d.getBoundingClientRect = rect(6000);
    await settleRefresh();

    expect(dotLabels()).toEqual(['turn a', 'turn b', 'turn x', 'turn c', 'turn d']);
  });

  it('files a bottom window behind the known opening turns when the first turn stays mounted', async () => {
    const rect = (top: number) => vi.fn(() => ({ top, bottom: top + 40, height: 40 }) as DOMRect);
    const first = addTurn('first prompt');
    const second = addTurn('second prompt');
    const third = addTurn('third prompt');
    first.getBoundingClientRect = rect(100);
    second.getBoundingClientRect = rect(1200);
    third.getBoundingClientRect = rect(2300);
    startClaudeTimeline();
    await flush();

    second.remove();
    third.remove();
    const late = addTurn('late prompt');
    const last = addTurn('last prompt');
    late.getBoundingClientRect = rect(38000);
    last.getBoundingClientRect = rect(39000);
    await settleRefresh();

    expect(dotLabels()).toEqual([
      'first prompt',
      'second prompt',
      'third prompt',
      'late prompt',
      'last prompt',
    ]);
  });

  it('assigns distinct ids to turns with identical text', async () => {
    addTurn('same text');
    addTurn('same text');
    startClaudeTimeline();
    await flush();

    const ids = queryDots().map((dot) => dot.dataset.targetTurnId);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toBe(buildTurnId('same text'));
    expect(ids[1]).toBe(`${buildTurnId('same text')}~2`);
  });

  it('keeps homing toward a virtualized-out turn until it mounts, then aims precisely', async () => {
    const first = addTurn('first prompt');
    const second = addTurn('second prompt');
    first.getBoundingClientRect = vi.fn(() => ({ top: 0, bottom: 40, height: 40 }) as DOMRect);
    second.getBoundingClientRect = vi.fn(() => ({ top: 700, bottom: 740, height: 40 }) as DOMRect);
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 2000,
    });
    startClaudeTimeline();
    await flush();

    second.remove();
    await settleRefresh();
    expect(queryDots()).toHaveLength(2);

    // First hop jumps instantly to the remembered offset (center 720 → top 450).
    queryDots()[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 450, behavior: 'instant' });

    // Still unmounted after a hop interval: bisect further instead of giving up.
    vi.advanceTimersByTime(200);
    expect(window.scrollTo).toHaveBeenCalledTimes(2);
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 1030, behavior: 'instant' });

    // Turn mounts: the next hop aims precisely and stops.
    document.body.appendChild(second);
    await flush();
    vi.advanceTimersByTime(200);
    await flush();
    expect(window.scrollTo).toHaveBeenCalledTimes(3);
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 450, behavior: 'smooth' });

    vi.advanceTimersByTime(600);
    expect(window.scrollTo).toHaveBeenCalledTimes(3);
  });

  it('homes into a virtualization gap between mounted turns', async () => {
    const first = addTurn('first prompt');
    const second = addTurn('second prompt');
    const third = addTurn('third prompt');
    first.getBoundingClientRect = vi.fn(() => ({ top: 0, bottom: 40, height: 40 }) as DOMRect);
    second.getBoundingClientRect = vi.fn(() => ({ top: 700, bottom: 740, height: 40 }) as DOMRect);
    third.getBoundingClientRect = vi.fn(() => ({ top: 1300, bottom: 1340, height: 40 }) as DOMRect);
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 2000,
    });
    startClaudeTimeline();
    await flush();

    second.remove();
    await settleRefresh();
    expect(queryDots()).toHaveLength(3);

    // Target sits between two mounted turns: probe its remembered offset...
    queryDots()[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 450, behavior: 'instant' });

    // ...then bisect between the mounted neighbours instead of giving up.
    vi.advanceTimersByTime(200);
    expect(window.scrollTo).toHaveBeenCalledTimes(2);
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 400, behavior: 'instant' });

    document.body.insertBefore(second, third);
    await flush();
    vi.advanceTimersByTime(200);
    await flush();
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 450, behavior: 'smooth' });
  });

  it('glides a long jump to a mounted turn, then fine-aims once it settles', async () => {
    const first = addTurn('first prompt');
    const second = addTurn('second prompt');
    first.getBoundingClientRect = vi.fn(() => ({ top: 0, bottom: 40, height: 40 }) as DOMRect);
    second.getBoundingClientRect = vi.fn(
      () => ({ top: 5000, bottom: 5040, height: 40 }) as DOMRect,
    );
    startClaudeTimeline();
    await flush();

    // Distance > 3 viewports: glide, then fine-aim once the region re-measures.
    queryDots()[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 4750, behavior: 'smooth' });

    // The homing hop must not fire into a scroll that is still moving, so it
    // waits for two identical reads (2 x 80ms) before its own 200ms.
    vi.advanceTimersByTime(200);
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200);
    expect(window.scrollTo).toHaveBeenCalledTimes(2);
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 4750, behavior: 'smooth' });

    vi.advanceTimersByTime(600);
    expect(window.scrollTo).toHaveBeenCalledTimes(2);
  });

  it('stops homing when the user scrolls manually', async () => {
    const first = addTurn('first prompt');
    const second = addTurn('second prompt');
    first.getBoundingClientRect = vi.fn(() => ({ top: 0, bottom: 40, height: 40 }) as DOMRect);
    second.getBoundingClientRect = vi.fn(() => ({ top: 700, bottom: 740, height: 40 }) as DOMRect);
    startClaudeTimeline();
    await flush();

    second.remove();
    await settleRefresh();

    queryDots()[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(window.scrollTo).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('wheel'));
    vi.advanceTimersByTime(1000);
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
  });

  it('consumes a gv-turn hash once instead of re-navigating on every refresh', async () => {
    addTurn('first prompt');
    const second = addTurn('second prompt');
    second.getBoundingClientRect = vi.fn(() => ({ top: 700, bottom: 740, height: 40 }) as DOMRect);
    const legacyHashId = `c-1-${hashString('second prompt')}`;
    history.replaceState({}, '', `/chat/claude-123#gv-turn-${legacyHashId}`);

    startClaudeTimeline();
    await flush();

    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 450, behavior: 'smooth' });

    addTurn('third prompt');
    await settleRefresh();
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
  });

  it('keeps existing dots on unrelated DOM changes', async () => {
    addTurn('first prompt');
    startClaudeTimeline();
    await flush();
    const dot = queryDots()[0];

    document.body.appendChild(document.createElement('main'));
    await settleRefresh();

    expect(queryDots()[0]).toBe(dot);
  });

  it('rolls back data-gv-turn-id stamps on stop', async () => {
    addTurn('first prompt');
    startClaudeTimeline();
    await flush();
    expect(document.querySelectorAll('[data-gv-turn-id]').length).toBeGreaterThan(0);

    await stopClaudeTimeline();
    expect(document.querySelectorAll('[data-gv-turn-id]').length).toBe(0);
  });

  it('removes UI on stop', async () => {
    addTurn('first prompt');
    startClaudeTimeline();
    await flush();
    expect(document.querySelector('.gemini-timeline-bar')).toBeTruthy();

    await stopClaudeTimeline();
    expect(document.querySelector('.gemini-timeline-bar')).toBeNull();
    expect(document.querySelector('.timeline-preview-toggle')).toBeNull();
    expect(document.querySelector('#gv-turn-navigator-tooltip')).toBeNull();
  });
});
