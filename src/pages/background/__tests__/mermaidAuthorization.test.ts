import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MERMAID_TOKEN_MESSAGE,
  MERMAID_TOKEN_TTL_MS,
  parseMermaidTokenIssueReply,
  parseMermaidTokenRedeemReply,
} from '@/pages/mermaidRenderer/authorization';
import { MERMAID_RENDERER_PATH } from '@/pages/mermaidRenderer/protocol';

import { isTrustedExtensionPageSender } from '../runtimeMessageRouting';
import { startPanelHarness } from './panelHarness';

vi.mock('webextension-polyfill', () => ({
  default: new Proxy({}, { get: (_target, key) => Reflect.get(chrome, key) }),
}));

const REQUEST_ID = 'mermaid-test-request';
const ISSUE = { type: MERMAID_TOKEN_MESSAGE.issue, requestId: REQUEST_ID };
let api: ReturnType<typeof startPanelHarness>;

beforeEach(() => {
  vi.useFakeTimers();
  api = startPanelHarness();
});

afterEach(async () => {
  api.onRemoved.emit(7, { windowId: 1, isWindowClosing: false });
  api.onRemoved.emit(8, { windowId: 1, isWindowClosing: false });
  // Restart tests replace the harness's event listeners; expire that old worker's timers too.
  await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const rendererUrl = () => chrome.runtime.getURL(MERMAID_RENDERER_PATH);
const frame = (tabId = 7, frameId = 4) => api.frameSender(rendererUrl(), tabId, frameId);
const redeem = (token: unknown, sender = frame()) =>
  api.send({ type: MERMAID_TOKEN_MESSAGE.redeem, token }, sender);

async function issue(sender = api.topSender()) {
  const reply = parseMermaidTokenIssueReply(await api.send(ISSUE, sender));
  if (!reply?.ok) throw new Error('Token issue was refused');
  return reply.token;
}

describe('Mermaid authority through the registered background listener', () => {
  it('binds a private one-use token to its request and tab without granting other privileges', async () => {
    const token = await issue();
    const sender = frame();
    expect(rendererUrl()).not.toContain(token);
    expect(await redeem(token, sender)).toEqual({ ok: true, requestId: REQUEST_ID });
    expect(await redeem(token, frame(7, 5))).toEqual({ ok: false });
    // Rendering never registers this frame as a panel or trusted general extension page.
    expect(isTrustedExtensionPageSender(sender)).toBe(false);
  });

  it.each(['wrong tab', 'top frame', 'missing frame', 'foreign extension', 'wrong page', 'hash'])(
    'refuses %s redemption without consuming the legitimate token',
    async (reason) => {
      const token = await issue();
      const sender = frame();
      if (reason === 'wrong tab') sender.tab = frame(8).tab;
      if (reason === 'top frame') sender.frameId = 0;
      if (reason === 'missing frame') sender.frameId = undefined;
      if (reason === 'foreign extension') sender.id = 'another-extension';
      if (reason === 'wrong page') sender.url = chrome.runtime.getURL('src/pages/panel/index.html');
      if (reason === 'hash') sender.url = `${rendererUrl()}#${token}`;
      expect(await redeem(token, sender)).toEqual({ ok: false });
      expect(await redeem(token)).toEqual({ ok: true, requestId: REQUEST_ID });
    },
  );

  it('cannot redeem an arbitrary nonce a host puts in an iframe hash', async () => {
    const nonce = 'a'.repeat(64);
    expect(await redeem(nonce, api.frameSender(`${rendererUrl()}#${nonce}`))).toEqual({
      ok: false,
    });
    expect(await redeem(nonce)).toEqual({ ok: false });
  });

  it.each(['subframe', 'missing frame', 'foreign extension', 'extension page', 'credentials'])(
    'does not issue a token to a %s',
    async (reason) => {
      const sender = api.topSender();
      if (reason === 'subframe') sender.frameId = 3;
      if (reason === 'missing frame') sender.frameId = undefined;
      if (reason === 'foreign extension') sender.id = 'another-extension';
      if (reason === 'extension page') sender.url = rendererUrl();
      if (reason === 'credentials') sender.url = 'https://user:secret@gemini.google.com/app';
      expect(await api.send(ISSUE, sender)).toEqual({ ok: false });
    },
  );

  it('refuses forged host URLs and sites without an existing host permission', async () => {
    expect(
      await api.send(ISSUE, { ...api.topSender(), url: 'https://gemini.google.com.evil.test/app' }),
    ).toEqual({ ok: false });
    const forged = api.topSender(7, 'https://evil.test/app');
    expect(await api.send(ISSUE, forged)).toEqual({ ok: false });
    api.tabs.set(7, 'https://evil.test/app');
    api.contains.mockResolvedValue(false);
    expect(await api.send(ISSUE, forged)).toEqual({ ok: false });
  });

  it.each(['https://custom.example/diagram', 'http://custom.example/diagram'])(
    'allows an already-authorized custom site: %s',
    async (pageUrl) => {
      api.tabs.set(7, pageUrl);
      const token = await issue(api.topSender());
      expect(await redeem(token)).toEqual({ ok: true, requestId: REQUEST_ID });
    },
  );

  it('supports browsers omitting tab URL while still inspecting the live page', async () => {
    const sender = api.topSender();
    delete sender.tab!.url;
    const token = await issue(sender);
    const child = frame();
    delete child.tab!.url;
    expect(await redeem(token, child)).toEqual({ ok: true, requestId: REQUEST_ID });
  });

  it('claims a token before delayed browser checks so concurrent redemptions cannot replay it', async () => {
    const token = await issue();
    let release!: (allowed: boolean) => void;
    api.contains.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (release = resolve)),
    );
    const first = redeem(token);
    expect(await redeem(token, frame(7, 5))).toEqual({ ok: false });
    release(true);
    expect(await first).toEqual({ ok: true, requestId: REQUEST_ID });
    expect(await redeem(token)).toEqual({ ok: false });
  });

  it('refuses expiry, including a token expiring while permission inspection is pending', async () => {
    const token = await issue();
    vi.setSystemTime(Date.now() + MERMAID_TOKEN_TTL_MS);
    expect(await redeem(token)).toEqual({ ok: false });
    const next = await issue();
    api.contains.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + MERMAID_TOKEN_TTL_MS);
      return true;
    });
    expect(await redeem(next)).toEqual({ ok: false });
  });

  it.each(['loading', 'route change', 'tab close'])(
    'revokes pending redemptions on %s, including late successful browser replies',
    async (cause) => {
      const token = await issue();
      let release!: (allowed: boolean) => void;
      api.contains.mockImplementationOnce(
        () => new Promise<boolean>((resolve) => (release = resolve)),
      );
      const pending = redeem(token);
      if (cause === 'loading') api.onUpdated.emit(7, { status: 'loading' }, {} as chrome.tabs.Tab);
      if (cause === 'route change')
        api.onUpdated.emit(
          7,
          { url: 'https://gemini.google.com/u/2/app/other' },
          {} as chrome.tabs.Tab,
        );
      if (cause === 'tab close') api.onRemoved.emit(7, { windowId: 1, isWindowClosing: false });
      expect(await pending).toEqual({ ok: false });
      release(true);
      expect(await redeem(token)).toEqual({ ok: false });
    },
  );

  it('cannot publish an issuance after its source document starts navigating', async () => {
    let release!: (allowed: boolean) => void;
    api.contains.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (release = resolve)),
    );
    const pending = api.send(ISSUE);
    api.onUpdated.emit(7, { status: 'loading' }, {} as chrome.tabs.Tab);
    expect(await pending).toEqual({ ok: false });
    release(true);
    const token = await issue();
    expect(await redeem(token)).toEqual({ ok: true, requestId: REQUEST_ID });
  });

  it('rechecks the account URL and permission at redemption without relying on a tab event', async () => {
    const token = await issue();
    api.tabs.set(7, 'https://gemini.google.com/u/2/app/other');
    expect(await redeem(token)).toEqual({ ok: false });
    api.tabs.set(7, 'https://gemini.google.com/u/1/app/example');
    const next = await issue();
    api.contains.mockResolvedValue(false);
    expect(await redeem(next)).toEqual({ ok: false });
  });

  it('fails closed after a background restart and keeps other tabs independent', async () => {
    const token = await issue();
    const other = await issue(api.topSender(8));
    api.onRemoved.emit(7, { windowId: 1, isWindowClosing: false });
    expect(await redeem(token)).toEqual({ ok: false });
    expect(await redeem(other, frame(8))).toEqual({ ok: true, requestId: REQUEST_ID });
    const beforeRestart = await issue();
    api.restart();
    expect(await redeem(beforeRestart)).toEqual({ ok: false });
  });

  it('refuses malformed requests and authorization replies at the runtime boundary', async () => {
    expect(await api.send({ ...ISSUE, requestId: '<svg onload=alert(1)>' })).toEqual({ ok: false });
    expect(await redeem({ token: 'a'.repeat(64) })).toEqual({ ok: false });
    expect(parseMermaidTokenIssueReply({ ok: true, token: 'guess' })).toBeNull();
    expect(parseMermaidTokenRedeemReply({ ok: true, requestId: 42 })).toBeNull();
    expect(parseMermaidTokenIssueReply({ ok: false })).toEqual({ ok: false });
  });
});
