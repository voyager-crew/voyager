/**
 * Stopping the shell with everything in flight: the panel open mid-drag and
 * mid-preview, the satellites out, the hide toast up and a recenter gliding.
 * The registry's lifecycle test covers a quiet start and stop.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PANEL_MESSAGE, PANEL_SHELL_MESSAGE } from '@/features/panel/protocol';

import { type LifecycleHarness, installLifecycleHarness } from '../../__tests__/lifecycleHarness';
import { createPanelController } from '../controller';
import type { ToastMessage } from '../toast';
import {
  type ShellPage,
  ball,
  bootstrapI18n,
  flush,
  hover,
  installShellPage,
  panel,
  postFromPanel,
  pressAltV,
  satellite,
} from './shellHarness';

vi.mock('webextension-polyfill', () => ({ default: globalThis.chrome }));
vi.mock('@/core/utils/userEvent', () => import('./forgedEvents'));

let harness: LifecycleHarness;
let page: ShellPage;

beforeAll(bootstrapI18n);

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
  });
  harness = installLifecycleHarness();
  page = installShellPage('https://claude.ai/new');
});

afterEach(async () => {
  await page.restore();
  harness.restore();
  vi.useRealTimers();
});

function snapshotDocument(): { head: string; body: string; html: string } {
  return {
    head: document.head.innerHTML,
    body: document.body.outerHTML,
    html: document.documentElement.getAttribute('class') ?? '',
  };
}

describe('panel shell stop', () => {
  it('leaves no DOM, listener, observer, storage subscription or timer behind', async () => {
    const before = snapshotDocument();
    const hostNodes = new Set<EventTarget>(document.querySelectorAll('*'));
    const stop = await page.start();

    hover(ball());
    satellite('hide')!.click();
    await flush();
    pressAltV(document.body);
    await flush();
    postFromPanel({
      kind: PANEL_SHELL_MESSAGE.preview,
      pluginId: 'voyager.width',
      settingKey: 'width',
      value: 70,
    });
    postFromPanel({ kind: PANEL_SHELL_MESSAGE.dragStart, deltaX: 0, deltaY: 0 });
    postFromPanel({ kind: PANEL_SHELL_MESSAGE.dragMove, deltaX: 30, deltaY: 10 });
    postFromPanel({ kind: PANEL_SHELL_MESSAGE.recenter });
    expect(panel()).not.toBeNull();
    expect(document.querySelector('.gv-ps-toast-open')).not.toBeNull();
    expect(document.documentElement.classList.contains('gv-ps-live')).toBe(true);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    stop();
    await flush();

    expect(harness.ledger.openListeners({ detachedHosts: hostNodes })).toEqual([]);
    expect(harness.ledger.openObservers()).toEqual([]);
    expect(page.memory.listeners.size).toBe(0);
    expect(harness.ledger.openRuntimeListeners()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(snapshotDocument()).toEqual(before);
    // The background revokes the open panel's session.
    expect(page.sentOfType(PANEL_MESSAGE.close)).toHaveLength(1);
  });

  it('shows no popup fallback whose reply comes back after the stop', async () => {
    let answer: (reply: unknown) => void = () => {};
    page.tokenReply = () => ({ ok: false, error: 'sender_not_allowed' });
    page.popupReply = new Promise((resolve) => (answer = resolve));
    const shown: ToastMessage[] = [];
    const controller = createPanelController({
      entry: () => null,
      ballTogglesPanel: () => false,
      toast: {
        show: (message) => void shown.push(message),
        dismiss: () => {},
        contains: () => false,
        relabel: () => {},
        destroy: () => {},
      },
      onOpenChange: () => {},
    });

    controller.open(null);
    await flush();
    expect(page.sentOfType('gv.openPopup')).toHaveLength(1);
    await controller.stop();
    answer({ ok: false, error: 'no popup' });
    await flush();

    expect(shown).toEqual([]);
  });
});
