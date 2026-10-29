/**
 * How long the shell toast stays (decision Q17): one that offers 撤销 stays
 * about 10s and waits while the pointer or focus is on it; one without an
 * action goes after 4.2s.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createShellToast } from '../toast';
import {
  type ShellPage,
  ball,
  bootstrapI18n,
  flush,
  hover,
  installShellPage,
  pressAltV,
  satellite,
  unhover,
} from './shellHarness';

vi.mock('webextension-polyfill', () => ({ default: globalThis.chrome }));
vi.mock('@/core/utils/userEvent', () => import('./forgedEvents'));

const CLAUDE = 'https://claude.ai/new';
let page: ShellPage;

beforeAll(bootstrapI18n);

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'Date',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
  });
  page = installShellPage(CLAUDE);
});

afterEach(async () => {
  await page.restore();
  vi.useRealTimers();
});

function toast(): HTMLElement {
  return document.querySelector<HTMLElement>('.gv-ps-toast')!;
}

function showing(): boolean {
  return toast().classList.contains('gv-ps-toast-open');
}

async function hideBall(): Promise<void> {
  hover(ball());
  satellite('hide')!.click();
  await flush();
}

describe('shell toast timing', () => {
  it('keeps the hide toast about 10s and waits while the pointer is on it', async () => {
    await page.start();
    await hideBall();

    await vi.advanceTimersByTimeAsync(9_000);
    expect(showing()).toBe(true);
    hover(toast());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(showing()).toBe(true);

    unhover(toast());
    await vi.advanceTimersByTimeAsync(900);
    expect(showing()).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(showing()).toBe(false);
  });

  it('waits while focus is on 撤销 and resumes when focus leaves', async () => {
    await page.start();
    await hideBall();
    const undo = toast().querySelector<HTMLButtonElement>('.gv-ps-toast-undo')!;

    await vi.advanceTimersByTimeAsync(4_000);
    undo.focus();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(showing()).toBe(true);

    undo.blur();
    await vi.advanceTimersByTimeAsync(5_900);
    expect(showing()).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(showing()).toBe(false);
  });

  it('lets a toast without an action go after 4.2s, pointer or not', async () => {
    page.tokenReply = () => ({ ok: false, error: 'sender_not_allowed' });
    page.popupReply = { ok: false, error: 'no popup' };
    await page.start();
    pressAltV(document.body);
    await flush();
    expect(showing()).toBe(true);

    hover(toast());
    await vi.advanceTimersByTimeAsync(4_200);

    expect(showing()).toBe(false);
  });

  it('shows nothing once destroyed, for a caller that answers late', () => {
    const late = createShellToast();
    late.destroy();

    late.show({ render: () => [document.createTextNode('late')] });

    expect(document.querySelector('.gv-ps-toast')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
