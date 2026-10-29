/**
 * The satellites' springs through the running shell: called back or sent out
 * again mid-flight they turn around where they are, the label glides between
 * them, the frame loop stops once they settle, and reduced motion puts them
 * in place at once.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { startPromptManager } from '../../prompt/index';
import { resolvePromptSiteAdapter } from '../../prompt/resolvePromptSiteAdapter';
import {
  type ShellPage,
  ball,
  bootstrapI18n,
  flush,
  hover,
  installShellPage,
  satellite,
  unhover,
} from './shellHarness';

vi.mock('webextension-polyfill', () => ({ default: globalThis.chrome }));
vi.mock('@/core/utils/userEvent', () => import('./forgedEvents'));

// Prompt Manager is off on claude.ai by default: the ball carries only "Hide".
const CLAUDE = 'https://claude.ai/new';
const GEMINI = 'https://gemini.google.com/app';
const FRAME = 16;

let page: ShellPage;
let manager: { destroy: () => void } | undefined;

beforeAll(bootstrapI18n);

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
  });
  page = installShellPage(CLAUDE);
});

afterEach(async () => {
  manager?.destroy();
  manager = undefined;
  await page.restore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** How far the "Hide" satellite sits from the ball's centre, px. */
function distance(): number {
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(satellite('hide')!.style.transform);
  return match ? Math.hypot(Number(match[1]), Number(match[2])) : Number.NaN;
}

/** Distances after each of `frames` frames. */
function frames(count: number): number[] {
  const seen: number[] = [];
  for (let frame = 0; frame < count; frame += 1) {
    vi.advanceTimersByTime(FRAME);
    seen.push(distance());
  }
  return seen;
}

/** The pointer moves from one element onto the next: it leaves before it enters. */
function cross(from: Element | null, to: Element | null): void {
  unhover(from);
  hover(to);
}

function largestStep(path: number[]): number {
  return Math.max(...path.slice(1).map((value, index) => Math.abs(value - path[index])));
}

describe('satellite orbit', () => {
  it('turns a satellite around where it is when the pointer leaves or comes back mid-flight', async () => {
    await page.start();
    // Start-up timers run out; a shell at rest then has nothing scheduled.
    vi.advanceTimersByTime(5000);
    expect(vi.getTimerCount()).toBe(0);

    hover(ball());
    const launch = frames(5);
    expect(launch[4]).toBeGreaterThan(launch[0]);
    expect(launch[4]).toBeLessThan(52);

    // Left mid-launch: after the pause it heads back in from wherever it got to.
    unhover(ball());
    const recall: number[] = [];
    const headingIn = (): boolean =>
      recall.length > 1 && recall.at(-1)! < recall.at(-2)! && recall.at(-1)! < 30;
    while (recall.length < 60 && !headingIn()) recall.push(...frames(1));
    const midway = recall.at(-1)!;
    expect(midway).toBeGreaterThan(5);
    expect(midway).toBeLessThan(30);

    // Back before it reached the ball: it goes out again from there.
    hover(ball());
    const resumed = frames(60);
    expect(Math.abs(resumed[0] - midway)).toBeLessThan(12);
    expect(resumed.at(-1)).toBeCloseTo(52, 0);
    expect(largestStep([...launch, ...recall, ...resumed])).toBeLessThan(12);

    // Settled: no frame is asked for any more.
    vi.advanceTimersByTime(1000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('puts the satellites in place at once under reduced motion, without asking for frames', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    await page.start();
    // Start-up timers run out; a shell at rest then has nothing scheduled.
    vi.advanceTimersByTime(5000);
    expect(vi.getTimerCount()).toBe(0);

    hover(ball());
    expect(distance()).toBeCloseTo(52, 0);
    expect(Number(satellite('hide')!.style.opacity)).toBe(1);
    expect(vi.getTimerCount()).toBe(0);

    unhover(ball());
    expect(distance()).toBe(0);
    expect(Number(satellite('hide')!.style.opacity)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('glides the label from one satellite to the next as the pointer crosses between them', async () => {
    page = installShellPage(GEMINI);
    await page.start();
    manager = await startPromptManager(resolvePromptSiteAdapter(location.href));
    await flush();
    const bridge = document.querySelector('.gv-ps-bridge');
    const label = document.querySelector<HTMLElement>('.gv-ps-entry .gv-ps-tip')!;

    hover(ball());
    cross(ball(), bridge);
    cross(bridge, satellite('panel'));
    vi.advanceTimersByTime(1000);
    const onPanel = label.style.transform;

    // Between the two the pointer is over neither satellite for an instant.
    cross(satellite('panel'), bridge);
    cross(bridge, satellite('hide'));
    vi.advanceTimersByTime(3 * FRAME);
    const underway = label.style.transform;
    vi.advanceTimersByTime(1000);

    expect(label.classList.contains('gv-ps-tip-on')).toBe(true);
    expect(label.textContent).toBe('Hide');
    expect(label.style.transform).not.toBe(onPanel);
    expect(underway).not.toBe(onPanel);
    expect(underway).not.toBe(label.style.transform);
  });
});
