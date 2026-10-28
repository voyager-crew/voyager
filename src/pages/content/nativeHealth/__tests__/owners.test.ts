// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://gemini.google.com/app/0123456789abcdef" }
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginScope } from '@/features/plugins/runtime/pluginScope';

import { insertTextIntoChatInput } from '../../chatInput';
import { activateGeminiChatWidth } from '../../chatWidth/pluginHandler';
import {
  createSidebarRuntimeHarness,
  mountSidebar,
} from '../../folder/__tests__/sidebarRuntimeHarness';
import { TimelineManager } from '../../timeline/manager';
import { NATIVE_HEALTH_GRACE_MS, nativeHealthReporter } from '../index';

vi.mock('@/utils/i18n', () => ({
  onCachedLanguageChange: () => () => {},
  initI18n: vi.fn().mockResolvedValue(undefined),
  getTranslationSync: (key: string) => key,
  getTranslationSyncUnsafe: (key: string) => key,
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
      sync: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  },
}));

/**
 * Each owner that depends on a Gemini anchor reports `broken` (or `degraded`) when its selectors
 * match nothing on a page that is visibly a loaded conversation. The fixture renders a
 * conversation whose turns use element names Voyager does not know, the shape a Gemini redesign
 * leaves behind.
 */
const RENAMED_CONVERSATION = `<main>
  <div class="renamed-user-turn"><p>${'How do I profile a slow query? '.repeat(6)}</p></div>
  <div class="renamed-model-turn"><p>${'Start with EXPLAIN ANALYZE and read the plan. '.repeat(6)}</p></div>
</main>`;

const KNOWN_CONVERSATION = `<main>
  <user-query><div class="user-query-bubble-with-background">${'Question text. '.repeat(10)}</div></user-query>
  <model-response><p>${'Answer text. '.repeat(20)}</p></model-response>
</main>`;

function featuresAfterGrace(): string[] {
  vi.advanceTimersByTime(NATIVE_HEALTH_GRACE_MS);
  return nativeHealthReporter.getEntries().map((entry) => `${entry.feature}:${entry.status}`);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  history.replaceState(null, '', '/app/0123456789abcdef');
  nativeHealthReporter.start();
});

afterEach(() => {
  nativeHealthReporter.stop();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('timeline', () => {
  /** Starts the timeline through its production entry point, detection timeout included. */
  async function detect(html: string): Promise<TimelineManager> {
    class InertObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal('ResizeObserver', InertObserver);
    vi.stubGlobal('IntersectionObserver', InertObserver);
    document.body.innerHTML = html;
    const manager = new TimelineManager();
    // Starred messages and timestamps load from storage; they do not decide turn detection.
    const owners = manager as unknown as {
      state: { init(): Promise<void> };
      timestamps: { init(): Promise<void> };
    };
    vi.spyOn(owners.state, 'init').mockResolvedValue();
    vi.spyOn(owners.timestamps, 'init').mockResolvedValue();
    // Settings and shortcuts load after the first render; the test only needs init to get there.
    void manager.init();
    await vi.advanceTimersByTimeAsync(4_000);
    return manager;
  }

  it('reports broken when no user-turn selector matches a rendered conversation', async () => {
    const manager = await detect(RENAMED_CONVERSATION);
    expect(featuresAfterGrace()).toEqual(['timeline:broken']);
    manager.destroy();
    expect(nativeHealthReporter.getEntries()).toEqual([]);
  });

  it('stays healthy when turns are found', async () => {
    const manager = await detect(KNOWN_CONVERSATION);
    expect(featuresAfterGrace()).toEqual([]);
    manager.destroy();
  });
});

describe('chat width', () => {
  let scope: PluginScope;

  beforeEach(() => {
    scope = new PluginScope();
    (chrome.storage.sync.get as unknown as Mock).mockResolvedValue({ gvChatWidthEnabled: true });
  });

  afterEach(async () => {
    await scope.dispose();
  });

  it('reports broken when its user-turn rules match nothing in a rendered conversation', () => {
    document.body.innerHTML = RENAMED_CONVERSATION;
    activateGeminiChatWidth(scope, { widthPercent: 80 });
    expect(featuresAfterGrace()).toEqual(['chat-width:broken']);
  });

  it('clears its warning once user turns render on the same route', async () => {
    document.body.innerHTML = RENAMED_CONVERSATION;
    activateGeminiChatWidth(scope, { widthPercent: 80 });
    expect(featuresAfterGrace()).toEqual(['chat-width:broken']);

    document
      .querySelector('main')!
      .insertAdjacentHTML(
        'beforeend',
        '<user-query><div class="user-query-bubble-with-background">Late turn</div></user-query>',
      );
    await vi.advanceTimersByTimeAsync(250);
    expect(nativeHealthReporter.getEntries()).toEqual([]);
  });

  it('stays healthy when the width rules have turns to widen', () => {
    document.body.innerHTML = KNOWN_CONVERSATION;
    activateGeminiChatWidth(scope, { widthPercent: 80 });
    expect(featuresAfterGrace()).toEqual([]);
  });

  it('withdraws its warning while off and leaves no late probe running', async () => {
    document.body.innerHTML = RENAMED_CONVERSATION;
    activateGeminiChatWidth(scope, { widthPercent: 80 });
    expect(featuresAfterGrace()).toEqual(['chat-width:broken']);
    await scope.dispose();
    document.querySelector('main')!.append(document.createElement('div'));
    await vi.advanceTimersByTimeAsync(250 + NATIVE_HEALTH_GRACE_MS);
    expect(nativeHealthReporter.getEntries()).toEqual([]);
  });
});

describe('folders', () => {
  let harness: ReturnType<typeof createSidebarRuntimeHarness>;

  beforeEach(() => {
    harness = createSidebarRuntimeHarness();
  });

  afterEach(() => {
    harness.runtime.stop();
  });

  it('reports degraded when the sidebar anchor is gone and folders fall back to floating', async () => {
    const { recentsSection, notebooksSection } = mountSidebar();
    recentsSection.remove();
    notebooksSection.remove();
    await harness.runtime.start('sidebar');
    await vi.advanceTimersByTimeAsync(14_000);
    expect(harness.floating.open).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(NATIVE_HEALTH_GRACE_MS);
    expect(nativeHealthReporter.getEntries().map((e) => `${e.feature}:${e.status}`)).toEqual([
      'folders:degraded',
    ]);

    harness.runtime.stop();
    expect(nativeHealthReporter.getEntries()).toEqual([]);
  });

  it('does not count a collapsed sidebar as breakage', async () => {
    const { host, recentsSection, notebooksSection } = mountSidebar();
    host.classList.remove('side-nav-open');
    recentsSection.remove();
    notebooksSection.remove();
    await harness.runtime.start('sidebar');
    await vi.advanceTimersByTimeAsync(14_000 + NATIVE_HEALTH_GRACE_MS);
    expect(nativeHealthReporter.getEntries()).toEqual([]);
  });
});

describe('composer', () => {
  it('reports broken when a prompt insertion finds no message box', () => {
    document.body.innerHTML = RENAMED_CONVERSATION;
    expect(insertTextIntoChatInput('prompt')).toBe(false);
    expect(featuresAfterGrace()).toEqual(['composer:broken']);
  });

  it('accepts a collapsed composer that is present but not visible', () => {
    document.body.innerHTML = `${RENAMED_CONVERSATION}<rich-textarea><div contenteditable="true"></div></rich-textarea>`;
    expect(insertTextIntoChatInput('prompt', null)).toBe(false);
    expect(featuresAfterGrace()).toEqual([]);
  });

  it('does not count a miss while the conversation is still loading', () => {
    document.body.innerHTML = '<main></main>';
    insertTextIntoChatInput('prompt');
    expect(featuresAfterGrace()).toEqual([]);
  });

  it('does not count a miss on a new chat, which has no independent evidence of a loaded app', () => {
    history.replaceState(null, '', '/app');
    document.body.innerHTML = '<main></main>';
    insertTextIntoChatInput('prompt');
    expect(featuresAfterGrace()).toEqual([]);
  });
});
