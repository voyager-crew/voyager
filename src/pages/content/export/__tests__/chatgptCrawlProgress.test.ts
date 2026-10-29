import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { showExportProgress } from '@/features/export/ui/exportToasts';
import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';
import { toastDriver } from '@/tests/toastDriver';

import { makeTurns, mountThreadFixture } from '../adapter/__tests__/chatgptThreadFixture';
import type { ChatGptCrawlTiming } from '../adapter/chatgptCrawl';
import { createChatGptTurnSource } from '../adapter/chatgptTurnSource';
import { buildChatGptAdapter } from '../adapter/platform/chatgpt';
import { trackMutationObservers } from './observerTracking';

let preparer: ReturnType<typeof createChatGptTurnSource>;
/** Observers that are observing right now. */
let observing: ReadonlySet<MutationObserver>;

const FAST: Partial<ChatGptCrawlTiming> = {
  pollMs: 1,
  settleMs: 4,
  mountTimeoutMs: 400,
  historyIdleMs: 25,
  historyStallMs: 150,
};

function progressText(): string {
  return toastDriver
    .all()
    .map((toast) => [toast.title, toast.message, toast.detail].filter(Boolean).join(' '))
    .join(' | ');
}

beforeEach(() => {
  document.body.replaceChildren();
  preparer = createChatGptTurnSource(buildChatGptAdapter(chatgptAdapter));
  observing = trackMutationObservers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ChatGPT source crawl progress', () => {
  it('counts the turns it reads in the export progress, then gives the export its text back', async () => {
    const turns = makeTurns(5);
    mountThreadFixture({ turns });
    const exportProgress = showExportProgress({ title: 'Export...', message: 'Loading' });
    const shown: string[] = [];

    const session = await preparer.prepare({
      timing: FAST,
      onProgress: () => {
        shown.push(progressText());
      },
    });

    expect(shown.at(-1)).toBe('Reading conversation… Turns read: 5');
    expect(progressText()).toBe('Export... Loading');
    expect(toastDriver.all()).toMatchObject([{ pending: true }]);
    expect(session?.messages()).toHaveLength(10);
    exportProgress.hide();
    expect(toastDriver.all()).toEqual([]);
  });

  it('cancels from its button: restores the scroll, stops watching the thread and rejects quietly', async () => {
    const turns = makeTurns(8);
    const fixture = mountThreadFixture({ turns });
    fixture.setOffset(3000);
    const fromEnd = fixture.range() - fixture.offset();
    const onProgress = (count: number) => {
      if (count === 2) toastDriver.press(toastDriver.all()[0], 'Cancel');
    };

    await expect(preparer.prepare({ timing: FAST, onProgress })).rejects.toMatchObject({
      name: 'AbortError',
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(toastDriver.all()).toEqual([]);
    expect(fixture.range() - fixture.offset()).toBe(fromEnd);
    expect(observing.size).toBe(0);
  });

  it('stops when the export itself is cancelled', async () => {
    mountThreadFixture({ turns: makeTurns(6) });
    const controller = new AbortController();
    const onProgress = (count: number) => {
      if (count === 1) controller.abort();
    };

    await expect(
      preparer.prepare({
        signal: controller.signal,
        timing: FAST,
        onProgress,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(toastDriver.all()).toEqual([]);
  });

  it('shows nothing on the earlier DOM, which has no crawl', async () => {
    document.body.innerHTML = '<main><div data-turn-id-container="a"></div></main>';

    await expect(preparer.prepare({ timing: FAST })).resolves.toBeNull();
    expect(toastDriver.all()).toEqual([]);
  });
});
