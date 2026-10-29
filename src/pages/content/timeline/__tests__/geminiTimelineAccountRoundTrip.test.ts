// @vitest-environment-options { "url": "https://gemini.google.com/u/1/app/acceptance" }
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { TimelineHierarchyData } from '@/features/timeline/hierarchyTypes';

import {
  ACCOUNTS,
  CONVERSATION,
  FIRST_ID,
  OTHER_TURNS,
  SECOND_ID,
  TURNS,
  drivePayloadBytes,
  finishHighlights,
  holdNextLocalRead,
  seedAccountData,
  startHighlights,
  storedDataBytes,
  visibleQuotes,
  visit,
} from './geminiTimelineAccountHarness';
import {
  type ExtensionFake,
  GeminiPage,
  SURFACE,
  dotFor,
  dotLabels,
  installExtension,
  installLayout,
  openLevelMenu,
  settle,
  startTimelineOnPage,
  trackPageListeners,
  unloadPage,
} from './geminiTimelineHarness';

vi.mock('webextension-polyfill', async () =>
  (await import('./geminiTimelineHarness')).polyfillMock(),
);

let ext: ExtensionFake;
let restoreLayout: () => void;
let highlights: Awaited<ReturnType<typeof startHighlights>> | null;
let releaseRead: (() => void) | undefined;

function setLevel(prompt: string, level: number): void {
  const menu = openLevelMenu(dotFor(prompt));
  if (!menu) throw new Error('Expected the enabled node-level menu');
  menu.querySelector<HTMLButtonElement>(`button[data-level="${level}"]`)!.click();
}

async function selectPhrase(page: GeminiPage, prompt: string, exact: string): Promise<boolean> {
  const { selectText } = await import('../../highlight/__tests__/fixtures');
  return highlights!.manager.createFromRange(selectText(page.response(prompt), exact), 'green');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  history.replaceState(null, '', '/u/1/app/acceptance');
  document.body.innerHTML = '';
  localStorage.clear();
  ext = installExtension();
  restoreLayout = installLayout();
  highlights = null;
  releaseRead = undefined;
  ext.seed('sync', {
    [StorageKeys.GV_TIMELINE_ENABLED]: true,
    [StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS]: false,
    [StorageKeys.TIMELINE_MARKER_LEVEL]: true,
    geminiTimelineStyle: 'dots',
  });
  ext.seed('local', {
    [StorageKeys.CATALOG_TIMELINE_HIERARCHY_PREFIX + 'gemini']: { untouched: 'catalog' },
  });
  seedAccountData(ext);
});

afterEach(async () => {
  highlights?.manager.destroy();
  unloadPage();
  releaseRead?.();
  await finishHighlights(highlights);
  restoreLayout();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('Gemini official timeline account data through its real start point', () => {
  it('keeps restored hierarchy, highlights and Drive files unchanged through navigation and two fresh pages', async () => {
    const stored = storedDataBytes(ext);
    const payloads = await drivePayloadBytes(ext);
    expect(JSON.parse(payloads)).toEqual([
      expect.objectContaining({
        name: 'gemini-voyager-timeline-hierarchy.acct-1c662rp.json',
        payload: expect.objectContaining({ format: 'gemini-voyager.timeline-hierarchy.v1' }),
      }),
      expect.objectContaining({
        name: 'gemini-voyager-highlights.acct-1c662rp.json',
        payload: expect.objectContaining({
          format: 'gemini-voyager.annotations.v1',
          accountScope: { platform: 'gemini', accountHash: '1c662rp' },
        }),
      }),
      expect.objectContaining({ name: 'gemini-voyager-timeline-hierarchy.acct-1bc79os.json' }),
      expect.objectContaining({
        name: 'gemini-voyager-highlights.acct-1bc79os.json',
        payload: expect.objectContaining({
          accountScope: { platform: 'gemini', accountHash: '1bc79os' },
        }),
      }),
    ]);

    for (let freshPage = 0; freshPage < 2; freshPage += 1) {
      const page = new GeminiPage(TURNS);
      highlights = await startHighlights();
      await startTimelineOnPage();
      await highlights.ready;
      await settle();
      expect(document.querySelectorAll(SURFACE.bar)).toHaveLength(1);
      expect(dotFor(TURNS[1].prompt).dataset.level).toBe('2');
      expect(visibleQuotes()).toEqual(['target']);
      expect(document.querySelectorAll('.gv-timeline-annotation')).toHaveLength(1);

      await visit(page, '/u/1/app/other', OTHER_TURNS);
      expect(dotLabels()).toEqual([OTHER_TURNS[0].prompt]);
      expect(visibleQuotes()).toEqual([]);
      expect(document.querySelector('.gv-timeline-annotation')).toBeNull();

      await visit(page, '/u/2/app/acceptance');
      expect(dotFor(TURNS[1].prompt).dataset.level).toBe('3');
      expect(visibleQuotes()).toEqual(['other']);
      expect(document.querySelectorAll('.gv-timeline-annotation')).toHaveLength(1);

      await visit(page, '/u/2/', []);
      expect(document.querySelector(SURFACE.bar)).toBeNull();
      expect(visibleQuotes()).toEqual([]);

      await visit(page, '/u/1/app/acceptance');
      expect(dotFor(TURNS[1].prompt).dataset.level).toBe('2');
      expect(visibleQuotes()).toEqual(['target']);
      expect(storedDataBytes(ext)).toBe(stored);
      expect(await drivePayloadBytes(ext)).toBe(payloads);

      highlights.manager.destroy();
      unloadPage();
      await finishHighlights(highlights);
      highlights = null;
      expect(document.querySelector(SURFACE.bar)).toBeNull();
      expect(document.querySelector('.gv-timeline-annotation')).toBeNull();
      expect(document.querySelector('.gv-highlight-mark')).toBeNull();
      expect(storedDataBytes(ext)).toBe(stored);
      document.body.innerHTML = '';
      vi.resetModules();
    }
  });

  it('persists level, collapse and highlight edits only to their captured account and restores them on return', async () => {
    const page = new GeminiPage(TURNS);
    highlights = await startHighlights();
    await startTimelineOnPage();
    await highlights.ready;
    await settle();
    const otherBefore = JSON.stringify([
      ext.read('local', ACCOUNTS[1].hierarchyKey),
      ext.read('local', ACCOUNTS[1].highlightKey),
    ]);

    setLevel(TURNS[1].prompt, 3);
    expect(await selectPhrase(page, TURNS[0].prompt, 'Alpha')).toBe(true);
    await settle();
    expect(
      JSON.stringify([
        ext.read('local', ACCOUNTS[1].hierarchyKey),
        ext.read('local', ACCOUNTS[1].highlightKey),
      ]),
    ).toBe(otherBefore);
    const firstAccount = ext.read<TimelineHierarchyData>('local', ACCOUNTS[0].hierarchyKey);
    expect(firstAccount?.conversations[CONVERSATION]).toMatchObject({
      conversationUrl: 'https://gemini.google.com/u/1/app/acceptance',
      levels: { [SECOND_ID]: 3 },
      collapsed: [],
    });

    await visit(page, '/u/2/app/acceptance');
    expect(visibleQuotes()).toEqual(['other']);
    setLevel(TURNS[0].prompt, 2);
    expect(await selectPhrase(page, TURNS[1].prompt, 'Beta')).toBe(true);
    await settle();
    expect(ext.read('local', ACCOUNTS[0].hierarchyKey)).toEqual(firstAccount);
    const { highlightAnnotationService } =
      await import('@/core/services/HighlightAnnotationService');
    const firstRecords = await highlightAnnotationService.getConversation(
      ACCOUNTS[0].scope,
      CONVERSATION,
    );
    const secondRecords = await highlightAnnotationService.getConversation(
      ACCOUNTS[1].scope,
      CONVERSATION,
    );
    expect(firstRecords.map((record) => record.anchor.quote.exact).sort()).toEqual([
      'Alpha',
      'target',
    ]);
    expect(secondRecords.map((record) => record.anchor.quote.exact).sort()).toEqual([
      'Beta',
      'other',
    ]);
    expect(
      firstRecords.every(
        (record) => record.accountHash === '5d750n' && record.conversationUrl.includes('/u/1/'),
      ),
    ).toBe(true);
    expect(
      secondRecords.every(
        (record) => record.accountHash === '5n6qpm' && record.conversationUrl.includes('/u/2/'),
      ),
    ).toBe(true);

    await visit(page, '/u/1/app/acceptance');
    expect(dotFor(TURNS[1].prompt).dataset.level).toBe('3');
    expect(visibleQuotes().sort()).toEqual(['Alpha', 'target']);
    openLevelMenu(dotFor(TURNS[0].prompt))!
      .querySelector<HTMLButtonElement>('.collapse-item')!
      .click();
    await settle();
    expect(dotLabels()).toEqual([TURNS[0].prompt, TURNS[2].prompt]);
    expect(
      ext.read<TimelineHierarchyData>('local', ACCOUNTS[0].hierarchyKey)?.conversations[
        CONVERSATION
      ].collapsed,
    ).toEqual([FIRST_ID]);
    expect(
      ext.read<TimelineHierarchyData>('local', ACCOUNTS[1].hierarchyKey)?.conversations[
        CONVERSATION
      ],
    ).toMatchObject({
      levels: { [FIRST_ID]: 2, [SECOND_ID]: 3 },
      collapsed: [],
    });
    expect(ext.read('local', StorageKeys.TIMELINE_HIERARCHY)).toBeUndefined();
    expect(localStorage.getItem(`geminiTimelineLevels:${CONVERSATION}`)).toBeNull();
  });

  it.each(['hierarchy', 'highlights'] as const)(
    'leaving before %s arrives cannot restore stale UI or change stored data',
    async (kind) => {
      const pageListeners = trackPageListeners();
      const before = storedDataBytes(ext);
      const held = holdNextLocalRead(
        kind === 'hierarchy' ? ACCOUNTS[0].hierarchyKey : ACCOUNTS[0].highlightKey,
      );
      releaseRead = held.release;
      const page = new GeminiPage(TURNS);
      highlights = await startHighlights();
      await startTimelineOnPage();
      await settle();
      expect(held.wasRequested()).toBe(true);

      await visit(page, '/u/2/', []);
      highlights.manager.destroy();
      unloadPage();
      held.release();
      await highlights.ready;
      await settle(5000);
      expect(document.querySelector(SURFACE.bar)).toBeNull();
      expect(document.querySelector('.gv-highlight-mark')).toBeNull();
      expect(document.querySelector('.gv-timeline-annotation')).toBeNull();
      expect(storedDataBytes(ext)).toBe(before);
      const key = new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true });
      window.dispatchEvent(key);
      expect(key.defaultPrevented).toBe(false);
      expect(pageListeners()).toBe(0);
    },
  );
});
