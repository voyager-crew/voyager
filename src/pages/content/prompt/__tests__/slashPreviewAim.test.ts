import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readContentStyle } from '@/tests/contentStyle';

import { SAFE_TRIANGLE_STALL_MS } from '../safeTriangle';
import { SLASH_PREVIEW_ID, createSlashPreview } from '../slashPreview';
import {
  type PointerOptions,
  type Rect,
  createPointer,
  stubLayout,
  trackDocumentListeners,
} from './hoverPointer';

const HIDE_GRACE_MS = 150;
const TEXTS = ['First body', 'Second body', 'Third body', 'Fourth body', 'Fifth body'];

/*
 * The result list sits at x 100-400, y 400-600, five 40px rows. The card is
 * 400 x 200 and the preview puts it above the list: x 100-500, y 194-394.
 */
function setup(options?: PointerOptions) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const rows = TEXTS.map(() => root.appendChild(document.createElement('button')));
  const rects = new Map<HTMLElement, Rect>([
    [root, { left: 100, top: 400, right: 400, bottom: 600 }],
  ]);
  rows.forEach((row, i) => {
    rects.set(row, { left: 100, top: 400 + i * 40, right: 400, bottom: 440 + i * 40 });
  });
  const restoreLayout = stubLayout((element) => {
    if (element.id !== SLASH_PREVIEW_ID) return rects.get(element) ?? null;
    const left = Number.parseFloat(element.style.left) || 0;
    const top = Number.parseFloat(element.style.top) || 0;
    return { left, top, right: left + 400, bottom: top + 200 };
  });

  const preview = createSlashPreview({
    resultList: root,
    scheme: () => 'light',
    onValuesEdited: () => {},
  });
  const entered: number[] = [];
  rows.forEach((row, i) =>
    preview.bindRow(row, () => {
      entered.push(i);
      preview.show(row, TEXTS[i]);
    }),
  );

  const card = () => document.getElementById(SLASH_PREVIEW_ID);
  const visible = () => card()?.classList.contains('gv-pm-slash-tooltip-visible') === true;
  const pointer = createPointer(() => [...(visible() ? [card()!] : []), ...rows], options);
  const teardown = () => {
    preview.destroy();
    restoreLayout();
  };
  return {
    root,
    rows,
    preview,
    entered,
    pointer,
    teardown,
    /** The body the card shows, or null while it is hidden. */
    shown: () => (visible() ? card()!.textContent : null),
  };
}

describe('slash preview hover intent', () => {
  let teardown: (() => void) | null = null;
  const start = (options?: PointerOptions) => {
    const harness = setup(options);
    teardown = harness.teardown;
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

  it("a diagonal move to the slash preview keeps the starting row's card", () => {
    const { pointer, shown, entered } = start();
    pointer.moveTo(150, 580);
    expect(shown()).toBe('Fifth body');

    // Up and to the right, across the four rows above, onto the card.
    for (let step = 1; step <= 12; step += 1) {
      pointer.glideTo(150 + 12.5 * step, 580 - 16.7 * step, 1);
      expect(shown()).toBe('Fifth body');
    }
    // On the card, reading it.
    pointer.glideTo(300, 300, 4);
    vi.advanceTimersByTime(1000);

    expect(shown()).toBe('Fifth body');
    expect(entered).toEqual([4]);
  });

  it('a straight move down the slash list swaps the card at once', () => {
    const { pointer, shown } = start();
    pointer.moveTo(150, 420);
    expect(shown()).toBe('First body');

    pointer.moveTo(150, 450);
    expect(shown()).toBe('Second body');
    pointer.moveTo(150, 490);
    expect(shown()).toBe('Third body');
  });

  it('the slash card follows the row the pointer settles on once it stops heading for the card', () => {
    const { pointer, shown, entered } = start();
    pointer.moveTo(150, 580);
    pointer.glideTo(180, 500, 5);

    vi.advanceTimersByTime(SAFE_TRIANGLE_STALL_MS - 1);
    expect(shown()).toBe('Fifth body');
    vi.advanceTimersByTime(1);
    expect(shown()).toBe('Third body');
    // The row crossed on the way never took the card.
    expect(entered).toEqual([4, 2]);
  });

  it('creeping toward the slash card by a fraction of a pixel counts as settling', () => {
    const { pointer, shown } = start();
    pointer.moveTo(150, 580);
    pointer.glideTo(170, 540, 2);

    for (let step = 1; step <= 5; step += 1) {
      vi.advanceTimersByTime(100);
      pointer.moveTo(170, 540 - 0.1 * step);
    }
    expect(shown()).toBe('Fourth body');
  });

  it('turning back toward the list hands the slash card to the row under the pointer', () => {
    const { pointer, shown } = start();
    pointer.moveTo(150, 580);
    pointer.glideTo(180, 490, 5);
    expect(shown()).toBe('Fifth body');

    // Still inside the triangle, but heading away from the card.
    pointer.moveTo(180, 515);
    expect(shown()).toBe('Third body');
  });

  it('leaving the triangle hands the slash card to the row under the pointer', () => {
    const { pointer, shown } = start();
    pointer.moveTo(150, 580);
    pointer.glideTo(170, 540, 2);
    expect(shown()).toBe('Fifth body');

    // Closer to the card than before, but well right of the way to it.
    pointer.moveTo(395, 530);
    expect(shown()).toBe('Fourth body');
  });

  it('settling between the rows and the card closes the slash card as before', () => {
    const { pointer, shown } = start();
    pointer.moveTo(150, 580);
    pointer.glideTo(200, 397, 10);
    expect(shown()).toBe('Fifth body');

    vi.advanceTimersByTime(SAFE_TRIANGLE_STALL_MS + HIDE_GRACE_MS);
    expect(shown()).toBeNull();
  });

  it('a row redrawn while heading for the card does not bring its card back', () => {
    const { pointer, shown, rows } = start();
    pointer.moveTo(150, 580);
    pointer.glideTo(180, 500, 5);
    rows[2].remove();

    vi.advanceTimersByTime(SAFE_TRIANGLE_STALL_MS + HIDE_GRACE_MS);
    expect(shown()).toBeNull();
  });

  it('a row flicked through without a move inside it does not aim from another row', () => {
    const { pointer, preview, shown, rows } = start();
    pointer.moveTo(150, 590);
    preview.hide();
    const at = (x: number, y: number) => ({ clientX: x, clientY: y, pointerType: 'mouse' });
    // The browser reports row 1 entered and left with no move inside it.
    rows[1].dispatchEvent(new MouseEvent('mouseenter', at(150, 470)));
    expect(shown()).toBe('Second body');

    rows[1].dispatchEvent(new PointerEvent('pointerleave', at(150, 481)));
    rows[1].dispatchEvent(new MouseEvent('mouseleave', at(150, 481)));
    rows[2].dispatchEvent(new MouseEvent('mouseenter', at(150, 481)));
    expect(shown()).toBe('Third body');
  });

  it('a row re-entered on the way to the slash card does not take it back later', () => {
    const { pointer, shown, root } = start();
    pointer.moveTo(150, 460);
    pointer.moveTo(150, 439); // up into row 0, heading for the card
    pointer.moveTo(150, 441); // a wobble back into row 1
    pointer.moveTo(95, 445); // off the list to the left: no longer heading there
    expect(root.classList.contains('gv-pm-slash-aiming')).toBe(false);
    pointer.moveTo(110, 420); // into row 0 within the hide grace
    expect(shown()).toBe('First body');

    // From row 0 into the gap below the card, crossing no row, then settling.
    pointer.moveTo(150, 405);
    pointer.glideTo(200, 397, 4);
    vi.advanceTimersByTime(SAFE_TRIANGLE_STALL_MS);
    expect(shown()).toBe('First body');
    vi.advanceTimersByTime(HIDE_GRACE_MS);
    expect(shown()).toBeNull();
  });

  it('a slow scan up the slash list moves the card row by row', () => {
    const { pointer, shown, entered } = start();
    pointer.moveTo(150, 580);
    // 2 px every 40 ms is reading the names, not heading for the card.
    for (let y = 578; y >= 490; y -= 2) {
      vi.advanceTimersByTime(40);
      pointer.moveTo(150, y);
      if (y === 550) expect(shown()).toBe('Fourth body');
    }
    expect(shown()).toBe('Third body');
    expect(entered).toEqual([4, 3, 2]);
  });

  it('rows crossed on the way to the slash card do not light up', () => {
    const { pointer, root } = start();
    pointer.moveTo(150, 580);
    pointer.glideTo(175, 546.7, 2);
    expect(root.classList.contains('gv-pm-slash-aiming')).toBe(true);
    // The pointer hover highlight is the only thing the class switches off.
    expect(readContentStyle()).toContain(
      ".gv-pm-slash-root:not(.gv-pm-slash-aiming)[data-gv-interaction='pointer'] .gv-pm-slash-option:hover",
    );

    vi.advanceTimersByTime(SAFE_TRIANGLE_STALL_MS);
    expect(root.classList.contains('gv-pm-slash-aiming')).toBe(false);
  });

  it('a dismissed slash card is not aimed at', () => {
    const { pointer, preview, shown } = start();
    pointer.moveTo(150, 580);
    preview.hide();

    pointer.glideTo(175, 546.7, 2);
    expect(shown()).toBe('Fourth body');
  });

  it('the slash card holds whichever order leave events arrive in', () => {
    const { pointer, shown } = start({ order: 'mouse-first' });
    pointer.moveTo(150, 580);
    pointer.glideTo(300, 380, 12);
    pointer.glideTo(300, 300, 4);
    vi.advanceTimersByTime(1000);

    expect(shown()).toBe('Fifth body');
  });

  it('touch input on the slash list is unchanged', () => {
    const { pointer, shown } = start({ pointerType: 'touch' });
    pointer.moveTo(150, 580);
    pointer.glideTo(175, 546.7, 2);

    expect(shown()).toBe('Fourth body');
  });

  it('destroy removes everything the hover intent added', () => {
    const documentListeners = trackDocumentListeners();
    const { pointer, preview, entered } = start();
    pointer.moveTo(150, 580);
    pointer.glideTo(180, 500, 5);

    preview.destroy();
    expect(vi.getTimerCount()).toBe(0);
    expect(documentListeners()).toEqual([]);
    document.body.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 600, clientY: 700, bubbles: true }),
    );
    vi.advanceTimersByTime(1000);
    expect(vi.getTimerCount()).toBe(0);
    expect(entered).toEqual([4]);
  });
});
