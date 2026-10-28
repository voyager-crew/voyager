import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { loadTranslations } from '@/utils/translations';

import { CHATGPT_JUMP_ACCOUNT_TIMEOUT_MS } from '../chatGptJumpMessages';
import { confirmSavedLibraryOpen } from '../confirmSavedLibraryOpen';
import type { SavedLibraryItem } from '../model';

const en = await loadTranslations('en');

const account = `chatgpt:${'a'.repeat(64)}`;
const item: SavedLibraryItem = {
  id: 'starred:chatgpt:conv:one:turn',
  kind: 'starred',
  conversationId: 'chatgpt:conv:one',
  conversationUrl: 'https://chatgpt.com/c/one',
  turnId: 'turn',
  content: 'Saved answer',
  savedAt: 1,
  account,
};
const t = (key: keyof typeof en) => en[key];
function confirm() {
  return confirmSavedLibraryOpen(item, [item], t);
}
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
function dialog() {
  return document.querySelector<HTMLElement>('[data-gv-layer="popover"]')?.shadowRoot;
}
function answer(label: string) {
  const button = [...dialog()!.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === label,
  )!;
  button.click();
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(chrome.tabs.query).mockImplementation(async () => [
    { id: 7, url: 'https://chatgpt.com/' } as chrome.tabs.Tab,
  ]);
  vi.mocked(chrome.tabs.sendMessage).mockImplementation(async () => ({ ok: true, account }));
});
afterEach(() => {
  if (dialog()) answer('Cancel');
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('a star from another ChatGPT account asks to switch instead of opening', async () => {
  vi.mocked(chrome.tabs.sendMessage).mockImplementation(async () => ({
    ok: true,
    account: `chatgpt:${'b'.repeat(64)}`,
  }));
  const pending = confirm();
  await settle();
  expect(dialog()?.textContent).toContain(
    'This star was saved in Account 1. Switch to that account in ChatGPT, then open again.',
  );
  answer('Cancel');
  expect(await pending).toBe(false);
});

it('Open anyway lets an explicitly confirmed cross-account star open', async () => {
  vi.mocked(chrome.tabs.sendMessage).mockImplementation(async () => ({
    ok: true,
    account: `chatgpt:${'b'.repeat(64)}`,
  }));
  const pending = confirm();
  await settle();
  answer('Open anyway');
  expect(await pending).toBe(true);
});

it.each(['failure', 'unreadable', 'no tab', 'timeout'])(
  'an unreadable ChatGPT account still opens the star (%s)',
  async (caseName) => {
    if (caseName === 'failure')
      vi.mocked(chrome.tabs.sendMessage).mockRejectedValue(new Error('No content script'));
    if (caseName === 'unreadable')
      vi.mocked(chrome.tabs.sendMessage).mockImplementation(async () => ({ ok: false }));
    if (caseName === 'no tab') vi.mocked(chrome.tabs.query).mockImplementation(async () => []);
    if (caseName === 'timeout') {
      vi.useFakeTimers();
      vi.mocked(chrome.tabs.sendMessage).mockImplementation(() => new Promise(() => {}));
    }
    const pending = confirm();
    if (caseName === 'timeout') await vi.advanceTimersByTimeAsync(CHATGPT_JUMP_ACCOUNT_TIMEOUT_MS);
    expect(await pending).toBe(true);
    expect(dialog()).toBeUndefined();
  },
);

it('a matching ChatGPT account opens without a prompt and checks again on the next open', async () => {
  expect(await confirm()).toBe(true);
  expect(await confirm()).toBe(true);
  expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
  expect(dialog()).toBeUndefined();
});

it('a legacy star opens without an account probe', async () => {
  expect(await confirmSavedLibraryOpen({ ...item, account: undefined }, [item], t)).toBe(true);
  expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
});

it('an unmounted library cannot open a star after its delayed account check', async () => {
  const owner = new AbortController();
  let release!: (value: unknown) => void;
  vi.mocked(chrome.tabs.sendMessage).mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = confirmSavedLibraryOpen(item, [item], t, owner.signal);
  await settle();
  owner.abort();
  release({ ok: true, account });
  expect(await pending).toBe(false);
  expect(dialog()).toBeUndefined();
});
