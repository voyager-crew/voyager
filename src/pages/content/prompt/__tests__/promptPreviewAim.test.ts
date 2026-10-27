import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPromptPreview } from '../promptPreview';
import { SAFE_TRIANGLE_STALL_MS } from '../safeTriangle';
import {
  type PointerOptions,
  type Rect,
  createPointer,
  stubLayout,
  trackDocumentListeners,
} from './hoverPointer';

// The raw text the card shows first is what these tests read.
vi.mock('../promptMarkdownLoader', () => ({ renderPromptMarkdown: () => new Promise(() => {}) }));

const OPEN_DELAY_MS = 250;
const HIDE_GRACE_MS = 150;
const TEXTS = ['Row 0', 'Row 1', 'Row 2', 'Row 3', 'Row 4', 'Row 5'];

/*
 * The panel sits at x 100-400, six 50px rows from y 100. The card is
 * 300 x 240 and opens beside the panel at x 410-710, level with its row.
 */
function setup(options?: PointerOptions) {
  const panel = document.createElement('div');
  const list = panel.appendChild(document.createElement('div'));
  document.body.appendChild(panel);
  const rows = TEXTS.map(() => list.appendChild(document.createElement('div')));
  const rects = new Map<HTMLElement, Rect>([
    [panel, { left: 100, top: 80, right: 400, bottom: 420 }],
  ]);
  rows.forEach((row, i) => {
    rects.set(row, { left: 100, top: 100 + i * 50, right: 400, bottom: 150 + i * 50 });
  });
  const restoreLayout = stubLayout((element) => {
    if (!element.classList.contains('gv-pm-tooltip')) return rects.get(element) ?? null;
    const left = Number.parseFloat(element.style.left) || 0;
    const top = Number.parseFloat(element.style.top) || 0;
    return { left, top, right: left + 300, bottom: top + 240 };
  });

  const preview = createPromptPreview({ panel, scrollRoot: list });
  rows.forEach((row, i) => preview.attach(row, TEXTS[i]));

  const card = () => document.querySelector<HTMLElement>('.gv-pm-tooltip');
  const visible = () => card()?.classList.contains('gv-pm-tooltip-visible') === true;
  const pointer = createPointer(() => [...(visible() ? [card()!] : []), ...rows], options);
  const teardown = () => {
    preview.destroy();
    restoreLayout();
  };
  return {
    rows,
    preview,
    pointer,
    teardown,
    /** The prompt the card shows, or null while it is hidden. */
    shown: () => (visible() ? card()!.textContent : null),
  };
}

describe('Prompt Manager preview hover intent', () => {
  let teardown: (() => void) | null = null;
  const start = (options?: PointerOptions) => {
    const harness = setup(options);
    teardown = harness.teardown;
    // Rest on the first row until its card opens.
    harness.pointer.moveTo(300, 125);
    vi.advanceTimersByTime(OPEN_DELAY_MS);
    return harness;
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    teardown?.();
    teardown = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a diagonal move to the Prompt Manager card does not close it', () => {
    const { pointer, shown } = start();
    expect(shown()).toBe('Row 0');

    // Down and to the right, across rows 1-3 and the gap, onto the card.
    for (let step = 1; step <= 12; step += 1) {
      pointer.glideTo(300 + 10 * step, 125 + 14.6 * step, 1);
      expect(shown()).toBe('Row 0');
    }
    vi.advanceTimersByTime(1000);
    expect(shown()).toBe('Row 0');

    // Leaving the card still closes it.
    pointer.moveTo(800, 600);
    vi.advanceTimersByTime(HIDE_GRACE_MS);
    expect(shown()).toBeNull();
  });

  it('a straight move down the Prompt Manager list closes the card and opens the row it rests on', () => {
    const { pointer, shown } = start();
    pointer.moveTo(300, 175);
    pointer.moveTo(300, 225);
    expect(shown()).toBeNull();

    vi.advanceTimersByTime(OPEN_DELAY_MS);
    expect(shown()).toBe('Row 2');
  });

  it('the Prompt Manager card follows the row the pointer settles on once it stops heading for the card', () => {
    const { pointer, shown } = start();
    pointer.glideTo(360, 225, 5);

    vi.advanceTimersByTime(SAFE_TRIANGLE_STALL_MS - 1);
    expect(shown()).toBe('Row 0');
    vi.advanceTimersByTime(1 + OPEN_DELAY_MS - 1);
    expect(shown()).toBe('Row 0');
    vi.advanceTimersByTime(1);
    expect(shown()).toBe('Row 2');
  });

  it('leaving the triangle hands the Prompt Manager card to the row under the pointer', () => {
    const { pointer, shown } = start();
    pointer.glideTo(340, 170, 3);
    expect(shown()).toBe('Row 0');

    // Closer to the card than before, but far below the way to it.
    pointer.moveTo(390, 390);
    vi.advanceTimersByTime(OPEN_DELAY_MS);
    expect(shown()).toBe('Row 5');
  });

  it('only the row whose Prompt Manager card is open aims at it', () => {
    const { pointer, shown } = start();
    // Onto row 1, whose own card has not opened, then off toward row 0's card.
    pointer.moveTo(300, 190);
    pointer.glideTo(410, 230, 5);

    expect(shown()).toBeNull();
  });

  it('a dismissed Prompt Manager card is not aimed at', () => {
    const { pointer, shown, rows } = start();
    rows[0].dispatchEvent(new MouseEvent('mousedown'));
    expect(shown()).toBeNull();

    pointer.glideTo(360, 225, 5);
    vi.advanceTimersByTime(OPEN_DELAY_MS);
    expect(shown()).toBe('Row 2');
  });

  it('the Prompt Manager card holds whichever order leave events arrive in', () => {
    const { pointer, shown } = start({ order: 'mouse-first' });
    // Slower than the hide grace, so a leave delivered first would have closed it.
    pointer.glideTo(420, 300, 24);
    vi.advanceTimersByTime(1000);

    expect(shown()).toBe('Row 0');
  });

  it('touch input on the Prompt Manager list is unchanged', () => {
    const { pointer, shown } = start({ pointerType: 'touch' });
    pointer.glideTo(420, 300, 12);

    expect(shown()).toBeNull();
  });

  it('destroy removes everything the hover intent added', () => {
    const documentListeners = trackDocumentListeners();
    const { pointer, preview } = start();
    pointer.glideTo(360, 225, 5);

    preview.destroy();
    expect(vi.getTimerCount()).toBe(0);
    expect(documentListeners()).toEqual([]);
    document.body.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 600, clientY: 700, bubbles: true }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
