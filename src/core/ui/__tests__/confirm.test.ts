import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { confirmDriver } from '@/tests/confirmDriver';

import { CONFIRM_ANCHOR_ATTR, askConfirm } from '../confirm';
import { isVoyagerLayerEvent } from '../layer';

const host = () => document.querySelector<HTMLElement>('[data-gv-layer="popover"]');

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

let anchor: HTMLButtonElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="scroller"><button id="anchor">Delete</button></div>';
  anchor = document.querySelector<HTMLButtonElement>('#anchor')!;
});

afterEach(() => {
  confirmDriver.pressEscape();
  document.body.className = '';
  vi.restoreAllMocks();
});

const ask = (overrides: Partial<Parameters<typeof askConfirm>[0]> = {}) =>
  askConfirm({
    message: 'Delete this?',
    anchor,
    tone: 'danger',
    choices: [{ id: 'confirm', label: 'Delete' }],
    cancelLabel: 'Cancel',
    ...overrides,
  });

describe('askConfirm', () => {
  it('shows the message above Cancel and the choices, and resolves the chosen id', async () => {
    const answer = askConfirm<'paste' | 'upload'>({
      message: 'Fork here?',
      anchor,
      tone: 'neutral',
      choices: [
        { id: 'upload', label: 'Markdown', emphasis: 'secondary' },
        { id: 'paste', label: 'Fork' },
      ],
      cancelLabel: 'Cancel',
    });

    expect(confirmDriver.message()).toBe('Fork here?');
    expect(confirmDriver.labels()).toEqual(['Cancel', 'Markdown', 'Fork']);
    confirmDriver.answer('Markdown');

    await expect(answer).resolves.toBe('upload');
    expect(host()).toBeNull();
  });

  it('resolves null on Cancel', async () => {
    const answer = ask();
    confirmDriver.answer('Cancel');
    await expect(answer).resolves.toBeNull();
  });

  it('focuses Cancel for a danger confirm and the primary choice otherwise', async () => {
    const danger = ask();
    expect(confirmDriver.focusedLabel()).toBe('Cancel');
    confirmDriver.answer('Cancel');
    await danger;

    const neutral = ask({ tone: 'neutral' });
    expect(confirmDriver.focusedLabel()).toBe('Delete');
    confirmDriver.answer('Cancel');
    await neutral;
  });

  it('lists details under the message and gives them to screen readers as its description', async () => {
    const answer = ask({
      details: ['Folders: cloud 24 → 0', 'Prompts: cloud copy not recognized'],
    });
    expect(confirmDriver.details()).toEqual([
      'Folders: cloud 24 → 0',
      'Prompts: cloud copy not recognized',
    ]);
    expect(confirmDriver.description()).toContain('Folders: cloud 24 → 0');
    confirmDriver.answer('Cancel');
    await answer;

    const plain = ask();
    expect(confirmDriver.details()).toEqual([]);
    expect(confirmDriver.description()).toBeNull();
    confirmDriver.answer('Cancel');
    await plain;
  });

  it('keeps a safe primary out of red when a danger choice marks the destructive answer', async () => {
    const answer = askConfirm<'merge' | 'force'>({
      message: 'Upload replaces the cloud copy.',
      anchor,
      tone: 'danger',
      choices: [
        { id: 'merge', label: 'Merge instead' },
        { id: 'force', label: 'Upload anyway', emphasis: 'danger' },
      ],
      cancelLabel: 'Cancel',
    });
    // Enter right after opening must not run the destructive answer.
    expect(confirmDriver.focusedLabel()).toBe('Cancel');
    expect(confirmDriver.emphasis('Merge instead')).toBe('primary');
    expect(confirmDriver.emphasis('Upload anyway')).toBe('danger');
    confirmDriver.answer('Upload anyway');
    await expect(answer).resolves.toBe('force');
  });

  it('follows an explicit direction over the page’s', async () => {
    const rtl = ask({ dir: 'rtl' });
    expect(confirmDriver.direction()).toBe('rtl');
    confirmDriver.answer('Cancel');
    await rtl;

    document.body.classList.add('gv-rtl');
    const ltr = ask({ dir: 'ltr' });
    expect(confirmDriver.direction()).toBe('ltr');
    confirmDriver.answer('Cancel');
    await ltr;

    const page = ask();
    expect(confirmDriver.direction()).toBe('rtl');
    confirmDriver.answer('Cancel');
    await page;
  });

  it('returns focus to the anchor when it closes', async () => {
    const answer = ask();
    confirmDriver.answer('Cancel');
    await answer;
    expect(document.activeElement).toBe(anchor);
  });

  it('takes Escape before the page sees it', async () => {
    const pageEscape = vi.fn();
    window.addEventListener('keydown', pageEscape);
    const answer = ask();

    confirmDriver.pressEscape();

    await expect(answer).resolves.toBeNull();
    expect(pageEscape).not.toHaveBeenCalled();
    window.removeEventListener('keydown', pageEscape);
  });

  it('closes on an outside press but not on a press inside it', async () => {
    const answer = ask();
    confirmDriver.pressOutside(host()!.shadowRoot!.querySelector('p')!);
    expect(confirmDriver.isOpen()).toBe(true);

    confirmDriver.pressOutside();
    await expect(answer).resolves.toBeNull();
  });

  it('an unrelated container scroll keeps the confirm open', () => {
    const elsewhere = document.createElement('div');
    document.body.append(elsewhere);
    void ask();

    elsewhere.dispatchEvent(new Event('scroll'));

    expect(confirmDriver.isOpen()).toBe(true);
  });

  it('closes when its anchor leaves the page', async () => {
    const answer = ask();

    document.querySelector('#scroller')!.remove();

    await expect(answer).resolves.toBeNull();
    expect(host()).toBeNull();
  });

  it('answers null for the older confirm when a newer one opens', async () => {
    const first = ask();
    const second = ask({ message: 'Second?' });

    await expect(first).resolves.toBeNull();
    expect(document.querySelectorAll('[data-gv-layer="popover"]')).toHaveLength(1);
    expect(confirmDriver.message()).toBe('Second?');
    confirmDriver.answer('Delete');
    await expect(second).resolves.toBe('confirm');
  });

  it('answers null and removes the card when its owner aborts', async () => {
    const owner = new AbortController();
    const answer = ask({ signal: owner.signal });

    owner.abort();

    await expect(answer).resolves.toBeNull();
    expect(host()).toBeNull();
    await expect(ask({ signal: owner.signal })).resolves.toBeNull();
    expect(host()).toBeNull();
  });

  it('keeps Tab inside the confirm', async () => {
    const answer = ask();
    const root = host()!.shadowRoot!;
    const press = (shiftKey = false) =>
      root.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, composed: true }),
      );

    press();
    expect(confirmDriver.focusedLabel()).toBe('Delete');
    press();
    expect(confirmDriver.focusedLabel()).toBe('Cancel');
    press(true);
    expect(confirmDriver.focusedLabel()).toBe('Delete');
    confirmDriver.answer('Cancel');
    await answer;
  });

  it('marks presses inside it as Voyager layer events', async () => {
    const seen: boolean[] = [];
    const record = (event: Event) => seen.push(isVoyagerLayerEvent(event));
    document.addEventListener('pointerdown', record, true);
    const answer = ask();

    confirmDriver.pressOutside(host()!.shadowRoot!.querySelector('p')!);
    confirmDriver.pressOutside(anchor);

    expect(seen).toEqual([true, false]);
    document.removeEventListener('pointerdown', record, true);
    await answer;
  });

  describe('anchor mark', () => {
    const marked = (element: HTMLElement = anchor) => element.hasAttribute(CONFIRM_ANCHOR_ATTR);

    it('marks the anchor while open and clears it on an answer or Cancel', async () => {
      const answered = ask();
      expect(marked()).toBe(true);
      confirmDriver.answer('Delete');
      await answered;
      expect(marked()).toBe(false);

      const cancelled = ask();
      expect(marked()).toBe(true);
      confirmDriver.answer('Cancel');
      await cancelled;
      expect(marked()).toBe(false);
    });

    it('clears the mark on Escape and on an outside press', async () => {
      const escaped = ask();
      confirmDriver.pressEscape();
      await escaped;
      expect(marked()).toBe(false);

      const pressed = ask();
      confirmDriver.pressOutside();
      await pressed;
      expect(marked()).toBe(false);
    });

    it('clears the mark when the owner aborts or the anchor leaves the page', async () => {
      const owner = new AbortController();
      const aborted = ask({ signal: owner.signal });
      owner.abort();
      await aborted;
      expect(marked()).toBe(false);

      const detached = ask();
      document.querySelector('#scroller')!.remove();
      await detached;
      expect(marked()).toBe(false);
    });

    it('moves the mark to the newer confirm, and keeps it when both share an anchor', async () => {
      const other = document.createElement('button');
      document.body.append(other);
      const first = ask();
      const second = ask({ anchor: other });
      await first;
      expect(marked()).toBe(false);
      expect(marked(other)).toBe(true);

      const third = ask({ anchor: other });
      await second;
      expect(marked(other)).toBe(true);
      confirmDriver.answer('Cancel');
      await third;
      expect(marked(other)).toBe(false);
    });
  });

  describe('placement', () => {
    const box = rect(0, 0, 200, 80);

    beforeEach(() => {
      Object.defineProperty(document.documentElement, 'clientWidth', {
        value: 1000,
        configurable: true,
      });
      Object.defineProperty(document.documentElement, 'clientHeight', {
        value: 700,
        configurable: true,
      });
    });

    const placeWith = (anchorRect: DOMRect) => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
        function (this: HTMLElement) {
          return this === anchor ? anchorRect : box;
        },
      );
    };

    const position = () => ({ left: host()!.style.left, top: host()!.style.top });

    it('opens below the anchor, aligned to its start', async () => {
      placeWith(rect(100, 100, 40, 20));
      const answer = ask();
      expect(position()).toEqual({ left: '100px', top: '128px' });
      confirmDriver.answer('Cancel');
      await answer;
    });

    it('opens above when there is no room below', async () => {
      placeWith(rect(100, 650, 40, 20));
      const answer = ask();
      expect(position()).toEqual({ left: '100px', top: '562px' });
      confirmDriver.answer('Cancel');
      await answer;
    });

    it('opens beside on the inline-end side, and on the inline-start side under RTL', async () => {
      placeWith(rect(100, 100, 40, 20));
      const ltr = ask({ side: 'beside' });
      expect(position()).toEqual({ left: '148px', top: '70px' });
      confirmDriver.answer('Cancel');
      await ltr;

      document.body.classList.add('gv-rtl');
      placeWith(rect(500, 100, 40, 20));
      const rtl = ask({ side: 'beside' });
      expect(position()).toEqual({ left: '292px', top: '70px' });
      confirmDriver.answer('Cancel');
      await rtl;
    });

    it('stays open and follows its anchor while a streaming scroll keeps the anchor in view', async () => {
      placeWith(rect(100, 300, 40, 20));
      const answer = ask();

      placeWith(rect(100, 200, 40, 20));
      document.querySelector('#scroller')!.dispatchEvent(new Event('scroll'));

      expect(confirmDriver.isOpen()).toBe(true);
      expect(position()).toEqual({ left: '100px', top: '228px' });
      confirmDriver.answer('Cancel');
      await answer;
    });

    it('closes once a scroll takes its anchor out of view', async () => {
      placeWith(rect(100, 100, 40, 20));
      const answer = ask();

      placeWith(rect(100, -40, 40, 20));
      document.dispatchEvent(new Event('scroll'));

      await expect(answer).resolves.toBeNull();
    });

    it('sits centred without an anchor and stays open through a page scroll', async () => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(box);
      const answer = ask({ anchor: undefined, tone: 'neutral' });
      expect(position()).toEqual({ left: '400px', top: '310px' });

      document.dispatchEvent(new Event('scroll'));
      document.querySelector('#scroller')!.remove();

      expect(confirmDriver.isOpen()).toBe(true);
      confirmDriver.answer('Delete');
      await expect(answer).resolves.toBe('confirm');
    });

    it('lines up with the anchor end when asked: the right edge in LTR, the left in RTL', async () => {
      placeWith(rect(100, 100, 300, 20));
      const ltr = ask({ align: 'end' });
      expect(position()).toEqual({ left: '200px', top: '128px' });
      confirmDriver.answer('Cancel');
      await ltr;

      document.body.classList.add('gv-rtl');
      placeWith(rect(500, 100, 300, 20));
      const rtl = ask({ align: 'end' });
      expect(position()).toEqual({ left: '500px', top: '128px' });
      confirmDriver.answer('Cancel');
      await rtl;
    });

    it('keeps an end-aligned card inside the viewport and flips it above at the bottom', async () => {
      placeWith(rect(0, 100, 120, 20));
      const narrowLtr = ask({ align: 'end' });
      expect(position()).toEqual({ left: '8px', top: '128px' });
      confirmDriver.answer('Cancel');
      await narrowLtr;

      placeWith(rect(500, 650, 300, 20));
      const bottom = ask({ align: 'end' });
      expect(position()).toEqual({ left: '600px', top: '562px' });
      confirmDriver.answer('Cancel');
      await bottom;

      document.body.classList.add('gv-rtl');
      placeWith(rect(900, 100, 100, 20));
      const edgeRtl = ask({ align: 'end' });
      expect(position()).toEqual({ left: '792px', top: '128px' });
      confirmDriver.answer('Cancel');
      await edgeRtl;
    });

    it('stays inside the viewport at the right edge', async () => {
      placeWith(rect(960, 100, 30, 20));
      const answer = ask();
      expect(position()).toEqual({ left: '792px', top: '128px' });
      confirmDriver.answer('Cancel');
      await answer;
    });
  });
});
