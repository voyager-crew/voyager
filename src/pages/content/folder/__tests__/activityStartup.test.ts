// @vitest-environment-options { "url": "https://gemini.google.com/u/0/app/chat" }
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { GeminiConversationActivity } from '../gemini/activity';
import { showGeminiAccount } from './geminiAccountControl';

const state = vi.hoisted(() => ({
  starts: [] as Array<{ finish(): void; timestamp: number }>,
  subscribe: vi.fn(() => () => {}),
  historyReady: vi.fn<(signal?: AbortSignal) => Promise<boolean>>(),
}));
vi.mock('../../timestamp/TimestampService', () => ({
  TimestampService: class {
    private readonly timestamp = (state.starts.length + 1) * 100;
    initialize(): Promise<void> {
      return new Promise((finish) => {
        state.starts.push({ finish, timestamp: this.timestamp });
      });
    }
    getLatestTimestampForConversation(): number {
      return this.timestamp;
    }
  },
}));
vi.mock('../../timestamp/historyTimestampPageService', () => ({
  whenHistoryTimestampsReady: state.historyReady,
}));
vi.mock('../../timestamp/historyTimestamps', () => ({
  historyTimestampStore: { subscribe: state.subscribe, getLatestTurnTimestamp: () => null },
}));

let activity: GeminiConversationActivity;
const apply = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  state.historyReady.mockReset().mockResolvedValue(true);
  state.starts.length = 0;
  state.subscribe.mockClear();
  apply.mockReset();
  document.body.innerHTML = '';
  history.replaceState({}, '', '/u/0/app/chat');
  activity = new GeminiConversationActivity({
    data: () => ({ folders: [], folderContents: {} }),
    isActive: () => true,
    isConversationInFolders: () => true,
    apply,
  });
});
afterEach(() => {
  activity.stop();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

it('a retired initialization cannot replace the current timestamp service', async () => {
  const old = activity.start();
  activity.stop();
  const current = activity.start();
  state.starts[1].finish();
  await current;
  state.starts[0].finish();
  await old;
  await Promise.resolve();
  expect(activity.knownLastTurnAt('chat')).toBe(200);
  expect(state.subscribe).toHaveBeenCalledTimes(1);
});

it('a cancelled account load can start again for the new account', async () => {
  showGeminiAccount('a@example.com');
  const old = activity.start();
  showGeminiAccount('b@example.com');
  await vi.advanceTimersByTimeAsync(1200);
  await Promise.resolve();
  await old;
  const current = activity.start();
  state.starts[1].finish();
  await current;
  state.starts[0].finish();
  await Promise.resolve();
  expect(state.subscribe).toHaveBeenCalledTimes(1);
  expect(activity.knownLastTurnAt('chat')).toBe(200);
  expect(apply).toHaveBeenCalledTimes(1);
});

it('activity resumes after an account switch without toggling the folder view', async () => {
  showGeminiAccount('a@example.com');
  document.body.insertAdjacentHTML(
    'beforeend',
    '<form><div role="textbox" contenteditable="true">new message</div><button type="button" aria-label="Send">Send</button></form>',
  );
  const old = activity.start();
  showGeminiAccount('b@example.com');
  await vi.advanceTimersByTimeAsync(1200);
  await old;
  state.starts[1].finish();
  for (let i = 0; i < 15; i++) await Promise.resolve();
  apply.mockClear();
  document.querySelector('button')!.click();
  await vi.advanceTimersByTimeAsync(1);
  expect(apply).toHaveBeenCalledWith([{ conversationId: 'chat', lastTurnAt: expect.any(Number) }]);
  state.starts[0].finish();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(state.subscribe).toHaveBeenCalledTimes(1);
  expect(activity.knownLastTurnAt('chat')).toBe(200);
});

it('a cancelled history wait keeps prepared timestamps available for the next start', async () => {
  state.historyReady.mockImplementationOnce(() => new Promise(() => {}));
  const old = activity.start();
  state.starts[0].finish();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  activity.stop();
  await old;
  expect(activity.knownLastTurnAt('chat')).toBe(100);
  const current = activity.start();
  expect(state.starts).toHaveLength(1);
  await current;
  expect(activity.knownLastTurnAt('chat')).toBe(100);
  expect(state.subscribe).toHaveBeenCalledTimes(1);
});

it('stopping activity releases its pending history wait before the page store finishes', async () => {
  const released = vi.fn();
  state.historyReady.mockImplementationOnce(
    (signal) =>
      new Promise((resolve) => {
        signal?.addEventListener(
          'abort',
          () => {
            released();
            resolve(false);
          },
          { once: true },
        );
      }),
  );
  const old = activity.start();
  state.starts[0].finish();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  activity.stop();
  await old;
  expect(released).toHaveBeenCalledTimes(1);
  const current = activity.start();
  if (state.starts.length > 1) state.starts[1].finish();
  await current;
  expect(state.subscribe).toHaveBeenCalledTimes(1);
  expect(activity.knownLastTurnAt('chat')).toBeGreaterThan(0);
});
