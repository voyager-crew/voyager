// @vitest-environment jsdom
/**
 * The catalog send-time store as several tabs of one site use it: every write
 * is a read-modify-write of one chat's key, and pruning removes whole chats.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type MemoryStorage,
  createMemoryStorage,
} from '@/features/plugins/builtin/chatgptFolders/__tests__/memoryStorage';

import {
  conversationTimesKey,
  pruneSite,
  readConversationTimes,
  recordSendTime,
  sendTimeOf,
} from './sendTimesStore';

const SITE = 'chatgpt';
const CHAT = 'chatgpt:conv:one';
const AT = Date.UTC(2026, 9, 5, 12, 0, 0);

type LocalArea = Record<string, (...args: unknown[]) => Promise<unknown>>;

let storage: MemoryStorage;
let local: LocalArea;
let realGet: LocalArea['get'];

/** `navigator.locks` as one origin's tabs share it: a FIFO queue per lock name. */
function installWebLocks(): void {
  const tails = new Map<string, Promise<unknown>>();
  const request = (name: string, callback: () => Promise<unknown>) => {
    const run = (tails.get(name) ?? Promise.resolve()).then(() => callback());
    tails.set(
      name,
      run.catch(() => {}),
    );
    return run;
  };
  vi.stubGlobal('navigator', { ...navigator, locks: { request } });
}

const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A chat whose one send was `secondsAgo` before AT. */
function seedChat(conversationKey: string, secondsAgo: number): void {
  storage.values.local.set(conversationTimesKey(conversationKey), {
    v: 1,
    b: Math.floor(AT / 1000) - secondsAgo,
    k: ['seeded'],
    d: [0],
  });
}

function seedIndex(conversations: string[]): void {
  storage.values.local.set(`gvMessageTimestamps:${SITE}:index`, { v: 1, conversations });
}

beforeEach(() => {
  storage = createMemoryStorage();
  vi.stubGlobal('chrome', { ...chrome, storage: storage.api });
  local = storage.api.local as unknown as LocalArea;
  realGet = local.get;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each([
  ['with Web Locks', true],
  ['without Web Locks', false],
])('catalog send-time store %s', (_label, withLocks) => {
  beforeEach(() => {
    if (withLocks) installWebLocks();
    else vi.stubGlobal('navigator', { ...navigator, locks: undefined });
  });

  it('pruning never deletes a chat that just got a new send', async () => {
    seedChat('chatgpt:conv:old-0', 300);
    seedChat('chatgpt:conv:old-1', 200);
    seedChat('chatgpt:conv:old-2', 100);
    seedIndex(['chatgpt:conv:old-0', 'chatgpt:conv:old-1', 'chatgpt:conv:old-2']);
    // Pruning's batch read sees old-0 as the oldest chat, then stalls.
    let snapshotTaken = false;
    let resume!: () => void;
    const resumed = new Promise<void>((resolve) => (resume = resolve));
    local.get = async (keys: unknown, ...rest: unknown[]) => {
      const result = await realGet(keys, ...rest);
      if (Array.isArray(keys) && keys.length > 1 && !snapshotTaken) {
        snapshotTaken = true;
        await resumed;
      }
      return result;
    };

    const pruning = pruneSite(SITE, 2);
    await vi.waitFor(() => expect(snapshotTaken).toBe(true));
    // Another tab sends in old-0 meanwhile.
    const sending = recordSendTime(SITE, 'chatgpt:conv:old-0', 'turn-new', AT);
    await macrotask();
    resume();
    await Promise.all([pruning, sending]);

    const times = await readConversationTimes('chatgpt:conv:old-0');
    expect(sendTimeOf(times, 'turn-new')).toBe(AT);
  });

  describe("a failed read never wipes a chat's saved send times", () => {
    it('when stamping a send', async () => {
      await recordSendTime(SITE, CHAT, 'turn-a', AT);
      local.get = async () => {
        throw new Error('storage unavailable');
      };
      await recordSendTime(SITE, CHAT, 'turn-b', AT + 60_000);
      local.get = realGet;

      const times = await readConversationTimes(CHAT);
      expect(sendTimeOf(times, 'turn-a')).toBe(AT);
    });

    it('when pruning', async () => {
      seedChat('chatgpt:conv:old-0', 300);
      seedChat('chatgpt:conv:old-1', 200);
      seedChat('chatgpt:conv:old-2', 100);
      seedIndex(['chatgpt:conv:old-0', 'chatgpt:conv:old-1', 'chatgpt:conv:old-2']);
      local.get = async (keys: unknown, ...rest: unknown[]) => {
        if (Array.isArray(keys) && keys.length > 1) throw new Error('storage unavailable');
        return realGet(keys, ...rest);
      };

      await pruneSite(SITE, 2);

      for (const chat of ['old-0', 'old-1', 'old-2']) {
        expect(storage.values.local.has(conversationTimesKey(`chatgpt:conv:${chat}`))).toBe(true);
      }
    });
  });

  it('two turns whose keys share a 32-bit hash keep separate times', async () => {
    // These two keys collide under 32-bit FNV-1a.
    await recordSendTime(SITE, CHAT, '00000000-0000-4000-8000-00000004b9cc', AT);

    const times = await readConversationTimes(CHAT);
    expect(sendTimeOf(times, '00000000-0000-4000-8000-0000000b2b18')).toBeNull();
  });
});

describe('two tabs sending in the same chat keep both times', () => {
  it('when both read the chat before either writes', async () => {
    installWebLocks();
    // Each read resolves a beat late, so an unserialized second read sees no first write.
    local.get = async (keys: unknown, ...rest: unknown[]) => {
      const result = await realGet(keys, ...rest);
      await macrotask();
      return result;
    };

    await Promise.all([
      recordSendTime(SITE, CHAT, 'turn-a', AT),
      recordSendTime(SITE, CHAT, 'turn-b', AT + 60_000),
    ]);

    const times = await readConversationTimes(CHAT);
    expect(sendTimeOf(times, 'turn-a')).toBe(AT);
    expect(sendTimeOf(times, 'turn-b')).toBe(AT + 60_000);
  });
});
