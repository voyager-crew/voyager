import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';

import { makeTurns, mountThreadFixture } from '../adapter/__tests__/chatgptThreadFixture';
import type { ChatGptCrawlTiming } from '../adapter/chatgptCrawl';
import { createChatGptTurnSource } from '../adapter/chatgptTurnSource';
import { buildChatGptAdapter } from '../adapter/platform/chatgpt';
import type { ExportSelectionOptions } from '../adapter/type';
import type { ExportTurnSession } from '../exportSite';
import { runPreparedExport } from '../preparedExport';
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

/**
 * The ChatGPT export's preparation, crawling at test speed.
 * `onProgress` lets a test act mid-crawl.
 */
function chatGptSource(onProgress?: (turns: number) => void): {
  prepare: (options: ExportSelectionOptions) => Promise<ExportTurnSession | null>;
} {
  return {
    prepare: (options) =>
      preparer.prepare({
        ...options,
        timing: FAST,
        onProgress,
      }),
  };
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

describe('runPreparedExport', () => {
  it('watches the ChatGPT thread during selection and stops once the session ends', async () => {
    mountThreadFixture({ turns: makeTurns(4) });
    let observedDuringSelection = 0;
    let listed = 0;
    let read = null as ExportTurnSession | null;

    await runPreparedExport(
      chatGptSource(),
      { expectedUrl: location.href },
      {
        scrollToTop: async () => {},
        // The session ends by export, Cancel, Escape or teardown alike: it resolves.
        exportSelection: async (session) => {
          read = session;
          observedDuringSelection = observing.size;
          listed = session?.messages().length ?? 0;
        },
      },
    );

    expect(observedDuringSelection).toBeGreaterThan(0);
    expect(listed).toBe(8);
    expect(observing.size).toBe(0);
    expect(read?.messages()).toEqual([]);
  });

  it('stops watching the ChatGPT thread when the session fails', async () => {
    mountThreadFixture({ turns: makeTurns(4) });

    await expect(
      runPreparedExport(
        chatGptSource(),
        { expectedUrl: location.href },
        {
          scrollToTop: async () => {},
          exportSelection: async () => {
            throw new Error('export failed');
          },
        },
      ),
    ).rejects.toThrow('export failed');

    expect(observing.size).toBe(0);
  });

  it('leaves no watch behind when the crawl is cancelled', async () => {
    const turns = makeTurns(6);
    mountThreadFixture({ turns });
    const controller = new AbortController();
    const adapter = chatGptSource((count) => {
      if (count === 2) controller.abort();
    });
    const exportSelection = vi.fn(async () => {});

    await expect(
      runPreparedExport(
        adapter,
        { signal: controller.signal, expectedUrl: location.href },
        { scrollToTop: async () => {}, exportSelection },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(exportSelection).not.toHaveBeenCalled();
    expect(observing.size).toBe(0);
  });

  it('leaves the export that replaced one cancelled during its scroll restore intact', async () => {
    const turns = makeTurns(6);
    mountThreadFixture({ turns });
    const first = new AbortController();
    let second: Promise<void> | null = null;
    let firstEnded: Promise<unknown> = Promise.resolve();
    const seen = { listed: 0, observing: 0 };
    const startSecond = () =>
      runPreparedExport(
        chatGptSource(),
        { expectedUrl: location.href },
        {
          scrollToTop: async () => {},
          exportSelection: async (session) => {
            // The cancelled export's cleanup has run by now.
            await firstEnded;
            seen.listed = session?.messages().length ?? 0;
            seen.observing = observing.size;
          },
        },
      );
    // Export B starts once A has read everything: A is cancelled and restores the scroll.
    const adapter = chatGptSource((count) => {
      if (count !== turns.length || second) return;
      first.abort();
      second = startSecond();
    });

    firstEnded = runPreparedExport(
      adapter,
      { signal: first.signal, expectedUrl: location.href },
      { scrollToTop: async () => {}, exportSelection: async () => {} },
    ).catch((error: unknown) => error);

    await expect(firstEnded).resolves.toMatchObject({ name: 'AbortError' });
    await second;
    expect(seen).toEqual({ listed: 12, observing: 1 });
    expect(observing.size).toBe(0);
  });

  it('ignores a release from a preparation that a newer one replaced', async () => {
    mountThreadFixture({ turns: makeTurns(3) });
    const older = await preparer.prepare({ timing: FAST });
    const newer = await preparer.prepare({ timing: FAST });

    older?.release();
    expect(newer?.messages()).toHaveLength(6);
    expect(observing.size).toBe(1);

    newer?.release();
    expect(newer?.messages()).toEqual([]);
    expect(observing.size).toBe(0);
  });

  it('does not open selection when the export is cancelled while scrolling to the top', async () => {
    const controller = new AbortController();
    const exportSelection = vi.fn(async () => {});

    await expect(
      runPreparedExport(
        { prepare: async () => null },
        { signal: controller.signal, expectedUrl: location.href },
        { scrollToTop: async () => controller.abort(), exportSelection },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(exportSelection).not.toHaveBeenCalled();
  });

  it('scrolls to the top when the adapter does not prepare the conversation itself', async () => {
    const steps: string[] = [];

    await runPreparedExport(
      { prepare: async () => null },
      { expectedUrl: location.href },
      {
        scrollToTop: async () => {
          steps.push('scroll');
        },
        exportSelection: async () => {
          steps.push('select');
        },
      },
    );

    expect(steps).toEqual(['scroll', 'select']);
  });
});
