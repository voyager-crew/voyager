import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PANEL_MESSAGE,
  parsePanelTokenIssueReply,
  parsePanelTokenRedeemReply,
} from '@/features/panel/protocol';

import { CONTEXT, startPanelHarness } from './panelHarness';

vi.mock('webextension-polyfill', () => ({
  default: new Proxy({}, { get: (_target, key) => Reflect.get(chrome, key) }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openPanel(api: ReturnType<typeof startPanelHarness>, documentId?: string) {
  const issue = parsePanelTokenIssueReply(
    await api.send(
      {
        type: PANEL_MESSAGE.tokenIssue,
        payload: { context: CONTEXT },
      },
      { ...api.topSender(), documentId },
    ),
  );
  if (!issue?.ok) throw new Error('Token not issued');
  const sender = api.frameSender(issue.panelUrl);
  const redeem = parsePanelTokenRedeemReply(
    await api.send(
      {
        type: PANEL_MESSAGE.tokenRedeem,
        payload: { token: issue.token },
      },
      sender,
    ),
  );
  if (!redeem?.ok) throw new Error('Token not redeemed');
  return {
    sender,
    request: {
      type: PANEL_MESSAGE.tabRequest,
      payload: { sessionId: redeem.session.sessionId, request: { type: 'gv.folders.reload' } },
    },
  };
}

function pauseNextWrite(api: ReturnType<typeof startPanelHarness>) {
  const write = api.area.set.getMockImplementation()!;
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  api.area.set.mockImplementationOnce(async (items) => {
    entered();
    await paused;
    await write(items);
  });
  return { started, release };
}

describe('panel relay document binding and origin fallback', () => {
  it('addresses the host document captured from the top frame, including after a worker restart', async () => {
    const api = startPanelHarness();
    const panel = await openPanel(api, 'host-document-gemini');
    api.restart();
    expect(await api.send(panel.request, panel.sender)).toMatchObject({ ok: true });
    expect(api.tabSend).toHaveBeenCalledExactlyOnceWith(
      7,
      { type: 'gv.folders.reload' },
      {
        frameId: 0,
        documentId: 'host-document-gemini',
      },
    );
  });

  it.each([undefined, 'host-document-gemini'])(
    'refuses a relay when navigation races the authentication write (host document: %s)',
    async (documentId) => {
      const api = startPanelHarness();
      const panel = await openPanel(api, documentId);
      const write = pauseNextWrite(api);
      const relay = api.send(panel.request, panel.sender);
      await write.started;
      api.tabs.set(7, 'https://chatgpt.com/');
      api.onUpdated.emit(7, { url: 'https://chatgpt.com/' }, {} as chrome.tabs.Tab);
      write.release();
      expect(await relay).toMatchObject({ ok: false });
      expect(api.tabSend).not.toHaveBeenCalled();
    },
  );

  it('rechecks the current origin without relying on a navigation event on browsers without document ids', async () => {
    const api = startPanelHarness();
    const panel = await openPanel(api);
    const write = pauseNextWrite(api);
    const relay = api.send(panel.request, panel.sender);
    await write.started;
    api.tabs.set(7, 'https://chatgpt.com/');
    write.release();
    expect(await relay).toMatchObject({ ok: false });
    expect(api.tabSend).not.toHaveBeenCalled();
  });

  it.each([undefined, 'host-document-gemini'])(
    'discards a late reply after revocation (host document: %s)',
    async (documentId) => {
      const api = startPanelHarness();
      const panel = await openPanel(api, documentId);
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const paused = new Promise<void>((resolve) => {
        release = resolve;
      });
      api.tabSend.mockImplementationOnce(async () => {
        entered();
        await paused;
        return { ok: true, result: 'old document' };
      });
      let result: unknown;
      const relay = api.send(panel.request, panel.sender).then((reply) => {
        result = reply;
      });
      await started;
      try {
        api.tabs.set(7, 'https://chatgpt.com/');
        api.onUpdated.emit(7, { url: 'https://chatgpt.com/' }, {} as chrome.tabs.Tab);
        await api.send({ type: PANEL_MESSAGE.close });
        expect(result).toMatchObject({ ok: false });
      } finally {
        release();
        await relay;
      }
      expect(result).toMatchObject({ ok: false });
    },
  );

  it('revokes on a same-origin document reload while allowing same-document SPA navigation', async () => {
    const api = startPanelHarness();
    const panel = await openPanel(api);
    api.tabs.set(7, 'https://gemini.google.com/u/1/app/next');
    api.onUpdated.emit(7, { url: api.tabs.get(7) }, {} as chrome.tabs.Tab);
    expect(await api.send(panel.request, panel.sender)).toMatchObject({ ok: true });
    api.tabSend.mockClear();
    const write = pauseNextWrite(api);
    const relay = api.send(panel.request, panel.sender);
    await write.started;
    api.onUpdated.emit(7, { status: 'loading' }, {} as chrome.tabs.Tab);
    write.release();
    expect(await relay).toMatchObject({ ok: false });
    expect(api.tabSend).not.toHaveBeenCalled();
  });

  it('lets close retire a relay waiting for its final tab lookup', async () => {
    const api = startPanelHarness();
    const panel = await openPanel(api);
    const write = pauseNextWrite(api);
    const relay = api.send(panel.request, panel.sender);
    await write.started;
    const readTab = api.tabGet.getMockImplementation()!;
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.tabGet.mockImplementationOnce(async (id) => {
      entered();
      await paused;
      return await readTab(id);
    });
    write.release();
    await started;
    try {
      await api.send({ type: PANEL_MESSAGE.close });
      expect(await relay).toMatchObject({ ok: false });
      expect(api.tabSend).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });

  it('answers with a refusal when the browser throws synchronously during send', async () => {
    const api = startPanelHarness();
    const panel = await openPanel(api);
    api.tabSend.mockImplementationOnce(() => {
      throw new Error('Document is gone');
    });
    expect(await api.send(panel.request, panel.sender)).toMatchObject({ ok: false });
  });
});
