// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/" }
/**
 * Message times on a catalog timeline (ChatGPT's bundled site.json), with the
 * "message timestamps" setting on: a message the user sends is stamped, and
 * turns ChatGPT mounts from history are not, however late they appear.
 */
import './testSetup';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import {
  type MemoryStorage,
  createMemoryStorage,
} from '@/features/plugins/builtin/chatgptFolders/__tests__/memoryStorage';
import { requireBundledSiteAdapter } from '@/features/plugins/catalog/sites';
import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { turnNavigatorPrimitive } from '@/features/plugins/verbs/turnNavigator';
import { TimestampService } from '@/pages/content/timestamp/TimestampService';

vi.mock('@/utils/i18n', () => ({
  initI18n: vi.fn().mockResolvedValue(undefined),
  getTranslationSync: (key: string) => key,
}));
vi.mock('@/features/timeline/timelineStyleCoachmark', () => ({
  showTimelineStyleCoachmark: vi.fn().mockResolvedValue(undefined),
}));

const SENT_AT = new Date(2026, 9, 5, 12, 34, 56).getTime();
const SENT_LABEL = new TimestampService().formatAbsoluteTime(SENT_AT);

let storage: MemoryStorage;
let scope: PluginScope;
let thread: HTMLElement;
let composer: HTMLElement;

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

/** One exchange as ChatGPT renders it: an item keyed by `data-turn-key`, the prompt in its bubble. */
function exchange(key: string, prompt: string): HTMLElement {
  const item = document.createElement('div');
  item.setAttribute('data-turn-key', key);
  item.innerHTML = '<div data-user-message-bubble="true"></div>';
  item.firstElementChild!.textContent = prompt;
  return item;
}

function dotFor(prompt: string): HTMLElement {
  const dot = Array.from(document.querySelectorAll<HTMLElement>('.timeline-dot')).find(
    (candidate) => candidate.getAttribute('aria-label') === prompt,
  );
  if (!dot) throw new Error(`no dot for "${prompt}"`);
  return dot;
}

/** The tooltip the rail shows when the pointer rests on `prompt`'s dot. */
async function tooltipOf(prompt: string): Promise<string> {
  const tip = document.querySelector<HTMLElement>('.timeline-tooltip')!;
  tip.textContent = '';
  dotFor(prompt).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  await vi.waitFor(() => expect(tip.textContent).toContain(prompt));
  return tip.textContent ?? '';
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(SENT_AT);
  history.replaceState({}, '', '/c/one');
  document.body.innerHTML =
    '<main></main><form><div id="prompt-textarea" contenteditable="true"></div></form>';
  thread = document.querySelector('main')!;
  composer = document.querySelector('#prompt-textarea')!;
  thread.append(exchange('turn-1', 'Earlier question'));
  storage = createMemoryStorage();
  storage.values.sync.set(StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS, true);
  vi.stubGlobal('chrome', { ...chrome, storage: storage.api });
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(((
    request: { type: string },
    callback: (value: unknown) => void,
  ) => {
    if (request.type === 'gv.starred.getForConversation') callback({ ok: true, messages: [] });
  }) as typeof chrome.runtime.sendMessage);
  scope = new PluginScope();
  turnNavigatorPrimitive.activate(
    scope,
    {},
    {
      doc: document,
      adapter: requireBundledSiteAdapter('chatgpt'),
      pluginId: 'voyager.chatgpt-timeline',
      settings: {},
      setTargetCounter: () => {},
    },
  );
  await vi.waitFor(() => dotFor('Earlier question'));
});

afterEach(async () => {
  await scope.dispose();
  document.body.innerHTML = '';
  history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('catalog timeline message times', () => {
  it('a sent message gets a timestamp; scrolled-in history does not', async () => {
    composer.textContent = 'New question';
    vi.setSystemTime(SENT_AT);
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    composer.textContent = '';
    vi.setSystemTime(SENT_AT + 5_000);
    thread.append(exchange('turn-2', 'New question'));
    await flush();
    // The user scrolls up and ChatGPT mounts an older message.
    thread.prepend(exchange('turn-0', 'Oldest question'));
    await vi.waitFor(() => dotFor('New question') && dotFor('Oldest question'));

    expect(await tooltipOf('New question')).toContain(SENT_LABEL);
    for (const history of ['Oldest question', 'Earlier question']) {
      expect(await tooltipOf(history)).not.toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    }
    await vi.waitFor(() =>
      expect(storage.values.local.get(StorageKeys.GV_MESSAGE_TIMESTAMPS)).toEqual({
        version: 2,
        conversations: { 'chatgpt:conv:one': { 'turn-2': SENT_AT } },
      }),
    );
  });

  it('with message timestamps turned off, a send leaves no time behind', async () => {
    storage.external('sync', StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS, false);
    await flush();
    composer.textContent = 'New question';
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    composer.textContent = '';
    thread.append(exchange('turn-2', 'New question'));
    await vi.waitFor(() => dotFor('New question'));
    await flush();

    expect(await tooltipOf('New question')).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(storage.values.local.has(StorageKeys.GV_MESSAGE_TIMESTAMPS)).toBe(false);
  });
});
