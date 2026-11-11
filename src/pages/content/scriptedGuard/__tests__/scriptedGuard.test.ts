// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/c/abc" }
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SCRIPTED_LOADED_DELAY_MS,
  SCRIPTED_MESSAGE,
  SCRIPTED_RELOAD_PAGE_REQUEST,
  type ScriptedMessage,
} from '@/features/plugins/scripted/messages';
import { EMPTY_SCRIPTED_STATE } from '@/features/plugins/scripted/parseState';
import type { ScriptedStateV1 } from '@/features/plugins/scripted/types';

import { startScriptedPageGuard } from '../index';

const toasts = vi.hoisted(() => ({ shown: [] as { message: string; tone?: string }[] }));
vi.mock('@/core/ui/toast/toaster', () => ({
  createToaster: () => ({
    show: (input: { message: string; tone?: string }) => {
      toasts.shown.push(input);
      return { isOpen: true, update() {}, dismiss() {} };
    },
    dismiss() {},
    setAnchor() {},
    clear() {},
    destroy() {},
  }),
}));
vi.mock('@/utils/i18n', () => ({
  getTranslationSync: (key: string) =>
    key === 'scriptedCrashOne' ? 'turned off {name}' : 'turned off {names}',
}));

const notice = (url: string, at: number, withIds: string[]) => ({ at, url, withIds });

function stateWith(crashNotices: ScriptedStateV1['crashNotices']): ScriptedStateV1 {
  return { ...EMPTY_SCRIPTED_STATE, crashNotices };
}

const RECORDS = {
  'local.me.counter': { manifest: { name: 'Send counter' }, importedAt: 1, updatedAt: 1 },
  'local.me.clock': { manifest: { name: 'Clock' }, importedAt: 1, updatedAt: 1 },
};

let send: Mock<(message: ScriptedMessage) => Promise<unknown>>;
let stop: (() => void) | null = null;

function start(state: ScriptedStateV1 = EMPTY_SCRIPTED_STATE, reload = vi.fn()) {
  stop = startScriptedPageGuard({
    send,
    reload,
    readState: async () => state,
    readRecords: async () => RECORDS,
  });
  return reload;
}

const sentTypes = () => send.mock.calls.map(([message]) => (message as { type: string }).type);

beforeEach(() => {
  vi.useFakeTimers();
  toasts.shown = [];
  send = vi.fn(async (_message: ScriptedMessage) => ({ ok: true }));
  Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
});

describe('the page side of the crash guard', () => {
  it('confirms the load only once the delay has passed on a free main thread', async () => {
    start();
    await vi.advanceTimersByTimeAsync(SCRIPTED_LOADED_DELAY_MS - 1);
    expect(sentTypes()).not.toContain(SCRIPTED_MESSAGE.loaded);
    await vi.advanceTimersByTimeAsync(1);
    expect(sentTypes()).toEqual([SCRIPTED_MESSAGE.loaded]);
  });

  it('waits for the document to complete before the delay starts', async () => {
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'interactive' });
    start();
    await vi.advanceTimersByTimeAsync(SCRIPTED_LOADED_DELAY_MS * 2);
    expect(sentTypes()).toEqual([]);
    window.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(SCRIPTED_LOADED_DELAY_MS);
    expect(sentTypes()).toEqual([SCRIPTED_MESSAGE.loaded]);
  });

  it('never confirms after it was torn down', async () => {
    start();
    await vi.advanceTimersByTimeAsync(SCRIPTED_LOADED_DELAY_MS / 2);
    stop?.();
    stop = null;
    await vi.advanceTimersByTimeAsync(SCRIPTED_LOADED_DELAY_MS * 2);
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.advanceTimersByTimeAsync(SCRIPTED_LOADED_DELAY_MS * 2);
    expect(sentTypes()).toEqual([]);
  });

  it('confirms again after an in-app navigation', async () => {
    start();
    await vi.advanceTimersByTimeAsync(SCRIPTED_LOADED_DELAY_MS);
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.advanceTimersByTimeAsync(SCRIPTED_LOADED_DELAY_MS);
    expect(sentTypes()).toEqual([SCRIPTED_MESSAGE.loaded, SCRIPTED_MESSAGE.loaded]);
  });

  it('names the creation turned off on this site once, then clears its notice', async () => {
    start(
      stateWith({
        'local.me.counter': notice('https://chatgpt.com/c/old', 5, ['local.me.counter']),
        'local.me.clock': notice('https://claude.ai/new', 6, ['local.me.clock']),
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(toasts.shown).toEqual([
      expect.objectContaining({ message: 'turned off Send counter', tone: 'warning' }),
    ]);
    expect(send).toHaveBeenCalledWith({
      type: SCRIPTED_MESSAGE.clearNotice,
      payload: { id: 'local.me.counter' },
    });
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ payload: { id: 'local.me.clock' } }),
    );
  });

  it('names every creation a freeze turned off when there were several', async () => {
    start(
      stateWith({
        'local.me.clock': notice('https://chatgpt.com/', 7, ['local.me.counter', 'local.me.clock']),
        'local.me.counter': notice('https://chatgpt.com/', 7, [
          'local.me.counter',
          'local.me.clock',
        ]),
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(toasts.shown).toHaveLength(1);
    expect(toasts.shown[0].message).toContain('“Clock”');
    expect(toasts.shown[0].message).toContain('“Send counter”');
  });

  it('shows nothing when no notice belongs to this site', async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(toasts.shown).toEqual([]);
    expect(sentTypes()).not.toContain(SCRIPTED_MESSAGE.clearNotice);
  });

  it('reloads only on the relayed request for the user’s click', async () => {
    const reload = start();
    const listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls.at(-1)?.[0];
    const reply = vi.fn();
    listener?.({ type: 'gv.create.pending' }, {}, reply);
    expect(reload).not.toHaveBeenCalled();
    listener?.({ type: SCRIPTED_RELOAD_PAGE_REQUEST }, {}, reply);
    expect(reply).toHaveBeenCalledWith({ ok: true });
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
