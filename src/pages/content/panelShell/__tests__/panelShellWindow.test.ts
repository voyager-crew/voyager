/**
 * The panel window through the running shell: the token handshake, where the
 * frame sits and how the panel page's messages move it, and which messages
 * the shell refuses.
 */
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { PANEL_MESSAGE, PANEL_SHELL_MESSAGE } from '@/features/panel/protocol';

import {
  PANEL_URL,
  type ShellPage,
  bootstrapI18n,
  flush,
  installShellPage,
  issued,
  panel,
  postFromPanel,
  pressAltV,
  stopRecordingAnimations,
} from './shellHarness';

vi.mock('webextension-polyfill', () => ({ default: globalThis.chrome }));
vi.mock('@/core/utils/userEvent', () => import('./forgedEvents'));

const CLAUDE = 'https://claude.ai/new';
const viewport = {
  width: Object.getOwnPropertyDescriptor(window, 'innerWidth'),
  height: Object.getOwnPropertyDescriptor(window, 'innerHeight'),
};

let page: ShellPage;

beforeAll(bootstrapI18n);

afterEach(async () => {
  await page.restore();
  if (viewport.width) Object.defineProperty(window, 'innerWidth', viewport.width);
  if (viewport.height) Object.defineProperty(window, 'innerHeight', viewport.height);
  document.documentElement.removeAttribute('data-gv-scheme');
  document.documentElement.removeAttribute('dir');
  vi.restoreAllMocks();
});

function resizeTo(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
  window.dispatchEvent(new Event('resize'));
}

function at(): { left: string; top: string } {
  return { left: panel()!.style.left, top: panel()!.style.top };
}

function savedPositions(): unknown {
  return page.memory.values.local.get(StorageKeys.PANEL_POSITIONS);
}

async function open(url = CLAUDE): Promise<void> {
  page = installShellPage(url);
  await page.start();
  pressAltV(document.body);
  await flush();
}

describe('panel window', () => {
  it('asks the background for a token with the page context and mounts the page it returns, centered', async () => {
    page = installShellPage('https://gemini.google.com/u/1/app/abc');
    document.documentElement.setAttribute('data-gv-scheme', 'dark');
    await page.start();
    pressAltV(document.body);
    await flush();

    expect(page.sentOfType(PANEL_MESSAGE.tokenIssue).map((message) => message.payload)).toEqual([
      {
        context: {
          pageUrl: 'https://gemini.google.com/u/1/app/abc',
          siteId: 'gemini',
          accountSlot: '1',
          scheme: 'dark',
          direction: 'ltr',
        },
      },
    ]);
    // The keyboard opened it, so the panel page draws focus rings.
    expect(document.querySelector<HTMLIFrameElement>('.gv-ps-frame')?.src).toBe(
      `${PANEL_URL}#keyboard`,
    );
    expect(panel()?.getAttribute('role')).toBe('dialog');
    // 880 × 560 in jsdom's 1024 × 768 viewport.
    expect(at()).toEqual({ left: '72px', top: '104px' });
  });

  it('restores the saved position, clamps it into a smaller viewport and keeps what was saved', async () => {
    page = installShellPage(CLAUDE);
    page.memory.values.local.set(StorageKeys.PANEL_POSITIONS, { claude: { x: 100, y: 150 } });
    await page.start();
    pressAltV(document.body);
    await flush();
    expect(at()).toEqual({ left: '100px', top: '150px' });

    // 800 × 600: the panel is 776 × 560, so it fits only 12px from the left and 28px from the top.
    resizeTo(800, 600);
    expect(at()).toEqual({ left: '12px', top: '28px' });

    resizeTo(1024, 768);
    expect(at()).toEqual({ left: '100px', top: '150px' });
    expect(page.memory.writes.filter((write) => write.key === StorageKeys.PANEL_POSITIONS)).toEqual(
      [],
    );
  });

  it('moves with the drag messages and saves its position once, at drag end', async () => {
    await open();
    const drag = (kind: string, deltaX: number, deltaY: number) =>
      postFromPanel({ kind, deltaX, deltaY });

    drag(PANEL_SHELL_MESSAGE.dragStart, 0, 0);
    expect(panel()?.classList.contains('gv-ps-dragging')).toBe(true);
    drag(PANEL_SHELL_MESSAGE.dragMove, 10, 20);
    expect(at()).toEqual({ left: '82px', top: '124px' });
    drag(PANEL_SHELL_MESSAGE.dragMove, 40, -30);
    expect(at()).toEqual({ left: '112px', top: '74px' });
    drag(PANEL_SHELL_MESSAGE.dragEnd, 40, -30);
    await flush();

    expect(panel()?.classList.contains('gv-ps-dragging')).toBe(false);
    expect(page.memory.writes.filter((write) => write.key === StorageKeys.PANEL_POSITIONS)).toEqual(
      [{ area: 'local', key: StorageKeys.PANEL_POSITIONS }],
    );
    expect(savedPositions()).toEqual({ claude: { x: 112, y: 74 } });
  });

  it('glides back to the center on recenter and forgets the saved position', async () => {
    page = installShellPage(CLAUDE);
    page.memory.values.local.set(StorageKeys.PANEL_POSITIONS, {
      claude: { x: 20, y: 30 },
      chatgpt: { x: 5, y: 5 },
    });
    await page.start();
    pressAltV(document.body);
    await flush();

    postFromPanel({ kind: PANEL_SHELL_MESSAGE.recenter });
    await flush();

    expect(at()).toEqual({ left: '72px', top: '104px' });
    expect(panel()?.classList.contains('gv-ps-glide')).toBe(true);
    expect(savedPositions()).toEqual({ chatgpt: { x: 5, y: 5 } });
  });

  it('ignores window messages from any other window or origin', async () => {
    await open();
    const close = { kind: PANEL_SHELL_MESSAGE.close };

    postFromPanel(close, { source: window });
    postFromPanel(close, { source: null });
    postFromPanel(close, { origin: 'https://claude.ai' });
    postFromPanel({ kind: PANEL_SHELL_MESSAGE.dragEnd, deltaX: 'far', deltaY: 0 });
    await flush();
    expect(panel()).not.toBeNull();
    expect(page.sentOfType(PANEL_MESSAGE.close)).toEqual([]);

    postFromPanel(close);
    await flush();
    expect(panel()).toBeNull();
    expect(page.sentOfType(PANEL_MESSAGE.close)).toHaveLength(1);
  });

  it('fades to a peek while a slider is held', async () => {
    await open();

    postFromPanel({ kind: PANEL_SHELL_MESSAGE.fade, faded: true });
    expect(panel()?.classList.contains('gv-ps-peek')).toBe(true);
    postFromPanel({ kind: PANEL_SHELL_MESSAGE.fade, faded: false });
    expect(panel()?.classList.contains('gv-ps-peek')).toBe(false);
  });

  it('mounts nothing for a token that arrives after the panel was toggled closed', async () => {
    page = installShellPage(CLAUDE);
    let answer: (reply: unknown) => void = () => {};
    page.tokenReply = () => new Promise((resolve) => (answer = resolve));
    await page.start();

    pressAltV(document.body);
    await flush();
    pressAltV(document.body);
    answer(issued());
    await flush();

    expect(panel()).toBeNull();
    // The background revokes whatever it issued for this tab.
    expect(page.sentOfType(PANEL_MESSAGE.close)).toHaveLength(1);
  });

  it('offers the popup instead when the background refuses, and says where settings are if that fails too', async () => {
    page = installShellPage(CLAUDE);
    page.tokenReply = () => ({ ok: false, error: 'sender_not_allowed' });
    page.popupReply = { ok: false, error: 'no popup' };
    await page.start();

    pressAltV(document.body);
    await flush();

    expect(panel()).toBeNull();
    expect(page.sentOfType('gv.openPopup')).toHaveLength(1);
    const toast = document.querySelector('.gv-ps-toast');
    expect(toast?.classList.contains('gv-ps-toast-open')).toBe(true);
    expect(toast?.textContent).toContain('extension');
    expect(toast?.querySelector<HTMLButtonElement>('.gv-ps-toast-undo')?.hidden).toBe(true);
  });

  it('tells the background what changed while the token was on its way or the close played', async () => {
    page = installShellPage(CLAUDE);
    let answer: (reply: unknown) => void = () => {};
    page.tokenReply = () => new Promise((resolve) => (answer = resolve));
    await page.start();
    const updates = () =>
      page
        .sentOfType(PANEL_MESSAGE.contextUpdate)
        .map((message) => (message.payload as { context: Record<string, unknown> }).context);

    pressAltV(document.body);
    await flush();
    history.pushState(null, '', '/chat/9');
    window.dispatchEvent(new PopStateEvent('popstate'));
    answer(issued());
    await flush();
    expect(updates()).toEqual([expect.objectContaining({ pageUrl: 'https://claude.ai/chat/9' })]);

    // A close that is still playing when the panel opens again keeps its frame.
    let finish: () => void = () => {};
    const playing = new Promise<void>((resolve) => (finish = resolve));
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: () => ({ finished: playing, cancel: () => {} }),
    });
    onTestFinished(() => {
      finish();
      stopRecordingAnimations();
    });
    pressAltV(document.body);
    await flush();
    document.documentElement.setAttribute('data-gv-scheme', 'dark');
    pressAltV(document.body);
    await flush();

    expect(updates()).toHaveLength(2);
    expect(updates()[1]).toEqual(expect.objectContaining({ scheme: 'dark' }));
  });

  it('tells the background when the page moves on, its scheme or its direction changes', async () => {
    await open();
    const updates = () =>
      page
        .sentOfType(PANEL_MESSAGE.contextUpdate)
        .map((message) => (message.payload as { context: Record<string, unknown> }).context);

    history.pushState(null, '', '/chat/123');
    window.dispatchEvent(new PopStateEvent('popstate'));
    document.documentElement.setAttribute('data-gv-scheme', 'dark');
    await flush();
    document.documentElement.setAttribute('dir', 'rtl');
    await flush();

    expect(updates()).toEqual([
      expect.objectContaining({ pageUrl: 'https://claude.ai/chat/123', scheme: 'light' }),
      expect.objectContaining({ pageUrl: 'https://claude.ai/chat/123', scheme: 'dark' }),
      expect.objectContaining({ scheme: 'dark', direction: 'rtl' }),
    ]);
    expect(document.querySelector<HTMLIFrameElement>('.gv-ps-frame')?.style.colorScheme).toBe(
      'dark',
    );
  });
});
