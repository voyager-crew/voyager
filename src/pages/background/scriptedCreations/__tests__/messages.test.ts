import { describe, expect, it, vi } from 'vitest';

import { SCRIPTED_MESSAGE, parseScriptedMessage } from '@/features/plugins/scripted/messages';

import { type ScriptedMessageDeps, handleScriptedMessage } from '../messages';

const STATUS = {
  ok: true,
  availability: { kind: 'available' },
  stopped: false,
  plugins: [],
} as const;

function deps(): ScriptedMessageDeps {
  return {
    status: vi.fn(async () => STATUS),
    recheck: vi.fn(async () => STATUS),
    confirmLoad: vi.fn(async () => {}),
    clearNotice: vi.fn(async () => true),
    openDetails: vi.fn(async () => {}),
  };
}

const CONTENT: chrome.runtime.MessageSender = {
  id: 'test-extension-id',
  frameId: 0,
  tab: { id: 7, url: 'https://gemini.google.com/app' } as chrome.tabs.Tab,
  url: 'https://gemini.google.com/app',
};
const POPUP: chrome.runtime.MessageSender = {
  id: 'test-extension-id',
  url: 'chrome-extension://test-extension-id/src/pages/popup/index.html',
};

describe('parseScriptedMessage', () => {
  it('rejects malformed messages', () => {
    for (const value of [
      null,
      'gv.scripted.status',
      [],
      { type: 'gv.scripted.unknown' },
      { type: SCRIPTED_MESSAGE.clearNotice },
      { type: SCRIPTED_MESSAGE.clearNotice, payload: { id: 7 } },
      { type: SCRIPTED_MESSAGE.clearNotice, payload: { id: 'vendor.not-local' } },
      { type: SCRIPTED_MESSAGE.clearNotice, payload: 'local.me.counter' },
    ]) {
      expect(parseScriptedMessage(value)).toBeUndefined();
    }
  });

  it('keeps only the fields it knows', () => {
    expect(parseScriptedMessage({ type: SCRIPTED_MESSAGE.loaded, payload: { tabId: 99 } })).toEqual(
      { type: SCRIPTED_MESSAGE.loaded },
    );
    expect(
      parseScriptedMessage({
        type: SCRIPTED_MESSAGE.clearNotice,
        payload: { id: 'local.me.counter', extra: true },
      }),
    ).toEqual({ type: SCRIPTED_MESSAGE.clearNotice, payload: { id: 'local.me.counter' } });
  });
});

describe('handleScriptedMessage', () => {
  it('leaves other messages to the rest of the router', () => {
    expect(handleScriptedMessage({ type: 'gv.sync.getState' }, POPUP, deps())).toBeNull();
  });

  it('answers a malformed message of ours with invalid_payload', async () => {
    const handlers = deps();
    await expect(
      handleScriptedMessage({ type: SCRIPTED_MESSAGE.clearNotice, payload: {} }, POPUP, handlers),
    ).resolves.toEqual({ ok: false, error: 'invalid_payload' });
    expect(handlers.clearNotice).not.toHaveBeenCalled();
  });

  it('confirms a load for the sending tab, only from a top-frame content script', async () => {
    const handlers = deps();
    await expect(
      handleScriptedMessage({ type: SCRIPTED_MESSAGE.loaded }, CONTENT, handlers),
    ).resolves.toEqual({ ok: true });
    expect(handlers.confirmLoad).toHaveBeenCalledWith(7, 'https://gemini.google.com/app');

    for (const sender of [
      POPUP,
      { ...CONTENT, frameId: 3 },
      { ...CONTENT, id: 'other-extension' },
      { ...CONTENT, tab: undefined },
    ]) {
      await expect(
        handleScriptedMessage({ type: SCRIPTED_MESSAGE.loaded }, sender, handlers),
      ).resolves.toEqual({ ok: false, error: 'untrusted_sender' });
    }
    expect(handlers.confirmLoad).toHaveBeenCalledOnce();
  });

  it('serves status to the popup and our content script, not to a subframe', async () => {
    const handlers = deps();
    await expect(
      handleScriptedMessage({ type: SCRIPTED_MESSAGE.status }, POPUP, handlers),
    ).resolves.toEqual(STATUS);
    await expect(
      handleScriptedMessage({ type: SCRIPTED_MESSAGE.status }, CONTENT, handlers),
    ).resolves.toEqual(STATUS);
    await expect(
      handleScriptedMessage(
        { type: SCRIPTED_MESSAGE.recheck },
        { ...CONTENT, frameId: 2 },
        handlers,
      ),
    ).resolves.toEqual({ ok: false, error: 'untrusted_sender' });
    expect(handlers.recheck).not.toHaveBeenCalled();
  });
});
