// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/" }
/**
 * The send tracker's pending send on its own, with fake timers and ChatGPT's
 * site.json: a send ChatGPT never shows is forgotten, and turning the
 * subscriber off forgets it too. Folder Activity's end-to-end cases live in
 * `chatgptFolders/__tests__/activityView.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requireBundledSiteAdapter } from '@/features/plugins/catalog/sites';
import { PluginScope } from '@/features/plugins/runtime/pluginScope';

import { sendSiteOf, trackUserSends } from '../trackUserSends';

const WORK = 'chatgpt:conv:work';
const PROMPT = 'A prompt';

let scope: PluginScope;
let record: ReturnType<typeof vi.fn<(conversationId: string, at: number) => void>>;
let thread: HTMLElement;
let composer: HTMLElement;

function exchange(key: string): HTMLElement {
  const item = document.createElement('div');
  item.setAttribute('data-turn-key', key);
  item.innerHTML = '<div data-user-message-bubble="true"></div>';
  item.firstElementChild!.textContent = PROMPT;
  return item;
}

/** The user types the prompt each exchange shows and presses Enter. */
function typeAndSend(): void {
  composer.textContent = PROMPT;
  composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState(null, '', '/c/work');
  document.body.innerHTML =
    '<main></main><form><div id="prompt-textarea" contenteditable="true"></div></form>';
  thread = document.querySelector('main')!;
  composer = document.querySelector('#prompt-textarea')!;
  scope = new PluginScope();
  record = vi.fn();
  const site = sendSiteOf(requireBundledSiteAdapter('chatgpt'));
  if (!site) throw new Error("ChatGPT's site.json must name its send inputs");
  trackUserSends(
    scope,
    { ...site, userTurn: '[data-user-message-bubble]', composer: '#prompt-textarea' },
    ({ conversationKey, at }) => record(conversationKey, at),
  );
});

afterEach(async () => {
  await scope.dispose();
  document.body.replaceChildren();
  history.replaceState(null, '', '/');
  vi.useRealTimers();
});

describe('ChatGPT send tracker', () => {
  it('a send ChatGPT never shows is forgotten after 30 seconds', async () => {
    typeAndSend();
    await vi.advanceTimersByTimeAsync(30_000);

    thread.append(exchange('later'));
    await settle();

    expect(record).not.toHaveBeenCalled();
  });

  it('turning the folders off forgets a pending send', async () => {
    typeAndSend();
    await scope.dispose();

    thread.append(exchange('later'));
    await settle();

    expect(record).not.toHaveBeenCalled();
  });

  it('a shown send is recorded once under its chat', async () => {
    typeAndSend();
    thread.append(exchange('sent'));
    await settle();

    expect(record.mock.calls).toEqual([[WORK, Date.now()]]);
  });
});
