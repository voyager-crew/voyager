import { act } from 'react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

beforeEach(() => {
  vi.resetModules();
  sendMessage.mockReset();
  vi.stubGlobal('chrome', { ...chrome, runtime: { ...chrome.runtime, sendMessage } });
  document.body.innerHTML = '<div id="__root"></div>';
  window.history.replaceState(null, '', '/src/pages/panel/index.html');
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

async function load(urlToken?: string) {
  if (urlToken) window.history.replaceState(null, '', `?token=${urlToken}`);
  await act(async () => {
    await import('../index');
  });
}

describe('panel page token gate', () => {
  it('stays blank without a token', async () => {
    await load();
    expect(document.getElementById('__root')?.childElementCount).toBe(0);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it.each(['one-time-token', 'a'.repeat(63), 'g'.repeat(64)])(
    'stays blank without requesting redemption for malformed URL token: %s',
    async (urlToken) => {
      await load(urlToken);
      expect(document.getElementById('__root')?.childElementCount).toBe(0);
      expect(sendMessage).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ok: false, error: 'refused' },
    { ok: true, session: { sessionId: 'forged' } },
    undefined,
  ])('stays blank when redemption is refused or malformed: %j', async (reply) => {
    sendMessage.mockResolvedValue(reply);
    await load(token);
    expect(document.getElementById('__root')?.childElementCount).toBe(0);
  });

  it('stays blank if the background cannot be reached', async () => {
    sendMessage.mockRejectedValue(new Error('background unavailable'));
    await load(token);
    expect(document.getElementById('__root')?.childElementCount).toBe(0);
  });

  it('mounts only after the background confirms a valid session', async () => {
    let confirm: (value: unknown) => void = () => {};
    sendMessage.mockReturnValue(
      new Promise((resolve) => {
        confirm = resolve;
      }),
    );
    await load(token);
    expect(document.getElementById('__root')?.childElementCount).toBe(0);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'gv.panel.token.redeem',
      payload: { token },
    });
    await act(async () => confirm({ ok: true, session }));
    expect(document.querySelector('[data-panel-session]')?.getAttribute('data-panel-session')).toBe(
      'a'.repeat(64),
    );
  });
});
