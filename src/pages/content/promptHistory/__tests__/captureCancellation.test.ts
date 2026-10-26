// @vitest-environment-options {"url":"https://gemini.google.com"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  accountIsolationService,
  type AccountScope,
} from '@/core/services/AccountIsolationService';

import { startPromptHistoryRuntime } from '../index';
import { addPromptHistory } from '../storage';

vi.mock('../storage', async (original) => ({
  ...(await original<typeof import('../storage')>()),
  addPromptHistory: vi.fn().mockResolvedValue(undefined),
}));
let lifetime: AbortController;
const resolved: AccountScope = {
  accountKey: 'scope:first',
  accountId: 0,
  routeUserId: '0',
  emailHash: null,
};
let finish: (scope: AccountScope) => void;
beforeEach(async () => {
  document.body.innerHTML =
    '<button data-email="first@example.com"></button><div class="text-input-field"><textarea>captured words</textarea><button aria-label="Send">Send</button></div>';
  window.history.replaceState({}, '', '/u/0/app/first');
  vi.mocked(chrome.storage.sync.get).mockImplementation(
    (_keys: unknown, callback?: (items: Record<string, unknown>) => void) => {
      callback?.({});
      return Promise.resolve({});
    },
  );
  vi.mocked(addPromptHistory).mockClear();
  vi.spyOn(accountIsolationService, 'resolveAccountScope').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  lifetime = new AbortController();
  await startPromptHistoryRuntime({ signal: lifetime.signal });
});
afterEach(() => {
  lifetime.abort();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});
function send() {
  document.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click();
}
async function settle() {
  finish(resolved);
  for (let count = 0; count < 8; count++) await Promise.resolve();
}

describe('capture cancellation', () => {
  it.each(['route', 'account', 'teardown'] as const)(
    'a pending capture cannot write after %s while a current capture still saves',
    async (change) => {
      send();
      if (change === 'route') window.history.replaceState({}, '', '/u/0/app/second');
      else if (change === 'account')
        document.querySelector('[data-email]')!.setAttribute('data-email', 'second@example.com');
      else lifetime.abort();
      await settle();
      if (change === 'teardown') {
        lifetime = new AbortController();
        await startPromptHistoryRuntime({ signal: lifetime.signal });
      }
      document.querySelector('textarea')!.value = 'current words';
      send();
      await settle();
      expect(vi.mocked(addPromptHistory).mock.calls.map(([content]) => content)).toEqual([
        'current words',
      ]);
    },
  );

  it.each(['/u/0/app', '/u/0/gem/fable'])(
    'choosing an existing conversation from %s while the first-send scope is pending cancels that capture',
    async (path) => {
      window.history.replaceState({}, '', path);
      send();
      const link = document.createElement('a');
      link.href = `${path}/existing`;
      link.textContent = 'Existing chat';
      link.addEventListener('click', (event) => {
        event.preventDefault();
        window.history.replaceState({}, '', link.pathname);
      });
      document.body.append(link);
      link.click();
      await settle();
      document.querySelector('textarea')!.value = 'current words';
      send();
      await settle();
      expect(vi.mocked(addPromptHistory).mock.calls.map(([content]) => content)).toEqual([
        'current words',
      ]);
    },
  );

  it('the first send still records the new-chat path when Gemini creates its conversation', async () => {
    window.history.replaceState({}, '', '/u/0/app');
    send();
    window.history.replaceState({}, '', '/u/0/app/created');
    await settle();
    expect(addPromptHistory).toHaveBeenCalledWith(
      'captured words',
      'sent',
      '/u/0/app',
      'scope:first',
    );
  });

  it.each(['/gem/fable', '/u/0/gem/fable', '/u/2/gem/fable/'])(
    'the first send in a new Gem at %s is saved when the account read finishes after navigation',
    async (path) => {
      window.history.replaceState({}, '', path);
      send();
      window.history.replaceState({}, '', `${path.replace(/\/$/, '')}/created`);
      await settle();
      expect(addPromptHistory).toHaveBeenCalledWith('captured words', 'sent', path, 'scope:first');
    },
  );

  it.each(['/u/0/app', '/u/0/gem/fable'])(
    'the first send from %s is kept when the account control becomes readable',
    async (path) => {
      document.querySelector('[data-email]')!.remove();
      window.history.replaceState({}, '', path);
      send();
      window.history.replaceState({}, '', `${path}/created`);
      document.body.insertAdjacentHTML(
        'beforeend',
        '<button data-email="first@example.com"></button>',
      );
      await Promise.resolve();
      await settle();
      expect(addPromptHistory).toHaveBeenCalledWith('captured words', 'sent', path, 'scope:first');
    },
  );
});
