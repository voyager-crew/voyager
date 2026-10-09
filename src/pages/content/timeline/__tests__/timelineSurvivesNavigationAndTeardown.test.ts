// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://gemini.google.com/app" }
/**
 * Characterization of the Gemini timeline across Gemini's SPA lifecycle: switching conversations,
 * hash-only changes, Gemini replacing the chat viewport, and leaving conversations altogether
 * (which must remove every piece of timeline UI and stop reacting to input).
 */
import { describe, expect, it, vi } from 'vitest';

import {
  type GeminiTurn,
  GeminiPage,
  SURFACE,
  activeDotLabel,
  dotFor,
  dotLabels,
  leaveConversation,
  longPress,
  navigateTo,
  openLevelMenu,
  pressKey,
  settle,
  startTimelineOnPage,
  starredDotLabels,
  timelineBar,
  trackPageListeners,
  unloadPage,
  useTimelinePage,
} from './geminiTimelineHarness';

vi.mock('webextension-polyfill', async () =>
  (await import('./geminiTimelineHarness')).polyfillMock(),
);

const KYOTO: GeminiTurn[] = [
  { prompt: 'Plan a trip to Kyoto', serverId: 'aaaaaaaaaaaaaaaa' },
  { prompt: 'Add a day in Nara', serverId: 'bbbbbbbbbbbbbbbb' },
  { prompt: 'Book the ryokan', serverId: 'cccccccccccccccc' },
];
const RECIPES: GeminiTurn[] = [
  { prompt: 'Sourdough starter', serverId: '1111111111111111' },
  { prompt: 'Feeding schedule', serverId: '2222222222222222' },
];

/** Every element the timeline adds to the page, as seen from outside. */
const TIMELINE_UI = [
  SURFACE.bar,
  SURFACE.slider,
  SURFACE.tooltip,
  SURFACE.previewToggle,
  SURFACE.previewPanel,
  '.gv-timeline-preview-hover-bridge',
  SURFACE.levelMenu,
];
const timelineUiLeft = () =>
  TIMELINE_UI.filter((selector) => document.querySelector(selector) !== null);

describe('switching between Gemini conversations', () => {
  const ext = useTimelinePage('/app/kyoto');

  it('opening another conversation rebuilds the rail for its turns', async () => {
    const page = new GeminiPage(KYOTO);
    await startTimelineOnPage();

    page.render(RECIPES);
    await navigateTo('/app/recipes');

    expect(dotLabels()).toEqual(RECIPES.map((turn) => turn.prompt));
    expect(document.querySelectorAll(SURFACE.bar)).toHaveLength(1);
  });

  it('stars belong to their conversation and come back when returning to it', async () => {
    const page = new GeminiPage(KYOTO);
    await startTimelineOnPage();
    await longPress(dotFor(KYOTO[1].prompt));
    await settle();

    page.render(RECIPES);
    await navigateTo('/app/recipes');
    expect(starredDotLabels()).toEqual([]);

    page.render(KYOTO);
    await navigateTo('/app/kyoto');
    expect(starredDotLabels()).toEqual([KYOTO[1].prompt]);
  });

  it('a query-string change on the same conversation also rebuilds the rail', async () => {
    const page = new GeminiPage(KYOTO);
    await startTimelineOnPage();
    const before = timelineBar();

    page.render(RECIPES);
    await navigateTo('/app/kyoto?hl=ja');

    expect(timelineBar()).not.toBe(before);
    expect(dotLabels()).toEqual(RECIPES.map((turn) => turn.prompt));
  });

  it('a hash-only change keeps the same rail, stars and active turn', async () => {
    ext().seed('sync', { geminiTimelineScrollMode: 'jump' });
    const page = new GeminiPage(KYOTO);
    await startTimelineOnPage();
    await longPress(dotFor(KYOTO[0].prompt));
    await settle();
    dotFor(KYOTO[2].prompt).click();
    await settle();
    const bar = timelineBar();

    history.pushState(null, '', '/app/kyoto#section');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await settle(2000);

    expect(timelineBar()).toBe(bar);
    expect(starredDotLabels()).toEqual([KYOTO[0].prompt]);
    expect(activeDotLabel()).toBe(KYOTO[2].prompt);
    expect(page.viewport.scrollTop).toBe(page.topOf(KYOTO[2].prompt));
  });
});

describe('Gemini replacing the chat viewport', () => {
  const ext = useTimelinePage('/app/kyoto');

  it('keeps stars and scrolls the new viewport after Gemini re-renders the chat', async () => {
    ext().seed('sync', { geminiTimelineScrollMode: 'jump' });
    const page = new GeminiPage(KYOTO);
    await startTimelineOnPage();
    await longPress(dotFor(KYOTO[1].prompt));
    await settle();
    const oldViewport = page.viewport;

    page.render(KYOTO);
    await settle(2000);

    expect(page.viewport).not.toBe(oldViewport);
    expect(dotLabels()).toEqual(KYOTO.map((turn) => turn.prompt));
    expect(starredDotLabels()).toEqual([KYOTO[1].prompt]);

    dotFor(KYOTO[2].prompt).click();
    await settle();
    expect(page.viewport.scrollTop).toBe(page.topOf(KYOTO[2].prompt));
    expect(activeDotLabel()).toBe(KYOTO[2].prompt);
  });
});

describe('leaving conversations tears the timeline down', () => {
  const ext = useTimelinePage('/app/kyoto');

  it('opening Gemini home removes every piece of timeline UI', async () => {
    ext().seed('sync', { geminiTimelineMarkerLevel: true });
    new GeminiPage(KYOTO);
    await startTimelineOnPage();
    document.querySelector<HTMLElement>(SURFACE.previewToggle)!.click();
    openLevelMenu(dotFor(KYOTO[1].prompt));
    expect(timelineUiLeft()).toEqual(TIMELINE_UI);

    await leaveConversation('/');

    expect(timelineUiLeft()).toEqual([]);
  });

  it('after leaving, keyboard shortcuts and chat scrolling no longer drive a timeline', async () => {
    ext().seed('sync', { geminiTimelineScrollMode: 'jump' });
    const page = new GeminiPage(KYOTO);
    await startTimelineOnPage();

    await leaveConversation('/');
    pressKey('j');
    page.scrollTo(page.topOf(KYOTO[2].prompt));
    await settle();

    expect(page.viewport.scrollTop).toBe(page.topOf(KYOTO[2].prompt));
    expect(timelineUiLeft()).toEqual([]);
  });

  it('settings changes after leaving do not resurrect the rail', async () => {
    new GeminiPage(KYOTO);
    await startTimelineOnPage();

    await leaveConversation('/');
    ext().external('sync', { geminiTimelineHideContainer: true, geminiTimelineStyle: 'compact' });
    await settle();

    expect(timelineUiLeft()).toEqual([]);
  });

  it('entering and leaving conversations repeatedly does not pile up page or storage listeners', async () => {
    const pageListeners = trackPageListeners();
    const page = new GeminiPage(KYOTO);
    await startTimelineOnPage();
    const whileOpen = pageListeners();
    const storageWhileOpen = ext().listeners.size;
    expect(storageWhileOpen).toBeGreaterThan(0);
    await leaveConversation('/');
    const afterFirstVisit = pageListeners();
    const storageAfterFirstVisit = ext().listeners.size;
    expect(afterFirstVisit).toBeLessThan(whileOpen);
    expect(storageAfterFirstVisit).toBeLessThan(storageWhileOpen);

    for (let visit = 0; visit < 3; visit += 1) {
      page.render(KYOTO);
      await navigateTo('/app/kyoto');
      expect(dotLabels()).toEqual(KYOTO.map((turn) => turn.prompt));
      expect(ext().listeners.size).toBe(storageWhileOpen);
      await leaveConversation('/');
      expect(ext().listeners.size).toBe(storageAfterFirstVisit);
    }

    expect(pageListeners()).toBe(afterFirstVisit);
  });

  it('stopping the Gemini timeline while it is still starting leaves no shortcut listeners', async () => {
    const pageListeners = trackPageListeners();
    new GeminiPage(KYOTO);
    // A completed start and stop sets the baseline: page-lifetime caches may keep their listeners.
    await startTimelineOnPage();
    unloadPage();
    await settle();
    const storageAfterStop = ext().listeners.size;
    // Hold the shortcut config read so the page tears the next timeline down mid-startup.
    let releaseShortcuts: () => void = () => {};
    let shortcutsRequested = false;
    const sync = globalThis.chrome.storage.sync;
    const read = sync.get.bind(sync) as (...args: unknown[]) => Promise<Record<string, unknown>>;
    vi.spyOn(sync, 'get').mockImplementation(((...args: unknown[]) => {
      if (args[0] !== 'geminiTimelineShortcuts') return read(...args);
      shortcutsRequested = true;
      return new Promise<Record<string, unknown>>((resolve) => {
        releaseShortcuts = () => resolve({});
      });
    }) as unknown as typeof sync.get);
    await startTimelineOnPage();
    expect(shortcutsRequested).toBe(true);

    unloadPage();
    releaseShortcuts();
    await settle();

    const press = new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true });
    window.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(false);
    expect(pageListeners()).toBe(0);
    expect(ext().listeners.size).toBe(storageAfterStop);
  });

  it('coming back to a conversation after leaving shows its rail again', async () => {
    const page = new GeminiPage(KYOTO);
    await startTimelineOnPage();
    await leaveConversation('/');

    page.render(KYOTO);
    await navigateTo('/app/kyoto');

    expect(dotLabels()).toEqual(KYOTO.map((turn) => turn.prompt));
    expect(document.querySelectorAll(SURFACE.bar)).toHaveLength(1);
  });
});
