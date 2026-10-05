// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://gemini.google.com/app" }
/**
 * Characterization of timeline marker levels (the "Node Level" context menu): when the menu is
 * offered, how levels and collapsing render on the rail, the storage keys they persist under
 * (unscoped plus legacy localStorage, or account-scoped on `/u/<n>/` routes), and reload.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  type GeminiTurn,
  GeminiPage,
  SURFACE,
  dotFor,
  dotLabels,
  navigateTo,
  openLevelMenu,
  reloadPage,
  settle,
  startTimelineOnPage,
  turnIdOf,
  useTimelinePage,
} from './geminiTimelineHarness';

vi.mock('webextension-polyfill', async () =>
  (await import('./geminiTimelineHarness')).polyfillMock(),
);

const CONVERSATION_ID = 'gemini:conv:abc123';
const UNSCOPED_KEY = 'geminiTimelineHierarchy';
const LEGACY_LEVELS_KEY = `geminiTimelineLevels:${CONVERSATION_ID}`;
const LEGACY_COLLAPSED_KEY = `geminiTimelineCollapsed:${CONVERSATION_ID}`;
// `geminiTimelineHierarchy:acct:<hashString(accountKey)>` for the route-only accounts /u/1 and /u/2.
const ACCOUNT_1_KEY = 'geminiTimelineHierarchy:acct:5d750n';
const ACCOUNT_2_KEY = 'geminiTimelineHierarchy:acct:5n6qpm';

const TURNS: GeminiTurn[] = [
  { prompt: 'Chapter one', serverId: 'aaaaaaaaaaaaaaaa' },
  { prompt: 'Detail 1a', serverId: 'bbbbbbbbbbbbbbbb' },
  { prompt: 'Detail 1b', serverId: 'cccccccccccccccc' },
  { prompt: 'Chapter two', serverId: 'dddddddddddddddd' },
];
const [CHAPTER_ONE, DETAIL_A, DETAIL_B, CHAPTER_TWO] = TURNS;

type Hierarchy = {
  conversations: Record<
    string,
    { conversationUrl: string; levels: Record<string, number>; collapsed: string[] }
  >;
};

function chooseFromLevelMenu(prompt: string, item: 'level-2' | 'level-3' | 'collapse'): void {
  const menu = openLevelMenu(dotFor(prompt));
  if (!menu) throw new Error(`No level menu for "${prompt}"`);
  const selector =
    item === 'collapse' ? '.collapse-item' : `[data-level="${item.slice('level-'.length)}"]`;
  menu.querySelector<HTMLElement>(selector)!.click();
}

async function outlineChapterOne(): Promise<void> {
  chooseFromLevelMenu(DETAIL_A.prompt, 'level-2');
  chooseFromLevelMenu(DETAIL_B.prompt, 'level-2');
  await settle();
}

describe('timeline marker levels', () => {
  const ext = useTimelinePage();

  it('offers no level menu while marker levels are switched off', async () => {
    new GeminiPage(TURNS);
    await startTimelineOnPage();

    expect(openLevelMenu(dotFor(DETAIL_A.prompt))).toBeNull();
  });

  it('turning marker levels on in settings offers the menu on the open page', async () => {
    new GeminiPage(TURNS);
    await startTimelineOnPage();

    ext().external('sync', { geminiTimelineMarkerLevel: true });
    await settle();

    expect(openLevelMenu(dotFor(DETAIL_A.prompt))).not.toBeNull();
  });

  it('setting a level shows on the dot and persists under the unscoped and legacy keys', async () => {
    ext().seed('sync', { geminiTimelineMarkerLevel: true });
    new GeminiPage(TURNS);
    await startTimelineOnPage();
    expect(dotFor(DETAIL_A.prompt).dataset.level).toBe('1');

    chooseFromLevelMenu(DETAIL_A.prompt, 'level-3');
    await settle();

    expect(dotFor(DETAIL_A.prompt).dataset.level).toBe('3');
    expect(document.querySelector(SURFACE.levelMenu)).toBeNull();
    const detailId = turnIdOf(DETAIL_A.serverId!);
    expect(ext().read<Hierarchy>('local', UNSCOPED_KEY)?.conversations[CONVERSATION_ID]).toEqual(
      expect.objectContaining({
        conversationUrl: 'https://gemini.google.com/app/abc123',
        levels: { [detailId]: 3 },
        collapsed: [],
      }),
    );
    expect(JSON.parse(localStorage.getItem(LEGACY_LEVELS_KEY)!)).toEqual({ [detailId]: 3 });
  });

  it('collapsing a chapter hides its deeper turns until it is expanded', async () => {
    ext().seed('sync', { geminiTimelineMarkerLevel: true });
    new GeminiPage(TURNS);
    await startTimelineOnPage();
    await outlineChapterOne();

    chooseFromLevelMenu(CHAPTER_ONE.prompt, 'collapse');
    await settle();

    expect(dotLabels()).toEqual([CHAPTER_ONE.prompt, CHAPTER_TWO.prompt]);
    const chapter = dotFor(CHAPTER_ONE.prompt);
    expect(chapter.classList.contains('collapsed')).toBe(true);
    expect(chapter.getAttribute('aria-expanded')).toBe('false');
    expect(JSON.parse(localStorage.getItem(LEGACY_COLLAPSED_KEY)!)).toEqual([
      turnIdOf(CHAPTER_ONE.serverId!),
    ]);

    chooseFromLevelMenu(CHAPTER_ONE.prompt, 'collapse');
    await settle();

    expect(dotLabels()).toEqual(TURNS.map((turn) => turn.prompt));
    expect(dotFor(CHAPTER_ONE.prompt).getAttribute('aria-expanded')).toBe('true');
  });

  it('levels and a collapsed chapter survive a reload', async () => {
    ext().seed('sync', { geminiTimelineMarkerLevel: true });
    new GeminiPage(TURNS);
    await startTimelineOnPage();
    await outlineChapterOne();
    chooseFromLevelMenu(CHAPTER_ONE.prompt, 'collapse');
    await settle();

    await reloadPage(TURNS);

    expect(dotLabels()).toEqual([CHAPTER_ONE.prompt, CHAPTER_TWO.prompt]);
    expect(dotFor(CHAPTER_ONE.prompt).classList.contains('collapsed')).toBe(true);
  });

  it('levels saved only in legacy localStorage are read back', async () => {
    ext().seed('sync', { geminiTimelineMarkerLevel: true });
    localStorage.setItem(
      LEGACY_LEVELS_KEY,
      JSON.stringify({ [turnIdOf(CHAPTER_TWO.serverId!)]: 2 }),
    );
    new GeminiPage(TURNS);
    await startTimelineOnPage();

    expect(dotFor(CHAPTER_TWO.prompt).dataset.level).toBe('2');
  });

  it('switching marker levels off shows every turn again but keeps the saved outline', async () => {
    ext().seed('sync', { geminiTimelineMarkerLevel: true });
    new GeminiPage(TURNS);
    await startTimelineOnPage();
    await outlineChapterOne();
    chooseFromLevelMenu(CHAPTER_ONE.prompt, 'collapse');
    await settle();

    ext().external('sync', { geminiTimelineMarkerLevel: false });
    await settle();
    expect(dotLabels()).toEqual(TURNS.map((turn) => turn.prompt));

    ext().external('sync', { geminiTimelineMarkerLevel: true });
    await settle();
    expect(dotLabels()).toEqual([CHAPTER_ONE.prompt, CHAPTER_TWO.prompt]);
  });
});

describe('timeline marker levels across a route change', () => {
  const ext = useTimelinePage();

  it('a level edit during a route change stays with its conversation', async () => {
    ext().seed('sync', { geminiTimelineMarkerLevel: true });
    const page = new GeminiPage(TURNS);
    await startTimelineOnPage();

    // Gemini switches chats and renders the next one before the timeline's route debounce rebuilds it.
    const next: GeminiTurn[] = [
      { prompt: 'Other chat opener', serverId: 'eeeeeeeeeeeeeeee' },
      { prompt: 'Other chat detail', serverId: 'ffffffffffffffff' },
    ];
    history.pushState(null, '', '/app/def456');
    page.viewport.replaceChildren();
    next.forEach((turn) => page.append(turn));
    await settle(450);
    chooseFromLevelMenu(next[1].prompt, 'level-2');
    await settle(2000);

    const stored = ext().read<Hierarchy>('local', UNSCOPED_KEY)?.conversations ?? {};
    expect(stored[CONVERSATION_ID]?.levels ?? {}).not.toHaveProperty(turnIdOf(next[1].serverId!));
    expect(localStorage.getItem(LEGACY_LEVELS_KEY)).toBeNull();
  });
});

describe('timeline marker levels outside the dots style', () => {
  const ext = useTimelinePage();

  it('a compact or ruler rail with node levels on offers no level menu and shows every turn flat', async () => {
    ext().seed('sync', { geminiTimelineMarkerLevel: true });
    new GeminiPage(TURNS);
    await startTimelineOnPage();
    await outlineChapterOne();
    chooseFromLevelMenu(CHAPTER_ONE.prompt, 'collapse');
    await settle();

    for (const style of ['compact', 'ruler']) {
      ext().external('sync', { geminiTimelineStyle: style });
      await settle();
      expect(dotLabels()).toEqual(TURNS.map((turn) => turn.prompt));
      expect(dotFor(DETAIL_A.prompt).dataset.level).toBe('1');
      expect(openLevelMenu(dotFor(DETAIL_A.prompt))).toBeNull();
    }

    ext().external('sync', { geminiTimelineStyle: 'dots' });
    await settle();
    expect(dotLabels()).toEqual([CHAPTER_ONE.prompt, CHAPTER_TWO.prompt]);
    expect(openLevelMenu(dotFor(CHAPTER_ONE.prompt))).not.toBeNull();
  });
});

describe('timeline marker levels on multi-account routes', () => {
  const ext = useTimelinePage('/u/1/app/abc123');

  it('an outline saved on /u/1/ is stored under that account only', async () => {
    ext().seed('sync', { geminiTimelineMarkerLevel: true });
    new GeminiPage(TURNS);
    await startTimelineOnPage();

    chooseFromLevelMenu(DETAIL_A.prompt, 'level-2');
    await settle();

    expect(ext().read<Hierarchy>('local', ACCOUNT_1_KEY)?.conversations[CONVERSATION_ID]).toEqual(
      expect.objectContaining({ levels: { [turnIdOf(DETAIL_A.serverId!)]: 2 } }),
    );
    expect(ext().read('local', UNSCOPED_KEY)).toBeUndefined();
    expect(localStorage.getItem(LEGACY_LEVELS_KEY)).toBeNull();
  });

  it('another account on /u/2/ does not see the /u/1/ outline, and /u/1/ still does', async () => {
    ext().seed('sync', { geminiTimelineMarkerLevel: true });
    const page = new GeminiPage(TURNS);
    await startTimelineOnPage();
    chooseFromLevelMenu(DETAIL_A.prompt, 'level-2');
    await settle();

    page.render(TURNS);
    await navigateTo('/u/2/app/abc123');
    expect(dotFor(DETAIL_A.prompt).dataset.level).toBe('1');
    expect(ext().read('local', ACCOUNT_2_KEY)).toBeUndefined();

    page.render(TURNS);
    await navigateTo('/u/1/app/abc123');
    expect(dotFor(DETAIL_A.prompt).dataset.level).toBe('2');
  });
});
