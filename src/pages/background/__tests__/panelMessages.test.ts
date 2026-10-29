import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PANEL_MESSAGE,
  PANEL_POPUP_OPEN_CARD_KEY,
  PANEL_TOKEN_TTL_MS,
  parsePanelTokenRedeemReply,
} from '@/features/panel/protocol';

import { isRegisteredPanelFrame } from '../panelStorage';
import { CONTEXT, startPanelHarness } from './panelHarness';

vi.mock('webextension-polyfill', () => ({
  default: new Proxy({}, { get: (_target, key) => Reflect.get(chrome, key) }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('panel handshake through the registered background listener', () => {
  let api: ReturnType<typeof startPanelHarness>;
  beforeEach(() => {
    api = startPanelHarness();
  });

  it('redeems once for the issuing tab and registers only that panel frame', async () => {
    const { token, panelUrl, sender, session } = await api.redeem();
    expect(new URL(panelUrl).search).toBe('');
    expect(panelUrl).not.toContain(token);
    expect(session.context).toEqual(CONTEXT);
    expect(session.hostOrigin).toBe('https://gemini.google.com');
    expect(session.sessionId).not.toBe(token);
    expect(await isRegisteredPanelFrame(sender)).toBe(true);
    expect(await isRegisteredPanelFrame(api.topSender())).toBe(false);
    expect(await isRegisteredPanelFrame({ ...sender, frameId: 5 })).toBe(false);
    expect(await isRegisteredPanelFrame({ ...sender, documentId: 'replacement-document' })).toBe(
      false,
    );

    const replaySender = api.frameSender(panelUrl, 7, 6);
    expect(
      await api.send({ type: PANEL_MESSAGE.tokenRedeem, payload: { token } }, replaySender),
    ).toMatchObject({ ok: false });
    expect(await isRegisteredPanelFrame(replaySender)).toBe(false);
    expect(await isRegisteredPanelFrame(sender)).toBe(true);
  });

  it.each(['wrong tab', 'top frame', 'foreign extension', 'foreign URL', 'wrong page'])(
    'refuses a %s redemption without consuming the legitimate token',
    async (reason) => {
      const { token, panelUrl } = await api.issue();
      const sender = api.frameSender(panelUrl);
      if (reason === 'wrong tab') sender.tab = api.frameSender(panelUrl, 8).tab;
      if (reason === 'top frame') sender.frameId = 0;
      if (reason === 'foreign extension') sender.id = 'another-extension';
      if (reason === 'foreign URL')
        sender.url = panelUrl.replace('test-extension-id', 'another-extension');
      if (reason === 'wrong page') sender.url = chrome.runtime.getURL('src/pages/popup/index.html');
      expect(
        await api.send({ type: PANEL_MESSAGE.tokenRedeem, payload: { token } }, sender),
      ).toMatchObject({ ok: false });
      expect(await isRegisteredPanelFrame(sender)).toBe(false);
      const valid = api.frameSender(panelUrl);
      expect(
        parsePanelTokenRedeemReply(
          await api.send({ type: PANEL_MESSAGE.tokenRedeem, payload: { token } }, valid),
        )?.ok,
      ).toBe(true);
      expect(await isRegisteredPanelFrame(valid)).toBe(true);
    },
  );

  it('does not grant a host-created frame authority from the URL visible in the DOM', async () => {
    const { token, panelUrl } = await api.issue();
    const attacker = api.frameSender(panelUrl, 7, 12);
    const observedToken = new URL(panelUrl).searchParams.get('token');
    expect(
      await api.send(
        { type: PANEL_MESSAGE.tokenRedeem, payload: { token: observedToken } },
        attacker,
      ),
    ).toMatchObject({ ok: false });
    expect(await isRegisteredPanelFrame(attacker)).toBe(false);

    const legitimate = api.frameSender(panelUrl);
    expect(
      await api.send({ type: PANEL_MESSAGE.tokenRedeem, payload: { token } }, legitimate),
    ).toMatchObject({ ok: true });
    expect(await isRegisteredPanelFrame(legitimate)).toBe(true);
    expect(await isRegisteredPanelFrame(attacker)).toBe(false);
  });

  it('refuses expired tokens and malformed requests without registering a frame', async () => {
    vi.useFakeTimers();
    const { token, panelUrl } = await api.issue();
    const sender = api.frameSender(panelUrl);
    vi.setSystemTime(Date.now() + PANEL_TOKEN_TTL_MS);
    expect(
      await api.send({ type: PANEL_MESSAGE.tokenRedeem, payload: { token } }, sender),
    ).toMatchObject({ ok: false });
    expect(
      await api.send({ type: PANEL_MESSAGE.tokenRedeem, payload: { token: {} } }, sender),
    ).toMatchObject({ ok: false });
    expect(await isRegisteredPanelFrame(sender)).toBe(false);
  });

  it('does not redeem a token that expires during the browser access check', async () => {
    vi.useFakeTimers();
    const { token, panelUrl } = await api.issue();
    api.contains.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + PANEL_TOKEN_TTL_MS);
      return true;
    });
    const sender = api.frameSender(panelUrl);
    expect(
      await api.send({ type: PANEL_MESSAGE.tokenRedeem, payload: { token } }, sender),
    ).toMatchObject({ ok: false });
    expect(await isRegisteredPanelFrame(sender)).toBe(false);
  });

  it('refuses token issue from non-top frames, extension pages, foreign extensions and inaccessible tabs', async () => {
    const issue = { type: PANEL_MESSAGE.tokenIssue, payload: { context: CONTEXT } };
    for (const sender of [
      { ...api.topSender(), frameId: 1 },
      { ...api.topSender(), frameId: undefined },
      { ...api.topSender(), id: 'another-extension' },
      { ...api.topSender(), url: chrome.runtime.getURL('src/pages/options/index.html') },
    ])
      expect(await api.send(issue, sender)).toMatchObject({ ok: false });
    expect(
      await api.send({
        ...issue,
        payload: { context: { ...CONTEXT, pageUrl: 'https://evil.example/' } },
      }),
    ).toMatchObject({ ok: false });
    api.contains.mockResolvedValue(false);
    expect(await api.send(issue)).toMatchObject({ ok: false });
  });

  it('retains the token and consumed registration across separate worker instances', async () => {
    const { token, panelUrl } = await api.issue();
    api.restart();
    const sender = api.frameSender(panelUrl);
    const message = { type: PANEL_MESSAGE.tokenRedeem, payload: { token } };
    expect(parsePanelTokenRedeemReply(await api.send(message, sender))?.ok).toBe(true);
    api.restart();
    expect(await isRegisteredPanelFrame(sender)).toBe(true);
    expect(await api.send(message, sender)).toMatchObject({ ok: false });
  });

  it('close revokes pending tokens and the registered frame without affecting another tab', async () => {
    const pending = await api.issue();
    expect(await api.send({ type: PANEL_MESSAGE.close })).toEqual({ ok: true });
    expect(
      await api.send(
        { type: PANEL_MESSAGE.tokenRedeem, payload: { token: pending.token } },
        api.frameSender(pending.panelUrl),
      ),
    ).toMatchObject({ ok: false });
    const current = await api.redeem();
    const other = await api.issue(8);
    expect(
      await api.send({ type: PANEL_MESSAGE.close }, { ...api.topSender(), id: 'foreign' }),
    ).toMatchObject({ ok: false });
    expect(await isRegisteredPanelFrame(current.sender)).toBe(true);
    await api.send({ type: PANEL_MESSAGE.close });
    expect(await isRegisteredPanelFrame(current.sender)).toBe(false);
    expect(
      parsePanelTokenRedeemReply(
        await api.send(
          { type: PANEL_MESSAGE.tokenRedeem, payload: { token: other.token } },
          api.frameSender(other.panelUrl, 8),
        ),
      )?.ok,
    ).toBe(true);
  });

  it('unregisters on tab close or origin change and keeps SPA context changes', async () => {
    const current = await api.redeem();
    api.onUpdated.emit(7, { url: 'https://gemini.google.com/u/1/app/next' }, {} as chrome.tabs.Tab);
    await api.context({ ...CONTEXT, pageUrl: 'https://gemini.google.com/u/1/app/next' });
    expect(await isRegisteredPanelFrame(current.sender)).toBe(true);

    api.tabs.set(7, 'https://other.example/');
    api.onUpdated.emit(7, { url: 'https://other.example/' }, {} as chrome.tabs.Tab);
    await api.send({ type: PANEL_MESSAGE.close }, api.topSender(8));
    api.tabs.set(7, CONTEXT.pageUrl);
    expect(await isRegisteredPanelFrame(current.sender)).toBe(false);
    const second = await api.redeem();
    api.onRemoved.emit(7, { windowId: 1, isWindowClosing: false });
    await api.send({ type: PANEL_MESSAGE.close }, api.topSender(8));
    expect(await isRegisteredPanelFrame(second.sender)).toBe(false);
  });

  it('grants shared sync trust to the redeemed frame only, and only until it is revoked', async () => {
    const issued = await api.issue();
    const { isTrustedSharedDataSyncSender } = await import('../runtimeMessageRouting');
    // Any page can frame the panel page; before redemption it is just a web-framed page.
    expect(isTrustedSharedDataSyncSender(api.frameSender(issued.panelUrl))).toBe(false);
    const current = await api.redeem();
    expect(isTrustedSharedDataSyncSender(current.sender)).toBe(true);
    expect(isTrustedSharedDataSyncSender(api.frameSender(current.panelUrl, 7, 5))).toBe(false);
    api.onRemoved.emit(7, { windowId: 1, isWindowClosing: false });
    expect(isTrustedSharedDataSyncSender(current.sender)).toBe(false);
  });

  it('fails closed without session storage and never falls back to persistent local storage', async () => {
    vi.stubGlobal('chrome', { ...chrome, storage: { ...chrome.storage, session: undefined } });
    api.restart();
    expect(
      await api.send({ type: PANEL_MESSAGE.tokenIssue, payload: { context: CONTEXT } }),
    ).toMatchObject({ ok: false, error: 'session_unavailable' });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});

describe('panel capabilities through the registered background listener', () => {
  it('keeps close, context updates and other tabs responsive while a relay is awaiting its reply', async () => {
    const api = startPanelHarness();
    const { sender, session } = await api.redeem();
    let release!: () => void;
    let started!: () => void;
    const sent = new Promise<void>((resolve) => {
      started = resolve;
    });
    const reply = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.tabSend.mockImplementationOnce(async () => {
      started();
      await reply;
      return { ok: true, result: 'finished transfer' };
    });
    const transfer = api.send(
      {
        type: PANEL_MESSAGE.tabRequest,
        payload: { sessionId: session.sessionId, request: { action: 'sync_to_ide' } },
      },
      sender,
    );
    await sent;
    try {
      expect(await api.context({ ...CONTEXT, scheme: 'light' })).toEqual({ ok: true });
      expect(await api.send({ type: PANEL_MESSAGE.close })).toEqual({ ok: true });
      expect(await isRegisteredPanelFrame(sender)).toBe(false);
      expect((await api.issue(8)).ok).toBe(true);
    } finally {
      release();
      await transfer;
    }
  });

  it('relays each popup request to the registered tab top frame, dropping extra fields', async () => {
    const api = startPanelHarness();
    const { sender, session } = await api.redeem();
    const requests = [
      { type: 'gv.nativeHealth.status' },
      { type: 'gv.plugins.status' },
      { type: 'gv.folders.getStructureForAI' },
      { type: 'gv.folders.reload' },
      { type: 'gv.sync.requestData' },
      { type: 'gv.account.getContext' },
      { type: 'gv.chatgptExport.open' },
      { action: 'sync_to_ide' },
    ];
    for (const request of requests) {
      expect(
        await api.send(
          {
            type: PANEL_MESSAGE.tabRequest,
            payload: {
              sessionId: session.sessionId,
              request: { ...request, tabId: 8, payload: { unexpected: true } },
            },
          },
          sender,
        ),
      ).toEqual({ ok: true, response: { ok: true, result: 'from tab' } });
      expect(api.tabSend).toHaveBeenLastCalledWith(7, request, { frameId: 0 });
    }
    const calls = api.tabSend.mock.calls.length;
    for (const request of [
      { type: 'gv.sync.download' },
      { type: 'gv.openPopup' },
      { action: 'delete' },
    ]) {
      expect(
        await api.send(
          { type: PANEL_MESSAGE.tabRequest, payload: { sessionId: session.sessionId, request } },
          sender,
        ),
      ).toMatchObject({ ok: false });
    }
    expect(
      await api.send(
        {
          type: PANEL_MESSAGE.tabRequest,
          payload: { sessionId: session.sessionId, request: requests[0] },
        },
        { ...sender, frameId: 5 },
      ),
    ).toMatchObject({ ok: false });
    expect(
      await api.send(
        {
          type: PANEL_MESSAGE.tabRequest,
          payload: { sessionId: '0'.repeat(64), request: requests[0] },
        },
        sender,
      ),
    ).toMatchObject({ ok: false });
    expect(api.tabSend).toHaveBeenCalledTimes(calls);
  });

  it.each([false, true])(
    'opens site access in the popup, with options fallback=%s',
    async (fallback) => {
      const api = startPanelHarness();
      const { sender, session } = await api.redeem();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      if (fallback) api.openPopup.mockRejectedValue(new Error('No gesture'));
      const message = {
        type: PANEL_MESSAGE.siteAccessFallback,
        payload: { sessionId: session.sessionId },
      };
      expect(await api.send(message, { ...sender, frameId: 8 })).toMatchObject({ ok: false });
      expect(api.session.has(PANEL_POPUP_OPEN_CARD_KEY)).toBe(false);
      api.openPopup.mockImplementation(async () => {
        expect(api.session.get(PANEL_POPUP_OPEN_CARD_KEY)).toBe('site-access');
        if (fallback) throw new Error('No gesture');
      });
      expect(await api.send(message, sender)).toEqual(
        fallback ? { ok: true, fallback: 'options' } : { ok: true },
      );
      expect(api.openPopup).toHaveBeenCalledOnce();
      if (fallback)
        expect(chrome.tabs.create).toHaveBeenCalledWith({
          url: chrome.runtime.getURL('src/pages/options/index.html?sourceTabId=7'),
        });
      else expect(chrome.tabs.create).not.toHaveBeenCalled();
    },
  );
});
