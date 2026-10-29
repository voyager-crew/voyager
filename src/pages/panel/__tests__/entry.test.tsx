import { act } from 'react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The panel's browser APIs (storage, port, permissions); redemption stays on `chrome.runtime` below.
import './panelHarness';

const forged = vi.hoisted(() => new WeakSet<Event>());

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./panelBrowserApi')).extensionApi,
}));
vi.mock('@/core/utils/userEvent', () => ({ isUserEvent: (event: Event) => !forged.has(event) }));

const sendMessage = vi.fn<(message: unknown) => Promise<unknown>>();
const token = 'b'.repeat(64);
const session = {
  sessionId: 'a'.repeat(64),
  hostOrigin: 'https://gemini.google.com',
  context: {
    pageUrl: 'https://gemini.google.com/app',
    siteId: 'gemini',
    accountSlot: '0',
    scheme: 'light',
    direction: 'ltr',
  },
};
let embedder: Window;

beforeEach(() => {
  vi.resetModules();
  sendMessage.mockReset();
  vi.stubGlobal('chrome', { ...chrome, runtime: { ...chrome.runtime, sendMessage } });
  document.body.innerHTML = '<div id="__root"></div><iframe></iframe>';
  embedder = document.querySelector('iframe')!.contentWindow!;
  vi.spyOn(window, 'parent', 'get').mockReturnValue(embedder);
  window.history.replaceState(null, '', '/src/pages/panel/index.html');
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

async function load(urlToken?: string) {
  if (urlToken) window.history.replaceState(null, '', `?token=${urlToken}`);
  await act(async () => {
    await import('../index');
  });
}

async function bootstrap(
  value: unknown = { kind: 'gv.panel.bootstrap', token },
  from: { source?: Window; origin?: string; synthetic?: boolean } = {},
): Promise<void> {
  await act(async () => {
    const event = new MessageEvent('message', {
      data: value,
      source: from.source ?? embedder,
      origin: from.origin ?? session.hostOrigin,
    });
    if (from.synthetic) forged.add(event);
    window.dispatchEvent(event);
  });
}

const blank = () => expect(document.getElementById('__root')?.childElementCount).toBe(0);

describe('panel page bootstrap gate', () => {
  it('stays blank until the shell supplies a secret, even with a valid URL token', async () => {
    sendMessage.mockResolvedValue({ ok: true, session });
    await load(token);
    blank();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it.each(['one-time-token', 'a'.repeat(63), 'g'.repeat(64), null])(
    'does not redeem a malformed bootstrap secret: %s',
    async (invalid) => {
      await load();
      await bootstrap({ kind: 'gv.panel.bootstrap', token: invalid });
      blank();
      expect(sendMessage).not.toHaveBeenCalled();
    },
  );

  it.each(['wrong source', 'synthetic message', 'opaque origin', 'top-level page'])(
    'does not redeem a bootstrap from a %s',
    async (attack) => {
      await load();
      if (attack === 'top-level page') vi.spyOn(window, 'parent', 'get').mockReturnValue(window);
      await bootstrap(undefined, {
        source: attack === 'wrong source' || attack === 'top-level page' ? window : embedder,
        origin: attack === 'opaque origin' ? 'null' : session.hostOrigin,
        synthetic: attack === 'synthetic message',
      });
      blank();
      expect(sendMessage).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ok: false, error: 'refused' },
    { ok: true, session: { sessionId: 'forged' } },
    undefined,
  ])('stays blank when redemption is refused or malformed: %j', async (reply) => {
    const acknowledge = vi.spyOn(embedder, 'postMessage').mockImplementation(() => {});
    sendMessage.mockResolvedValue(reply);
    await load();
    await bootstrap();
    blank();
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it('stays blank if the background cannot be reached', async () => {
    const acknowledge = vi.spyOn(embedder, 'postMessage').mockImplementation(() => {});
    sendMessage.mockRejectedValue(new Error('background unavailable'));
    await load();
    await bootstrap();
    blank();
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it('stays blank if the bootstrap parent origin does not match the redeemed host', async () => {
    const acknowledge = vi.spyOn(embedder, 'postMessage').mockImplementation(() => {});
    sendMessage.mockResolvedValue({ ok: true, session });
    await load();
    await bootstrap(undefined, { origin: 'https://other.example' });
    blank();
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it('mounts only after the background confirms the shell-supplied secret, once', async () => {
    const acknowledge = vi.spyOn(embedder, 'postMessage').mockImplementation(() => {});
    let confirm: (value: unknown) => void = () => {};
    sendMessage.mockReturnValue(
      new Promise((resolve) => {
        confirm = resolve;
      }),
    );
    await load();
    await bootstrap();
    blank();
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'gv.panel.token.redeem',
      payload: { token },
    });
    await bootstrap();
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(acknowledge).not.toHaveBeenCalled();
    await act(async () => confirm({ ok: true, session }));
    expect(acknowledge).toHaveBeenCalledExactlyOnceWith(
      { kind: 'gv.panel.bootstrap.accepted' },
      session.hostOrigin,
    );
    // The page first loads Voyager's language, so its first frame already speaks it.
    await vi.waitFor(async () => {
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(document.querySelector('[data-panel-session]')).not.toBeNull();
    });
    expect(document.querySelector('[data-panel-session]')?.getAttribute('data-panel-session')).toBe(
      'a'.repeat(64),
    );
  });

  it('does not mount from a redemption that finishes after the frame leaves', async () => {
    const acknowledge = vi.spyOn(embedder, 'postMessage').mockImplementation(() => {});
    let confirm: (value: unknown) => void = () => {};
    sendMessage.mockReturnValue(new Promise((resolve) => (confirm = resolve)));
    await load();
    await bootstrap();
    window.dispatchEvent(new Event('pagehide'));
    await act(async () => confirm({ ok: true, session }));
    blank();
    expect(acknowledge).not.toHaveBeenCalled();
  });
});
