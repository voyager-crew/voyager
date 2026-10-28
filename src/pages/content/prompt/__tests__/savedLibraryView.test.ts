import { afterEach, expect, it, vi } from 'vitest';

import { accountIsolationService } from '@/core/services/AccountIsolationService';
import { StarredMessagesService } from '@/features/savedLibrary/StarredMessagesService';
import { makeRecord } from '@/pages/content/highlight/__tests__/fixtures';
import { loadTranslations } from '@/utils/translations';

import { createSavedLibraryView } from '../savedLibraryView';

const en = await loadTranslations('en');

vi.mock('webextension-polyfill', () => ({ default: chrome }));

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('keeps a starred row after a failed removal and allows retry', async () => {
  vi.spyOn(StarredMessagesService, 'getAllStarredMessagesSorted').mockResolvedValue([
    {
      conversationId: 'gemini:conv:saved',
      conversationUrl: 'https://gemini.google.com/app/saved',
      turnId: 's-aaaaaaaaaaaaaaaa',
      content: 'Saved answer',
      starredAt: 100,
    },
  ]);
  vi.spyOn(accountIsolationService, 'resolveAccountScope').mockResolvedValue({
    accountKey: 'opaque-account',
    accountId: 1,
    routeUserId: '1',
    emailHash: null,
  });
  vi.mocked(chrome.runtime.sendMessage).mockImplementation((() =>
    Promise.resolve({ ok: true, records: [] })) as typeof chrome.runtime.sendMessage);
  const remove = vi
    .spyOn(StarredMessagesService, 'removeStarredMessage')
    .mockRejectedValueOnce(new Error('Storage unavailable'))
    .mockResolvedValue(undefined);
  const list = document.createElement('div');
  const notice = document.createElement('p');
  document.body.append(list, notice);
  const view = createSavedLibraryView({
    list,
    t: (key) => en[key],
    getQuery: () => '',
    isActive: () => true,
    setNotice: (text, kind) => {
      notice.textContent = text;
      notice.dataset.kind = kind;
    },
    beforeRender: () => {},
    onBack: () => {},
    rememberView: async () => {},
    onNavigated: () => {},
    highlightPlatform: 'gemini',
  });
  await view.load();
  const button = list.querySelector<HTMLButtonElement>('.gv-pm-starred-remove')!;

  button.click();
  await vi.waitFor(() => {
    expect(notice.textContent).toBe(en.starredDeleteFailed);
    expect(notice.dataset.kind).toBe('err');
  });
  expect(list.textContent).toContain('Saved answer');
  expect(button.isConnected).toBe(true);

  button.click();
  await vi.waitFor(() => expect(list.textContent).not.toContain('Saved answer'));
  expect(notice.textContent).toBe(en.pm_deleted);
  expect(notice.dataset.kind).toBe('ok');
  expect(remove).toHaveBeenCalledWith('gemini:conv:saved', 's-aaaaaaaaaaaaaaaa');
});

it('keeps a highlight row and reports highlight removal failure when the request throws', async () => {
  vi.spyOn(StarredMessagesService, 'getAllStarredMessagesSorted').mockResolvedValue([]);
  vi.spyOn(accountIsolationService, 'resolveAccountScope').mockResolvedValue({
    accountKey: 'opaque-account',
    accountId: 1,
    routeUserId: '1',
    emailHash: null,
  });
  const highlight = makeRecord({
    quote: { exact: 'Highlighted answer', prefix: '', suffix: '' },
    position: { start: 0, end: 18 },
    sourceTextHash: 'text-hash',
  });
  vi.mocked(chrome.runtime.sendMessage).mockImplementation((async (message: { type: string }) => {
    if (message.type === 'gv.highlight.list') return { ok: true, records: [highlight] };
    throw new Error('Highlight storage unavailable');
  }) as typeof chrome.runtime.sendMessage);
  const list = document.createElement('div');
  const notice = document.createElement('p');
  document.body.append(list, notice);
  const view = createSavedLibraryView({
    list,
    t: (key) => en[key],
    getQuery: () => '',
    isActive: () => true,
    setNotice: (text, kind) => {
      notice.textContent = text;
      notice.dataset.kind = kind;
    },
    beforeRender: () => {},
    onBack: () => {},
    rememberView: async () => {},
    onNavigated: () => {},
    highlightPlatform: 'gemini',
  });
  await view.load();
  const button = list.querySelector<HTMLButtonElement>('.gv-pm-starred-remove')!;
  button.click();
  await vi.waitFor(() => expect(notice.textContent).toBe(en.highlightDeleteFailed));
  expect(notice.dataset.kind).toBe('err');
  expect(list.textContent).toContain('Highlighted answer');
  expect(button.isConnected).toBe(true);
});
