// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/" }
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readContentStyle } from '@/tests/contentStyle';
import { resetPageUrl, setPageUrl } from '@/tests/pageUrl';

import {
  type Box,
  PROMPT_TRIGGER_DEFAULT_INSET,
  PROMPT_TRIGGER_ELEMENT_ID,
  PROMPT_TRIGGER_SIZE,
} from '../../prompt/triggerClearance';
import { mountFloatingFab, unmountFloatingFab } from '../floatingModeFab';
import { destroyMountedPanels, mountPanel, setWindowSize } from './floatingPanelHarness';

vi.mock('@/utils/i18n', () => ({
  getTranslationSyncUnsafe: (key: string) => key,
}));

vi.mock('@/core/utils/browser', () => ({
  isSafari: () => false,
}));

const originalWidth = window.innerWidth;
const originalHeight = window.innerHeight;

/** The ball where `.gv-pm-trigger` puts it: 46px, 18px in from the bottom-right corner. */
function cornerBall(): Box {
  return {
    x: window.innerWidth - 18 - 46,
    y: window.innerHeight - 18 - 46,
    w: 46,
    h: 46,
  };
}

function rtlBall(): Box {
  return { x: 18, y: window.innerHeight - 18 - 46, w: 46, h: 46 };
}

/** A ball on screen, as Prompt Manager mounts it, at `box`. */
function placeBall(box: Box): void {
  const ball = document.createElement('button');
  ball.id = PROMPT_TRIGGER_ELEMENT_ID;
  ball.getBoundingClientRect = () => new DOMRect(box.x, box.y, box.w, box.h);
  document.body.appendChild(ball);
}

function placeComposer(
  box: Box,
  markup = '<form><textarea id="prompt-textarea"></textarea></form>',
  hostname = 'chatgpt.com',
): HTMLElement {
  setPageUrl(`https://${hostname}/`);
  const holder = document.createElement('main');
  holder.innerHTML = markup;
  const composer = holder.firstElementChild as HTMLElement;
  const input = composer.querySelector<HTMLElement>('textarea, [contenteditable]')!;
  composer.getBoundingClientRect = input.getBoundingClientRect = () =>
    new DOMRect(box.x, box.y, box.w, box.h);
  document.body.append(holder);
  return composer;
}

/** Lets the ball's mutation records arrive, then the frame they schedule run. */
function nextFrame(): Promise<void> {
  return new Promise((done) => setTimeout(() => requestAnimationFrame(() => done()), 0));
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function insideViewport(box: Box): boolean {
  return (
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.w <= window.innerWidth &&
    box.y + box.h <= window.innerHeight
  );
}

function mountFab(storedPos: { x: number; y: number } | null = null): HTMLElement {
  const fab = mountFloatingFab({ onClick: vi.fn(), storedPos });
  expect(fab).not.toBeNull();
  return fab!;
}

/** The drawn button: `.gv-floating-fab` is 44px square. */
function fabBox(fab: HTMLElement): Box {
  return { x: parseFloat(fab.style.left), y: parseFloat(fab.style.top), w: 44, h: 44 };
}

function panelBox(panel: HTMLElement): Box {
  return {
    x: parseFloat(panel.style.left),
    y: parseFloat(panel.style.top),
    w: parseFloat(panel.style.width),
    h: parseFloat(panel.style.height),
  };
}

afterEach(() => {
  unmountFloatingFab();
  destroyMountedPanels();
  document.body.innerHTML = '';
  document.body.className = '';
  setWindowSize(originalWidth, originalHeight);
  vi.restoreAllMocks();
  resetPageUrl();
});

describe('floating folder surfaces stay off the Prompt Manager ball', () => {
  it.each([
    '<form><textarea id="prompt-textarea"></textarea></form>',
    '<form data-chatgpt-composer><div contenteditable="true" role="textbox"></div></form>',
  ])('stacks above the ball when a beside spot would cover the ChatGPT composer (%s)', (markup) => {
    setWindowSize(1209, 846);
    const ball = { x: 1145, y: 782, w: 46, h: 46 };
    const composer = { x: 430, y: 740, w: 681, h: 88 };
    placeBall(ball);
    placeComposer(composer, markup);

    const fab = fabBox(mountFab());
    expect(overlaps(fab, ball)).toBe(false);
    expect(overlaps(fab, composer)).toBe(false);
    expect(fab.y + fab.h).toBeLessThan(ball.y);
    expect(insideViewport(fab)).toBe(true);
  });

  it('avoids a composer even when the original default does not overlap the ball', () => {
    setWindowSize(1209, 846);
    const ball = { x: 760, y: 780, w: 46, h: 46 };
    const composer = { x: 1080, y: 700, w: 110, h: 132 };
    placeBall(ball);
    placeComposer(composer);

    const fab = fabBox(mountFab());
    expect(overlaps(fab, composer)).toBe(false);
    expect(overlaps(fab, ball)).toBe(false);
    expect(insideViewport(fab)).toBe(true);
  });

  it('moves a default button clear when ChatGPT mounts its composer after the FAB', async () => {
    setWindowSize(1209, 846);
    placeBall(cornerBall());
    const fab = mountFab();
    const composer = { x: 430, y: 740, w: 681, h: 88 };
    expect(overlaps(fabBox(fab), composer)).toBe(true);

    placeComposer(composer);
    await nextFrame();
    expect(overlaps(fabBox(fab), composer)).toBe(false);
    expect(overlaps(fabBox(fab), cornerBall())).toBe(false);
  });

  it('follows a composer moving from the new-chat centre to the bottom during navigation', async () => {
    setWindowSize(1209, 846);
    placeBall(cornerBall());
    const centred = { x: 430, y: 250, w: 681, h: 88 };
    const composer = placeComposer(centred);
    const fab = mountFab();
    const bottom = { ...centred, y: 740 };
    expect(overlaps(fabBox(fab), bottom)).toBe(true);

    composer.getBoundingClientRect = () => new DOMRect(bottom.x, bottom.y, bottom.w, bottom.h);
    composer.classList.add('bottom-composer');
    await nextFrame();
    expect(overlaps(fabBox(fab), bottom)).toBe(false);
    expect(overlaps(fabBox(fab), cornerBall())).toBe(false);
  });

  it('clears the whole composer when the ball itself sits inside a tall composer', () => {
    setWindowSize(1209, 846);
    const ball = { x: 1145, y: 782, w: 46, h: 46 };
    const composer = { x: 600, y: 660, w: 600, h: 170 };
    placeBall(ball);
    placeComposer(composer);

    const fab = fabBox(mountFab());
    expect(overlaps(fab, ball)).toBe(false);
    expect(overlaps(fab, composer)).toBe(false);
    expect(insideViewport(fab)).toBe(true);
  });

  it('keeps Gemini beside-the-ball placement when the ball sits left of its composer', () => {
    setWindowSize(1200, 800);
    const composer = { x: 730, y: 690, w: 400, h: 96 };
    const ball = { x: 670, y: 720, w: 46, h: 46 };
    placeBall(ball);
    placeComposer(
      composer,
      '<div class="text-input-field"><rich-textarea><div contenteditable="true" role="textbox"></div></rich-textarea></div>',
      'gemini.google.com',
    );

    const fab = fabBox(mountFab());
    expect(overlaps(fab, composer)).toBe(false);
    expect(overlaps(fab, ball)).toBe(false);
    expect(fab.y + fab.h).toBeGreaterThan(ball.y);
  });

  it('avoids AI Studio input-area controls while keeping a saved spot unchanged', async () => {
    setWindowSize(1209, 846);
    placeBall(cornerBall());
    const composer = { x: 430, y: 740, w: 681, h: 88 };
    placeComposer(
      composer,
      '<div class="input-area"><textarea></textarea><button>Send</button></div>',
      'aistudio.google.com',
    );
    const defaultFab = fabBox(mountFab());
    expect(overlaps(defaultFab, composer)).toBe(false);
    unmountFloatingFab();

    const saved = { x: 1089, y: 783 };
    const fab = mountFab(saved);
    document.getElementById(PROMPT_TRIGGER_ELEMENT_ID)!.style.bottom = '19px';
    await nextFrame();
    expect([fab.style.left, fab.style.top]).toEqual(['1089px', '783px']);
  });

  it.each([
    [967, 800],
    [1440, 900],
    [500, 400],
  ])('puts the folder button beside the ball in a %ix%i window', (width, height) => {
    setWindowSize(width, height);

    const fab = fabBox(mountFab());

    expect(overlaps(fab, cornerBall())).toBe(false);
    expect(insideViewport(fab)).toBe(true);
    // Still in the corner's row rather than somewhere up the page.
    expect(fab.y + fab.h).toBeGreaterThan(cornerBall().y);
  });

  it('avoids the ball where it actually is once Prompt Manager has mounted it', () => {
    setWindowSize(1200, 800);
    // The user dragged the ball onto the folder button's corner.
    const ball = { x: 1200 - 76, y: 800 - 76, w: 46, h: 46 };
    placeBall(ball);

    const fab = fabBox(mountFab());

    expect(overlaps(fab, ball)).toBe(false);
  });

  it('moves a default folder button off a ball that moves after the button was placed', async () => {
    setWindowSize(967, 800);
    placeBall(cornerBall());
    const fab = mountFab();
    const placed = fabBox(fab);
    expect(overlaps(placed, cornerBall())).toBe(false);

    // Prompt Manager moves its ball next to Gemini's composer after load: here,
    // onto the spot the button took.
    const ball = document.getElementById(PROMPT_TRIGGER_ELEMENT_ID)!;
    const moved = { x: placed.x - 1, y: placed.y - 1, w: 46, h: 46 };
    ball.getBoundingClientRect = () => new DOMRect(moved.x, moved.y, moved.w, moved.h);
    ball.style.right = `${967 - moved.x - moved.w}px`;
    await nextFrame();

    const after = fabBox(fab);
    expect(overlaps(after, moved)).toBe(false);
    expect(insideViewport(after)).toBe(true);
  });

  it('leaves a saved folder button where it is when the ball moves', async () => {
    setWindowSize(967, 800);
    placeBall(cornerBall());
    const saved = { x: 600, y: 600 };
    const fab = mountFab(saved);

    const ball = document.getElementById(PROMPT_TRIGGER_ELEMENT_ID)!;
    ball.getBoundingClientRect = () => new DOMRect(600, 600, 46, 46);
    ball.style.right = '321px';
    await nextFrame();

    expect([fab.style.left, fab.style.top]).toEqual(['600px', '600px']);
  });

  it('keeps a folder button position the user saved, even on the ball', () => {
    setWindowSize(967, 800);
    const saved = { x: cornerBall().x, y: cornerBall().y };

    const fab = mountFab(saved);
    Object.defineProperty(fab, 'offsetLeft', { get: () => parseFloat(fab.style.left) });
    Object.defineProperty(fab, 'offsetTop', { get: () => parseFloat(fab.style.top) });
    expect([fab.style.left, fab.style.top]).toEqual([`${saved.x}px`, `${saved.y}px`]);

    setWindowSize(1440, 900);
    window.dispatchEvent(new Event('resize'));
    expect([fab.style.left, fab.style.top]).toEqual([`${saved.x}px`, `${saved.y}px`]);
  });

  it('moves a default folder button with the corner when the window shrinks', () => {
    setWindowSize(1440, 900);
    const fab = mountFab();
    // jsdom has no layout: report the offsets the inline position gives.
    Object.defineProperty(fab, 'offsetLeft', { get: () => parseFloat(fab.style.left) });
    Object.defineProperty(fab, 'offsetTop', { get: () => parseFloat(fab.style.top) });

    setWindowSize(967, 700);
    window.dispatchEvent(new Event('resize'));

    expect(overlaps(fabBox(fab), cornerBall())).toBe(false);
    expect(insideViewport(fabBox(fab))).toBe(true);
  });

  it('keeps the folder button in its corner when RTL mirrors the ball to the left', () => {
    setWindowSize(967, 800);
    document.body.classList.add('gv-rtl');

    const fab = fabBox(mountFab());

    expect(overlaps(fab, rtlBall())).toBe(false);
    expect(fab.x).toBe(967 - 52 - 24);
  });

  it('moves a folder button away from a ball dragged under it in RTL', () => {
    setWindowSize(967, 800);
    document.body.classList.add('gv-rtl');
    const ball = { x: 967 - 70, y: 800 - 70, w: 46, h: 46 };
    placeBall(ball);

    const fab = fabBox(mountFab());

    expect(overlaps(fab, ball)).toBe(false);
    expect(insideViewport(fab)).toBe(true);
  });

  it.each([
    [967, 800],
    [1440, 900],
    [400, 800],
  ])('opens the folder panel clear of the ball in a %ix%i window', (width, height) => {
    setWindowSize(width, height);

    const panel = panelBox(mountPanel().element);

    expect(overlaps(panel, cornerBall())).toBe(false);
    expect(insideViewport(panel)).toBe(true);
  });

  it('keeps a folder panel position the user saved', () => {
    setWindowSize(967, 800);

    const panel = mountPanel({ storedPos: { x: 600, y: 360 } }).element;

    expect([panel.style.left, panel.style.top]).toEqual(['600px', '360px']);
  });

  it('describes the ball slot that the stylesheet draws', () => {
    const css = readContentStyle();
    const trigger = css.match(/\n\.gv-pm-trigger \{([^}]*)\}/)?.[1] ?? '';
    const rtl = css.match(/body\.gv-rtl \.gv-pm-trigger \{([^}]*)\}/)?.[1] ?? '';
    const inset = `${PROMPT_TRIGGER_DEFAULT_INSET}px`;
    const size = `${PROMPT_TRIGGER_SIZE}px`;

    expect(trigger).toContain(`right: ${inset};`);
    expect(trigger).toContain(`bottom: ${inset};`);
    expect(trigger).toContain(`width: ${size};`);
    expect(trigger).toContain(`height: ${size};`);
    expect(rtl).toContain(`left: ${inset};`);
  });
});
