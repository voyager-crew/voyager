// @vitest-environment-options { "url": "https://gemini.google.com/u/1/app/a" }
import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import {
  GeminiPage,
  installExtension,
  settle,
} from '../../timeline/__tests__/geminiTimelineHarness';

vi.mock('webextension-polyfill', async () =>
  (await import('../../timeline/__tests__/geminiTimelineHarness')).polyfillMock(),
);

describe('timestamp collection through the shared Gemini turn source', () => {
  it('keeps stored labels and new-turn canonical ids through renamed user hosts', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    localStorage.clear();
    history.replaceState({}, '', '/u/1/app/a');
    const extension = installExtension();
    const storedTime = new Date(2024, 0, 1).getTime();
    extension.seed('sync', { [StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS]: true });
    extension.seed('local', {
      [StorageKeys.GV_MESSAGE_TIMESTAMPS]: {
        version: 2,
        conversations: { 'gemini:conv:a': { 's-1111111111111111': storedTime } },
      },
    });
    const historyService = await import('../historyTimestampPageService');
    const pageService = await import('../messageTimestampPageService');
    const { installGeminiTurnPatch } = await import('../../__tests__/geminiOnlineTurnFixture');
    const stopHistory = historyService.startHistoryTimestampPageService();
    let stopPage: (() => void) | undefined;
    let stopSelectors: (() => void) | undefined;
    try {
      const page = new GeminiPage([{ prompt: 'Existing question', serverId: '1111111111111111' }]);
      stopPage = pageService.startMessageTimestampPageService();
      await pageService.whenMessageTimestampsReady();
      await settle(801);
      const previousLabel = document.querySelector('.gv-timestamp')?.textContent;
      expect(previousLabel).toBeTruthy();
      stopPage();

      const rename = () =>
        document.querySelectorAll('.user-query-bubble-with-background').forEach((element) => {
          element.className = 'online-user';
        });
      rename();
      stopSelectors = await installGeminiTurnPatch({ 'turn.user': ['.online-user'] });
      stopPage = pageService.startMessageTimestampPageService();
      await pageService.whenMessageTimestampsReady();
      await settle(801);
      expect(document.querySelector('.gv-timestamp')?.textContent).toBe(previousLabel);

      page.append({ prompt: 'New question', serverId: '2222222222222222' });
      rename();
      await settle(201);
      const saved = extension.read<{
        version: number;
        conversations: Record<string, Record<string, number>>;
      }>('local', StorageKeys.GV_MESSAGE_TIMESTAMPS);
      expect(saved?.version).toBe(2);
      expect(saved?.conversations['gemini:conv:a']?.['s-1111111111111111']).toBe(storedTime);
      expect(saved?.conversations['gemini:conv:a']?.['s-2222222222222222']).toBeDefined();
      expect(document.querySelectorAll('.gv-timestamp')).toHaveLength(2);
    } finally {
      stopPage?.();
      stopHistory();
      stopSelectors?.();
      await vi.runOnlyPendingTimersAsync();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.useRealTimers();
      document.body.replaceChildren();
    }
  });
});
