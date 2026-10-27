import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PromptItem } from '@/core/types/sync';

import { SAFE_TRIANGLE_STALL_MS } from '../safeTriangle';
import { SLASH_PREVIEW_ID } from '../slashPreview';
import { startPromptSlashCommand } from '../slashPrompt';
import { createPointer, stubLayout } from './hoverPointer';
import { createContentEditable, press, typeInto } from './slashPromptTestHarness';

const HIDE_GRACE_MS = 150;
const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
const items: PromptItem[] = NAMES.map((name, i) => ({
  id: name.toLowerCase(),
  name,
  text: `${name} body`,
  tags: [],
  createdAt: i + 1,
}));

/*
 * The result list sits at x 100-400, y 400-600, one 40px row per prompt; the
 * 400 x 200 card goes above it, at x 100-500, y 194-394.
 */
function open() {
  const input = createContentEditable('/');
  const rows = () => Array.from(document.querySelectorAll<HTMLElement>('.gv-pm-slash-option'));
  const restoreLayout = stubLayout((element) => {
    if (element.id === 'gv-pm-slash-root') return { left: 100, top: 400, right: 400, bottom: 600 };
    if (element.id === SLASH_PREVIEW_ID) {
      const left = Number.parseFloat(element.style.left) || 0;
      const top = Number.parseFloat(element.style.top) || 0;
      return { left, top, right: left + 400, bottom: top + 200 };
    }
    const index = rows().indexOf(element);
    return index < 0
      ? null
      : { left: 100, top: 400 + index * 40, right: 400, bottom: 440 + index * 40 };
  });
  const { destroy } = startPromptSlashCommand({ scheme: () => 'light', initialItems: items });
  typeInto(input);

  const root = document.getElementById('gv-pm-slash-root')!;
  const card = () => document.getElementById(SLASH_PREVIEW_ID);
  const visible = () => card()?.classList.contains('gv-pm-slash-tooltip-visible') === true;
  const pointer = createPointer(() => [...(visible() ? [card()!] : []), ...rows()]);
  return {
    input,
    root,
    pointer,
    teardown: () => {
      destroy();
      restoreLayout();
    },
    selected: () => NAMES[rows().findIndex((row) => row.getAttribute('aria-selected') === 'true')],
    shown: () => (visible() ? card()!.textContent : null),
  };
}

describe('slash completion while the pointer heads for the card', () => {
  let teardown: (() => void) | null = null;
  const start = () => {
    const harness = open();
    teardown = harness.teardown;
    return harness;
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });
  afterEach(() => {
    teardown?.();
    teardown = null;
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('an arrow key pressed before the pointer settles keeps the row the keyboard chose', () => {
    const { input, root, pointer, selected, shown } = start();
    pointer.moveTo(150, 580);
    expect(selected()).toBe('Echo');
    // Up toward the card, stopping on Charlie.
    pointer.glideTo(180, 500, 5);

    press(input, 'ArrowUp');
    expect(selected()).toBe('Delta');
    vi.advanceTimersByTime(SAFE_TRIANGLE_STALL_MS + HIDE_GRACE_MS);

    expect(selected()).toBe('Delta');
    expect(root.dataset.gvInteraction).toBe('keyboard');
    expect(shown()).not.toBe('Charlie body');
  });

  it('a row re-entered on the way to the slash card is not what Enter places later', () => {
    const { input, pointer, selected, shown } = start();
    pointer.moveTo(150, 460); // Bravo
    pointer.moveTo(150, 439); // up into Alpha, heading for the card
    pointer.moveTo(150, 441); // a wobble back into Bravo
    pointer.moveTo(95, 445); // off the list to the left
    pointer.moveTo(110, 420); // Alpha
    pointer.moveTo(150, 405);
    pointer.glideTo(200, 397, 4); // into the gap below the card, crossing no row
    vi.advanceTimersByTime(SAFE_TRIANGLE_STALL_MS + HIDE_GRACE_MS);

    expect(shown()).toBeNull();
    expect(selected()).toBe('Alpha');
    press(input, 'Enter');
    expect(input.querySelector<HTMLElement>('.gv-pm-slash-token')?.dataset.gvPromptName).toBe(
      'Alpha',
    );
  });
});
