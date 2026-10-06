/**
 * The background as the single writer of catalog send times: several tabs of a
 * site send at once, and every write and prune reads storage afresh.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type MemoryStorage,
  createMemoryStorage,
} from '@/features/plugins/builtin/chatgptFolders/__tests__/memoryStorage';
import { parseSiteConversation } from '@/features/plugins/sites/siteConversation';
import {
  SEND_TIME_RECORD_MESSAGE,
  type SendTimeRecordRequest,
} from '@/features/timeline/adapters/catalog/sendTimesMessages';
import {
  conversationTimesKey,
  readConversationTimes,
  sendTimeOf,
} from '@/features/timeline/adapters/catalog/sendTimesStore';

import { createSendTimeMessageHandler } from '../sendTimeMessages';

const AT = Date.UTC(2026, 9, 5, 12, 0, 0);
const CHAT = 'chatgpt:conv:one';

type LocalArea = Record<string, (...args: unknown[]) => Promise<unknown>>;

let storage: MemoryStorage;
let local: LocalArea;
let realGet: LocalArea['get'];
let background: ReturnType<typeof createSendTimeMessageHandler>;

/** A top-frame content script of ours on `url`. */
function tabOn(url: string): chrome.runtime.MessageSender {
  return { id: chrome.runtime.id, tab: { url } as chrome.tabs.Tab, frameId: 0, url };
}

function sendFrom(
  sender: chrome.runtime.MessageSender,
  payload: Partial<SendTimeRecordRequest>,
): Promise<unknown> {
  const request = { site: 'chatgpt', conversationId: 'one', turnKey: 'turn-a', sentAt: AT };
  return background(
    { type: SEND_TIME_RECORD_MESSAGE, payload: { ...request, ...payload } },
    sender,
  )!;
}

const chatgptTab = (): chrome.runtime.MessageSender => tabOn('https://chatgpt.com/c/one');
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

/** Three listed ChatGPT chats, old-0 the oldest. */
function seedThreeOldChats(): void {
  seedChat('chatgpt:conv:old-0', 300);
  seedChat('chatgpt:conv:old-1', 200);
  seedChat('chatgpt:conv:old-2', 100);
  storage.values.local.set('gvMessageTimestamps:chatgpt:index', {
    v: 1,
    conversations: ['chatgpt:conv:old-0', 'chatgpt:conv:old-1', 'chatgpt:conv:old-2'],
  });
}

beforeEach(() => {
  storage = createMemoryStorage();
  vi.stubGlobal('chrome', { ...chrome, storage: storage.api });
  local = storage.api.local as unknown as LocalArea;
  realGet = local.get;
  // A cap of 2 prunes one of three listed chats.
  background = createSendTimeMessageHandler({ cap: () => 2 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('catalog send times in the background', () => {
  it('two tabs sending in the same chat keep both times', async () => {
    // Each read resolves a beat late, so an unserialized second read sees no first write.
    local.get = async (keys: unknown, ...rest: unknown[]) => {
      const result = await realGet(keys, ...rest);
      await macrotask();
      return result;
    };

    await Promise.all([
      sendFrom(chatgptTab(), { turnKey: 'turn-a', sentAt: AT }),
      sendFrom(chatgptTab(), { turnKey: 'turn-b', sentAt: AT + 60_000 }),
    ]);

    const times = await readConversationTimes(CHAT);
    expect(sendTimeOf(times, 'turn-a')).toBe(AT);
    expect(sendTimeOf(times, 'turn-b')).toBe(AT + 60_000);
  });

  it('pruning never deletes a chat that just got a new send', async () => {
    seedThreeOldChats();
    // The first send of this worker prunes; its batch read sees old-0 as oldest, then stalls.
    let snapshotTaken = false;
    let resume!: () => void;
    const resumed = new Promise<void>((resolve) => (resume = resolve));
    local.get = async (keys: unknown, ...rest: unknown[]) => {
      const result = await realGet(keys, ...rest);
      if (Array.isArray(keys) && keys.length > 2 && !snapshotTaken) {
        snapshotTaken = true;
        await resumed;
      }
      return result;
    };

    const first = sendFrom(chatgptTab(), { conversationId: 'new', turnKey: 'turn-x' });
    await vi.waitFor(() => expect(snapshotTaken).toBe(true));
    // Another tab sends in old-0 meanwhile.
    const second = sendFrom(tabOn('https://chatgpt.com/c/old-0'), {
      conversationId: 'old-0',
      turnKey: 'turn-new',
    });
    await macrotask();
    resume();
    await Promise.all([first, second]);

    const times = await readConversationTimes('chatgpt:conv:old-0');
    expect(sendTimeOf(times, 'turn-new')).toBe(AT);
  });

  describe("a failed read never wipes a chat's saved send times", () => {
    it('when stamping a send', async () => {
      await sendFrom(chatgptTab(), { turnKey: 'turn-a', sentAt: AT });
      local.get = async () => {
        throw new Error('storage unavailable');
      };
      const response = await sendFrom(chatgptTab(), { turnKey: 'turn-b', sentAt: AT + 60_000 });
      local.get = realGet;

      expect(response).toMatchObject({ ok: false });
      const times = await readConversationTimes(CHAT);
      expect(sendTimeOf(times, 'turn-a')).toBe(AT);
    });

    it('when pruning', async () => {
      seedThreeOldChats();
      local.get = async (keys: unknown, ...rest: unknown[]) => {
        if (Array.isArray(keys) && keys.length > 2) throw new Error('storage unavailable');
        return realGet(keys, ...rest);
      };

      await sendFrom(chatgptTab(), { conversationId: 'new', turnKey: 'turn-x' });

      for (const chat of ['old-0', 'old-1', 'old-2']) {
        expect(storage.values.local.has(conversationTimesKey(`chatgpt:conv:${chat}`))).toBe(true);
      }
    });
  });

  it("a ChatGPT page cannot write Claude's send times", async () => {
    const request = { site: 'claude', conversationId: 'abc', turnKey: 'turn-a' };

    const fromChatgpt = await sendFrom(chatgptTab(), request);
    expect(fromChatgpt).toEqual({ ok: false, error: 'untrusted_sender' });
    expect(storage.values.local.has(conversationTimesKey('claude:conv:abc'))).toBe(false);

    // Claude's own page may.
    const fromClaude = await sendFrom(tabOn('https://claude.ai/chat/abc'), request);
    expect(fromClaude).toMatchObject({ ok: true });
  });

  it('a site whose ids contain a slash still records send times', async () => {
    // A site override may capture the route's prefix along with the id.
    const url = 'https://chatgpt.com/c/abc123';
    const conversation = parseSiteConversation(
      { siteId: 'chatgpt', conversationIdPattern: '^/(c/[^/?#]+)' },
      url,
    )!;

    const response = await sendFrom(tabOn(url), { conversationId: conversation.id });

    expect(response).toMatchObject({ ok: true });
    expect(sendTimeOf(await readConversationTimes(conversation.key), 'turn-a')).toBe(AT);
  });

  it('two turns whose keys share a 32-bit hash keep separate times', async () => {
    // These two keys collide under 32-bit FNV-1a.
    await sendFrom(chatgptTab(), { turnKey: '00000000-0000-4000-8000-00000004b9cc' });

    const times = await readConversationTimes(CHAT);
    expect(sendTimeOf(times, '00000000-0000-4000-8000-0000000b2b18')).toBeNull();
  });
});
