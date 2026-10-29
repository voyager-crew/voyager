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
  TOKEN,
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
  vi.restoreAllMocks();
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

describe('panel bootstrap isolation', () => {
  it('delivers the bootstrap after an initial blank document load drops the first handoff', async () => {
    page = installShellPage(CLAUDE);
    await page.start();
    pressAltV(document.body);
    await flush();
    const iframe = document.querySelector<HTMLIFrameElement>('.gv-ps-frame')!;
    let loadedOrigin = new URL(CLAUDE).origin;
    const delivered: unknown[] = [];
    const post = vi
      .spyOn(iframe.contentWindow!, 'postMessage')
      .mockImplementation((message: unknown, targetOrigin) => {
        // The initial about:blank document inherits the host origin; the browser drops this send.
        if (targetOrigin === loadedOrigin) delivered.push(message);
      });

    iframe.dispatchEvent(new Event('load'));
    expect(post).toHaveBeenCalledWith(
      { kind: 'gv.panel.bootstrap', token: TOKEN },
      EXTENSION_ORIGIN,
    );
    expect(delivered).toEqual([]);

    loadedOrigin = EXTENSION_ORIGIN;
    iframe.dispatchEvent(new Event('load'));
    expect(delivered).toEqual([{ kind: 'gv.panel.bootstrap', token: TOKEN }]);

    postFromPanel({ kind: 'gv.panel.bootstrap.accepted' });
    iframe.dispatchEvent(new Event('load'));
    expect(delivered).toEqual([{ kind: 'gv.panel.bootstrap', token: TOKEN }]);
  });

  it('keeps the redeemable secret out of the DOM and sends it only to the created frame after load', async () => {
    page = installShellPage(CLAUDE);
    await page.start();
    pressAltV(document.body);
    await flush();
    const iframe = document.querySelector<HTMLIFrameElement>('.gv-ps-frame')!;
    const original = vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => {});
    const transplanted = iframe.cloneNode() as HTMLIFrameElement;
    document.body.appendChild(transplanted);
    const stolen = vi
      .spyOn(transplanted.contentWindow!, 'postMessage')
      .mockImplementation(() => {});

    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(new URL(iframe.src).search).toBe('');
    expect(original).not.toHaveBeenCalled();
    iframe.dispatchEvent(forge(new Event('load')));
    transplanted.dispatchEvent(new Event('load'));
    expect(original).not.toHaveBeenCalled();
    expect(stolen).not.toHaveBeenCalled();

    iframe.dispatchEvent(new Event('load'));
    expect(original).toHaveBeenCalledExactlyOnceWith(
      { kind: 'gv.panel.bootstrap', token: TOKEN },
      EXTENSION_ORIGIN,
    );
    postFromPanel({ kind: 'gv.panel.bootstrap.accepted' });
    iframe.dispatchEvent(new Event('load'));
    expect(original).toHaveBeenCalledOnce();
    expect(stolen).not.toHaveBeenCalled();
  });

  it.each(['synthetic', 'other frame', 'host origin', 'malformed'])(
    'ignores a %s acknowledgment and continues delivery',
    async (attack) => {
      page = installShellPage(CLAUDE);
      await page.start();
      pressAltV(document.body);
      await flush();
      const iframe = document.querySelector<HTMLIFrameElement>('.gv-ps-frame')!;
      const post = vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => {});
      iframe.dispatchEvent(new Event('load'));

      const other = document.createElement('iframe');
      document.body.appendChild(other);
      const acknowledgment = new MessageEvent('message', {
        data: { kind: attack === 'malformed' ? null : 'gv.panel.bootstrap.accepted' },
        source: attack === 'other frame' ? other.contentWindow : iframe.contentWindow,
        origin: attack === 'host origin' ? new URL(CLAUDE).origin : EXTENSION_ORIGIN,
      });
      window.dispatchEvent(attack === 'synthetic' ? forge(acknowledgment) : acknowledgment);
      iframe.dispatchEvent(new Event('load'));
      expect(post).toHaveBeenCalledTimes(2);

      postFromPanel({ kind: 'gv.panel.bootstrap.accepted' });
      iframe.dispatchEvent(new Event('load'));
      expect(post).toHaveBeenCalledTimes(2);
    },
  );

  it('sends no further bootstrap after the shell stops before acknowledgment', async () => {
    page = installShellPage(CLAUDE);
    const stop = await page.start();
    pressAltV(document.body);
    await flush();
    const iframe = document.querySelector<HTMLIFrameElement>('.gv-ps-frame')!;
    const post = vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => {});
    iframe.dispatchEvent(new Event('load'));
    expect(post).toHaveBeenCalledOnce();

    stop();
    await flush();
    iframe.dispatchEvent(new Event('load'));
    expect(post).toHaveBeenCalledOnce();
    expect(panel()).toBeNull();
  });

  it.each([
    'remove',
    'replace',
    'src change',
    'srcdoc change',
    'src change and reset',
    'remove and reinsert',
    'root detach and reinsert',
  ])('revokes the redeemed session when the exact iframe is changed: %s', async (attack) => {
    page = installShellPage(CLAUDE);
    await page.start();
    pressAltV(document.body);
    await flush();
    const wrapper = panel()!;
    const iframe = wrapper.querySelector('iframe')!;
    const originalUrl = iframe.src;
    iframe.dispatchEvent(new Event('load'));
    postFromPanel({ kind: 'gv.panel.bootstrap.accepted' });
    if (attack === 'remove') iframe.remove();
    if (attack === 'replace') iframe.replaceWith(iframe.cloneNode());
    if (attack.startsWith('src change')) iframe.src = 'https://evil.example/';
    if (attack === 'srcdoc change') iframe.srcdoc = '<p>replaced</p>';
    if (attack === 'src change and reset') iframe.src = originalUrl;
    if (attack === 'remove and reinsert') {
      iframe.remove();
      wrapper.appendChild(iframe);
    }
    if (attack === 'root detach and reinsert') {
      const root = document.documentElement;
      root.remove();
      document.appendChild(root);
    }
    await flush();

    expect(page.sentOfType(PANEL_MESSAGE.close)).toHaveLength(1);
    expect(panel()).toBeNull();
  });

  it('does not send the secret if the host changes and resets src immediately before load', async () => {
    page = installShellPage(CLAUDE);
    await page.start();
    pressAltV(document.body);
    await flush();
    const iframe = document.querySelector<HTMLIFrameElement>('.gv-ps-frame')!;
    const post = vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => {});
    const originalUrl = iframe.src;
    iframe.src = 'https://evil.example/';
    iframe.src = originalUrl;
    iframe.dispatchEvent(new Event('load'));

    expect(post).not.toHaveBeenCalled();
    await flush();
    expect(page.sentOfType(PANEL_MESSAGE.close)).toHaveLength(1);
    expect(panel()).toBeNull();
  });

  it('revokes a removed iframe while its close animation is still running', async () => {
    page = installShellPage(CLAUDE);
    await page.start();
    pressAltV(document.body);
    await flush();
    let finish = (): void => {};
    const finished = new Promise<void>((resolve) => (finish = resolve));
    const previous = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: () => ({ finished, cancel: () => {} }),
    });
    try {
      postFromPanel({ kind: PANEL_SHELL_MESSAGE.close });
      await flush();
      expect(panel()).not.toBeNull();
      expect(page.sentOfType(PANEL_MESSAGE.close)).toHaveLength(0);
      panel()!.querySelector('iframe')!.remove();
      await flush();
      expect(page.sentOfType(PANEL_MESSAGE.close)).toHaveLength(1);
      expect(panel()).toBeNull();
    } finally {
      finish();
      if (previous) Object.defineProperty(Element.prototype, 'animate', previous);
      else Reflect.deleteProperty(Element.prototype, 'animate');
    }
  });
});
