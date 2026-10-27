import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TimelineMarker } from '@/features/timeline/types';

import { TimelineTurns } from '../TimelineTurns';

function setElementTop(el: HTMLElement, top: number): void {
  Object.defineProperty(el, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: vi.fn(() => ({
      x: 0,
      y: top,
      top,
      left: 0,
      right: 0,
      bottom: top,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    })),
    configurable: true,
  });
}

function createUserTurn(text: string, top: number): HTMLElement {
  const turn = document.createElement('div');
  turn.className = 'user';
  turn.textContent = text;
  setElementTop(turn, top);
  return turn;
}

describe('TimelineTurns turn ids', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('gives every repeated prompt its own marker, though each sits at the same offset in its wrapper', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    // Gemini wraps each turn in its own positioned box, so `offsetTop` is the same for all.
    const repeats = [0, 300, 600].map((top) => {
      const turn = createUserTurn('continue', top);
      Object.defineProperty(turn, 'offsetTop', { value: 24, configurable: true });
      return turn;
    });
    container.append(...repeats);

    const fresh = new TimelineTurns();
    const markers = fresh.commit(fresh.plan(container, '.user'));
    expect(markers.map((marker) => marker.element)).toEqual(repeats);
    expect(markers.map((marker) => marker.baseN)).toEqual([0, 0.5, 1]);
  });

  it('keeps existing turn ids unique when older turns are prepended', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const turns = new TimelineTurns();
    let markers: TimelineMarker[] = [];

    const first = createUserTurn('first loaded turn', 0);
    const second = createUserTurn('second loaded turn', 100);
    container.append(first, second);

    markers = turns.commit(turns.plan(container, '.user', markers));

    const firstId = markers[0]!.id;
    const secondId = markers[1]!.id;

    const older = createUserTurn('older prepended turn', 0);
    setElementTop(first, 100);
    setElementTop(second, 200);
    container.prepend(older);

    markers = turns.commit(turns.plan(container, '.user', markers));

    const ids = markers.map((marker) => marker.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(markers.find((marker) => marker.element === first)?.id).toBe(firstId);
    expect(markers.find((marker) => marker.element === second)?.id).toBe(secondId);
    expect(markers.find((marker) => marker.element === older)?.id).not.toBe(firstId);
  });

  it('repairs duplicated DOM turn ids by preserving the previous marker owner', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const turns = new TimelineTurns();
    let markers: TimelineMarker[] = [];

    const first = createUserTurn('first loaded turn', 0);
    const second = createUserTurn('second loaded turn', 100);
    container.append(first, second);

    markers = turns.commit(turns.plan(container, '.user', markers));

    const firstId = markers[0]!.id;

    const older = createUserTurn('older prepended turn', 0);
    older.dataset.turnId = firstId;
    setElementTop(first, 100);
    setElementTop(second, 200);
    container.prepend(older);

    markers = turns.commit(turns.plan(container, '.user', markers));

    const ids = markers.map((marker) => marker.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(markers.find((marker) => marker.element === first)?.id).toBe(firstId);
    expect(markers.find((marker) => marker.element === older)?.id).not.toBe(firstId);
  });
});
