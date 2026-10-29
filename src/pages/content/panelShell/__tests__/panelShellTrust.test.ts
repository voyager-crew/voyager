/**
 * What a host page script cannot do through the shell. A forged click on the
 * ball, a satellite or 撤销, a forged ⌥V and a forged MessageEvent that names
 * the panel's frame and the extension's origin would each write settings or
 * steer the panel; the browser marks none of them trusted.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { PANEL_MESSAGE, PANEL_SHELL_MESSAGE } from '@/features/panel/protocol';

import { forge } from './forgedEvents';
import {
  EXTENSION_ORIGIN,
  type ShellPage,
  ball,
  bootstrapI18n,
  flush,
  frameWindow,
  hover,
  installShellPage,
  panel,
  postFromPanel,
  pressAltV,
  satellite,
} from './shellHarness';

vi.mock('webextension-polyfill', () => ({ default: globalThis.chrome }));
vi.mock('@/core/utils/userEvent', () => import('./forgedEvents'));

const CLAUDE = 'https://claude.ai/new';
let page: ShellPage;

beforeAll(bootstrapI18n);

afterEach(async () => {
  await page.restore();
});

function forgedClick(target: Element): void {
  target.dispatchEvent(forge(new MouseEvent('click', { bubbles: true, cancelable: true })));
}

function hideWrites(): unknown[] {
  return page.memory.writes.filter((write) => write.key === StorageKeys.HIDE_PROMPT_MANAGER);
}

describe('forged input', () => {
  it('neither hides the ball nor opens the panel from a forged click on a satellite', async () => {
    page = installShellPage(CLAUDE);
    await page.start();
    hover(ball());

    forgedClick(satellite('hide')!);
    forgedClick(satellite('panel')!);
    await flush();

    expect(hideWrites()).toEqual([]);
    expect(getComputedStyle(ball()!).display).not.toBe('none');
    expect(page.sentOfType(PANEL_MESSAGE.tokenIssue)).toEqual([]);
  });

  it('opens no panel from a forged click on the ball that opens it', async () => {
    page = installShellPage(CLAUDE);
    await page.start();

    forgedClick(ball()!);
    await flush();

    expect(page.sentOfType(PANEL_MESSAGE.tokenIssue)).toEqual([]);
    expect(panel()).toBeNull();
  });

  it('keeps the update hint on the ball and writes nothing on a forged click', async () => {
    page = installShellPage(CLAUDE);
    // Release notes in badge mode, last dismissed for an older version: the ball announces them.
    page.memory.values.local.set(StorageKeys.CHANGELOG_NOTIFY_MODE, 'badge');
    page.memory.values.local.set(StorageKeys.CHANGELOG_DISMISSED_VERSION, '0.0.1');
    await page.start();
    expect(ball()!.classList.contains('gv-pm-trigger-new')).toBe(true);
    const writesBefore = page.memory.writes.length;

    forgedClick(ball()!);
    await flush();

    expect(ball()!.classList.contains('gv-pm-trigger-new')).toBe(true);
    expect(page.memory.writes.slice(writesBefore)).toEqual([]);
    expect(page.sentOfType(PANEL_MESSAGE.tokenIssue)).toEqual([]);
  });

  it('keeps the ball hidden when 撤销 gets a forged click', async () => {
    page = installShellPage(CLAUDE);
    await page.start();
    hover(ball());
    satellite('hide')!.click();
    await flush();

    forgedClick(document.querySelector('.gv-ps-toast-undo')!);
    await flush();

    expect(page.memory.values.sync.get(StorageKeys.HIDE_PROMPT_MANAGER)).toBe(true);
    expect(document.querySelector('.gv-ps-toast-open')).not.toBeNull();
  });

  it('opens nothing and leaves a hidden ball hidden on a forged ⌥V', async () => {
    page = installShellPage(CLAUDE);
    page.memory.values.sync.set(StorageKeys.HIDE_PROMPT_MANAGER, true);
    await page.start();

    document.body.dispatchEvent(
      forge(
        new KeyboardEvent('keydown', {
          key: '√',
          code: 'KeyV',
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    await flush();

    expect(page.sentOfType(PANEL_MESSAGE.tokenIssue)).toEqual([]);
    expect(panel()).toBeNull();
    expect(hideWrites()).toEqual([]);
  });

  it('takes no message from a forged MessageEvent with the frame as source and the extension origin', async () => {
    page = installShellPage(CLAUDE);
    await page.start();
    pressAltV(document.body);
    await flush();
    const forged = (data: unknown): void => {
      window.dispatchEvent(
        forge(
          new MessageEvent('message', { data, origin: EXTENSION_ORIGIN, source: frameWindow() }),
        ),
      );
    };

    forged({ kind: PANEL_SHELL_MESSAGE.dragEnd, deltaX: 40, deltaY: 40 });
    forged({ kind: PANEL_SHELL_MESSAGE.recenter });
    forged({
      kind: PANEL_SHELL_MESSAGE.preview,
      pluginId: 'voyager.width',
      settingKey: 'width',
      value: 70,
    });
    forged({ kind: PANEL_SHELL_MESSAGE.close });
    await flush();

    expect(page.memory.writes.filter((write) => write.key === StorageKeys.PANEL_POSITIONS)).toEqual(
      [],
    );
    expect(document.documentElement.classList.contains('gv-ps-live')).toBe(false);
    expect(panel()).not.toBeNull();
    expect(page.sentOfType(PANEL_MESSAGE.close)).toEqual([]);

    // The panel page's own close, delivered by the browser, still lands.
    postFromPanel({ kind: PANEL_SHELL_MESSAGE.close });
    await flush();
    expect(panel()).toBeNull();
  });
});
