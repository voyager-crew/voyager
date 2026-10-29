import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PANEL_MESSAGE,
  PANEL_PORT_MESSAGE,
  type PanelContext,
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

const UPDATED: PanelContext = {
  ...CONTEXT,
  pageUrl: 'https://gemini.google.com/u/2/app/next',
  accountSlot: '2',
  scheme: 'light',
  direction: 'rtl',
};

describe('authenticated panel context Ports', () => {
  it('sends context only to the registered frame of that tab and rejects spoofed updates', async () => {
    const api = startPanelHarness();
    const first = await api.redeem();
    const issued = await api.issue(8);
    const secondSender = api.frameSender(issued.panelUrl, 8);
    const redeemed = parsePanelTokenRedeemReply(
      await api.send(
        { type: PANEL_MESSAGE.tokenRedeem, payload: { token: issued.token } },
        secondSender,
      ),
    );
    if (!redeemed?.ok) throw new Error('No second panel session');

    const firstPort = api.connect(first.sender, first.session).port;
    const secondPort = api.connect(secondSender, redeemed.session).port;
    const wrongFrame = api.connect({ ...first.sender, frameId: 9 }, first.session).port;
    const wrongSession = api.connect(first.sender, {
      ...first.session,
      sessionId: redeemed.session.sessionId,
    }).port;
    await api.context(UPDATED);
    expect(firstPort.postMessage).toHaveBeenLastCalledWith({
      type: PANEL_PORT_MESSAGE.context,
      payload: { sessionId: first.session.sessionId, context: UPDATED },
    });
    expect(secondPort.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: PANEL_PORT_MESSAGE.context,
      payload: { sessionId: redeemed.session.sessionId, context: CONTEXT },
    });
    for (const port of [wrongFrame, wrongSession]) {
      expect(port.disconnect).toHaveBeenCalled();
      expect(port.postMessage).not.toHaveBeenCalled();
    }

    const calls = vi.mocked(firstPort.postMessage).mock.calls.length;
    expect(await api.context(CONTEXT, first.sender)).toMatchObject({ ok: false });
    expect(await api.context(CONTEXT, { ...api.topSender(), id: 'foreign' })).toMatchObject({
      ok: false,
    });
    expect(await api.context({ ...CONTEXT, pageUrl: 'https://evil.example/' })).toMatchObject({
      ok: false,
    });
    expect(firstPort.postMessage).toHaveBeenCalledTimes(calls);
  });

  it('replays the latest context after a worker restart without redeeming a consumed token', async () => {
    const api = startPanelHarness();
    const frame = await api.redeem();
    await api.context(UPDATED);
    api.restart();
    const { port } = api.connect(frame.sender, frame.session);
    await api.context(UPDATED);
    expect(port.postMessage).toHaveBeenCalledWith({
      type: PANEL_PORT_MESSAGE.context,
      payload: { sessionId: frame.session.sessionId, context: UPDATED },
    });
  });

  it('disconnects a closed panel and prevents a late authentication result from attaching', async () => {
    const api = startPanelHarness();
    const frame = await api.redeem();
    const open = api.connect(frame.sender, frame.session);
    await api.context(UPDATED);
    await api.send({ type: PANEL_MESSAGE.close });
    expect(open.port.disconnect).toHaveBeenCalled();
    const calls = vi.mocked(open.port.postMessage).mock.calls.length;
    await api.context(CONTEXT);
    expect(open.port.postMessage).toHaveBeenCalledTimes(calls);

    const next = await api.redeem();
    const read = api.area.get.getMockImplementation()!;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.area.get.mockImplementationOnce(async (key) => {
      await pending;
      return await read(key);
    });
    const late = api.connect(next.sender, next.session);
    late.onDisconnect.emit(late.port);
    release();
    await api.context(UPDATED);
    expect(late.port.postMessage).not.toHaveBeenCalled();
  });

  it('redeems with the latest seed when SPA context changes while the token is pending', async () => {
    const api = startPanelHarness();
    const { token, panelUrl } = await api.issue();
    await api.context(UPDATED);
    const redeemed = parsePanelTokenRedeemReply(
      await api.send(
        { type: PANEL_MESSAGE.tokenRedeem, payload: { token } },
        api.frameSender(panelUrl),
      ),
    );
    expect(redeemed).toMatchObject({ ok: true, session: { context: UPDATED } });
  });

  it('admits only one of two concurrent redemptions of the same token', async () => {
    const api = startPanelHarness();
    const { token, panelUrl } = await api.issue();
    const message = { type: PANEL_MESSAGE.tokenRedeem, payload: { token } };
    const replies = await Promise.all([
      api.send(message, api.frameSender(panelUrl, 7, 4)),
      api.send(message, api.frameSender(panelUrl, 7, 5)),
    ]);
    expect(replies.map((reply) => parsePanelTokenRedeemReply(reply)?.ok)).toEqual([true, false]);
  });
});
