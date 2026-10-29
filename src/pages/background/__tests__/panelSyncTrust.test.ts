import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PANEL_MESSAGE,
  type PanelContext,
  parsePanelTokenIssueReply,
  parsePanelTokenRedeemReply,
} from '@/features/panel/protocol';

import {
  SYNC_TEST_EXTENSION,
  SYNC_TEST_PROMPTS_FILE,
  createScopeSyncDevice,
  syncTestPrompt,
} from './cloudSyncScopeHarness';

const PAGE = 'https://gemini.google.com/u/1/app/example';
const CONTEXT: PanelContext = {
  pageUrl: PAGE,
  siteId: 'gemini',
  accountSlot: '1',
  scheme: 'light',
  direction: 'ltr',
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T00:00:00.000Z'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The real sync handler and the real panel background, sharing one browser and one Drive. */
async function panelDevice() {
  const device = await createScopeSyncDevice();
  const session = new Map<string, unknown>();
  const tabs = new Map([[7, PAGE]]);
  const listeners = () => ({ addListener: vi.fn(), removeListener: vi.fn() });
  vi.stubGlobal('chrome', {
    ...chrome,
    runtime: { ...chrome.runtime, onConnect: listeners() },
    storage: {
      ...chrome.storage,
      session: {
        get: async (key: string) => (session.has(key) ? { [key]: session.get(key) } : {}),
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items))
            session.set(key, structuredClone(value));
        },
        remove: async (key: string) => {
          session.delete(key);
        },
      },
    },
    tabs: {
      get: async (id: number) => ({ id, url: tabs.get(id) }),
      onRemoved: listeners(),
      onUpdated: listeners(),
    },
    permissions: { contains: async () => true },
  });
  const { createPanelBackground } = await import('../panelMessages');
  const panel = createPanelBackground();
  const shell: chrome.runtime.MessageSender = {
    id: SYNC_TEST_EXTENSION,
    frameId: 0,
    url: PAGE,
    tab: { id: 7, url: PAGE } as chrome.tabs.Tab,
  };
  const frame = (url: string, overrides: Partial<chrome.runtime.MessageSender> = {}) =>
    ({
      id: SYNC_TEST_EXTENSION,
      frameId: 4,
      documentId: 'panel-document',
      url,
      tab: { id: 7, url: PAGE } as chrome.tabs.Tab,
      ...overrides,
    }) satisfies chrome.runtime.MessageSender;
  async function redeem() {
    const issued = parsePanelTokenIssueReply(
      await panel.handle({ type: PANEL_MESSAGE.tokenIssue, payload: { context: CONTEXT } }, shell),
    );
    if (!issued?.ok) throw new Error('issue refused');
    const sender = frame(issued.panelUrl);
    const redeemed = parsePanelTokenRedeemReply(
      await panel.handle(
        { type: PANEL_MESSAGE.tokenRedeem, payload: { token: issued.token } },
        sender,
      ),
    );
    if (!redeemed?.ok) throw new Error('redeem refused');
    return { panelUrl: issued.panelUrl, sender };
  }
  return { ...device, panel, shell, frame, redeem };
}

describe('the sync sheet speaks to the background only from a redeemed panel frame', () => {
  it('refuses the panel page in a frame whose token was never redeemed', async () => {
    const d = await panelDevice();
    const panelUrl = `chrome-extension://${SYNC_TEST_EXTENSION}/src/pages/panel/index.html?token=${'b'.repeat(64)}`;

    await expect(
      d.request('gv.sync.getStatus', { rows: ['shared'] }, d.frame(panelUrl)),
    ).resolves.toEqual({ ok: false, error: 'untrusted_sender' });
    await expect(
      d.request('gv.sync.upload', { selection: 'shared' }, d.frame(panelUrl)),
    ).resolves.toEqual({ ok: false, error: 'untrusted_sender' });
    expect(() => d.drive.payload(SYNC_TEST_PROMPTS_FILE)).toThrow('No fake Drive file');
  });

  it('gives the redeemed frame extension-page scope until the shell closes it', async () => {
    const d = await panelDevice();
    const { sender } = await d.redeem();

    const status = await d.request('gv.sync.getStatus', { rows: ['shared', 'claude'] }, sender);
    expect(status).toMatchObject({
      ok: true,
      rows: [
        { row: 'shared', status: 'not_uploaded' },
        { row: 'claude', included: true },
      ],
    });
    // Shared data is beyond any page's folder button; the panel uploads it like the popup.
    await expect(
      d.request('gv.sync.upload', { selection: 'shared' }, sender),
    ).resolves.toMatchObject({ ok: true });
    expect(d.drive.payload(SYNC_TEST_PROMPTS_FILE)).toMatchObject({
      items: [syncTestPrompt('local')],
    });

    // Another frame of the same tab, or the same frame in a new document, is not the session.
    for (const other of [{ frameId: 5 }, { documentId: 'next-document' }]) {
      await expect(
        d.request('gv.sync.getStatus', { rows: ['shared'] }, d.frame(sender.url, other)),
      ).resolves.toEqual({ ok: false, error: 'untrusted_sender' });
    }

    await d.panel.handle({ type: PANEL_MESSAGE.close }, d.shell);
    await expect(d.request('gv.sync.getStatus', { rows: ['shared'] }, sender)).resolves.toEqual({
      ok: false,
      error: 'untrusted_sender',
    });
  });

  it('reads the page and account from the session tab, never from the panel URL', async () => {
    const d = await panelDevice();
    const { sender } = await d.redeem();
    const { getSenderPageUrl } = await import('../runtimeMessageRouting');

    expect(getSenderPageUrl(sender)).toBe(PAGE);
    // Firefox and Safari may leave the frame's tab URL out: the session still names the page.
    const withoutTabUrl = { ...sender, tab: { id: 7 } as chrome.tabs.Tab };
    expect(getSenderPageUrl(withoutTabUrl)).toBe(PAGE);
    await expect(
      d.request('gv.sync.getStatus', { rows: ['shared'] }, withoutTabUrl),
    ).resolves.toMatchObject({ ok: true });
  });
});
