import '@/features/timeline/adapters/catalog/testSetup';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { hashString } from '@/core/utils/hash';
import type { StarredMessage } from '@/features/savedLibrary/starTypes';
import { buildTurnId } from '@/features/timeline/adapters/catalog/turnMerge';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { PluginScope } from '../../runtime/pluginScope';
import type { NativeOperation } from '../../types';
import type { PluginSettings } from '../../types';
import { turnNavigatorPrimitive } from '../../verbs/turnNavigator';
import type { PrimitiveHandle } from '../../verbs/types';
import { BUILTIN_PLUGINS } from '../index';

const {
  addStarredMessage,
  getStarredMessagesForConversation,
  removeStarredMessage,
  requestPluginSetting,
  showTimelineStyleCoachmark,
} = vi.hoisted(() => ({
  addStarredMessage: vi.fn().mockResolvedValue(undefined),
  getStarredMessagesForConversation: vi.fn().mockResolvedValue([]),
  removeStarredMessage: vi.fn().mockResolvedValue(undefined),
  requestPluginSetting: vi.fn().mockResolvedValue(undefined),
  showTimelineStyleCoachmark: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/i18n', () => ({
  initI18n: vi.fn().mockResolvedValue(undefined),
  getTranslationSync: (key: string) => key,
}));

vi.mock('@/features/savedLibrary/StarredMessagesService', async (importOriginal) => ({
  StarredMessagesService: {
    backfillStarredTexts: vi.fn().mockResolvedValue(undefined),
    decodeStorageChange: (
      await importOriginal<typeof import('@/features/savedLibrary/StarredMessagesService')>()
    ).StarredMessagesService.decodeStorageChange,
    addStarredMessage,
    getStarredMessagesForConversation,
    removeStarredMessage,
  },
}));

vi.mock('@/features/plugins/storage/pluginSettingRequest', () => ({ requestPluginSetting }));

vi.mock('@/features/timeline/timelineStyleCoachmark', () => ({
  showTimelineStyleCoachmark,
}));

let standaloneScope: PluginScope | null = null;
let standaloneHandle: PrimitiveHandle | null = null;
const library = new Map<string, StarredMessage[]>();

/** Exercise the same shipped manifest and resolved site data as PluginHost. */
function startClaudeTimeline(settings: PluginSettings = {}): void {
  const manifest = BUILTIN_PLUGINS.find((plugin) => plugin.id === 'voyager.claude-timeline');
  const op = manifest?.contributes.domOps?.find(
    (entry): entry is NativeOperation => entry.op === 'native',
  );
  const params = turnNavigatorPrimitive.validateParams(op?.params);
  if (!manifest || !params.success) throw new Error('invalid Claude timeline manifest');
  standaloneScope = new PluginScope();
  const handle = turnNavigatorPrimitive.activate(standaloneScope, params.data, {
    doc: document,
    adapter: requireBundledSiteAdapter('claude'),
    pluginId: manifest.id,
    settings,
    setTargetCounter: () => {},
  });
  standaloneHandle = handle && !('then' in handle) ? handle : null;
}

function updateClaudeTimelineSettings(settings: PluginSettings): void {
  standaloneHandle?.updateSettings?.(settings);
}

async function stopClaudeTimeline(): Promise<void> {
  await standaloneScope?.dispose();
  standaloneScope = null;
  standaloneHandle = null;
}

interface CapturedTimelineCoachmarkOptions {
  id: string;
  enabled: boolean;
  onStyleChange: (compact: boolean) => Promise<void>;
}

function createTurn(text: string): HTMLElement {
  const turn = document.createElement('div');
  turn.setAttribute('data-testid', 'user-message');
  turn.textContent = text;
  return turn;
}

function addTurn(text: string): HTMLElement {
  const turn = createTurn(text);
  document.body.appendChild(turn);
  return turn;
}

function queryDots(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.timeline-dot'));
}

function dotLabels(): string[] {
  return queryDots().map((dot) => dot.getAttribute('aria-label') || '');
}

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

async function settleRefresh(): Promise<void> {
  await flush();
  vi.advanceTimersByTime(220);
  await flush();
}

describe('Claude timeline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    // Claude's thread container names the conversation every turn belongs to.
    document.body.setAttribute('data-conv-id', 'claude-123');
    history.replaceState({}, '', '/chat/claude-123');
    library.clear();
    getStarredMessagesForConversation
      .mockReset()
      .mockImplementation(async (conversationId: string) => library.get(conversationId) ?? []);
    addStarredMessage.mockReset().mockImplementation(async (message: StarredMessage) => {
      library.set(message.conversationId, [
        ...(library.get(message.conversationId) ?? []).filter(
          (stored) => stored.turnId !== message.turnId,
        ),
        message,
      ]);
    });
    removeStarredMessage
      .mockReset()
      .mockImplementation(async (conversationId: string, turnId: string) => {
        library.set(
          conversationId,
          (library.get(conversationId) ?? []).filter((stored) => stored.turnId !== turnId),
        );
      });
    requestPluginSetting.mockClear();
    showTimelineStyleCoachmark.mockClear();
    HTMLElement.prototype.scrollIntoView = vi.fn();
    window.scrollTo = vi.fn();
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });

  afterEach(async () => {
    document.body.removeAttribute('data-conv-id');
    await stopClaudeTimeline();
    vi.useRealTimers();
  });

  it('renders one dot per Claude user message, scrolls on click, and highlights active dot', async () => {
    addTurn('first prompt');
    addTurn('second prompt');

    startClaudeTimeline();
    await flush();

    const dots = queryDots();
    expect(dots).toHaveLength(2);

    dots[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(dots[0].classList.contains('active')).toBe(true);
    expect(dots[0].getAttribute('aria-current')).toBe('true');
  });

  it('shows the compact-view guide when the plugin starts for the first time', async () => {
    addTurn('first prompt');

    startClaudeTimeline({ compactView: false });
    await flush();

    expect(showTimelineStyleCoachmark).toHaveBeenCalledOnce();
    const options = showTimelineStyleCoachmark.mock
      .calls[0]![0] as CapturedTimelineCoachmarkOptions;
    expect(options.id).toBe('claude-timeline-compact-style-intro-v1');
    expect(options.enabled).toBe(false);

    await options.onStyleChange(true);

    expect(requestPluginSetting).toHaveBeenCalledWith(
      'voyager.claude-timeline',
      'compactView',
      true,
    );
    expect(
      document.querySelector('.gemini-timeline-bar')?.classList.contains('timeline-style-compact'),
    ).toBe(true);
  });

  it('suppresses the compact-view guide while an artifact iframe is open', async () => {
    addTurn('first prompt');
    const artifact = document.createElement('iframe');
    artifact.src = 'https://abc123.frame.claudeusercontent.com/artifact';
    document.body.appendChild(artifact);
    try {
      startClaudeTimeline({ compactView: false });
      await flush();

      expect(showTimelineStyleCoachmark).not.toHaveBeenCalled();
      // The timeline itself still runs — only the guide is suppressed.
      expect(document.querySelector('.gemini-timeline-bar')).toBeTruthy();
    } finally {
      artifact.remove();
    }
  });

  it('switches live between node and compact hover-panel views', async () => {
    addTurn('first prompt');
    addTurn('second prompt');
    addTurn('third prompt');

    startClaudeTimeline({ compactView: true });
    await flush();

    const bar = document.querySelector<HTMLElement>('.gemini-timeline-bar')!;
    expect(bar.classList.contains('timeline-style-compact')).toBe(true);
    expect(bar.querySelector('.timeline-track')?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('.timeline-preview-panel-compact')).toBeTruthy();

    bar.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.querySelector('.timeline-preview-panel')?.classList.contains('visible')).toBe(
      true,
    );

    updateClaudeTimelineSettings({ compactView: false });

    expect(bar.classList.contains('timeline-style-compact')).toBe(false);
    expect(bar.querySelector('.timeline-track')?.hasAttribute('aria-hidden')).toBe(false);
    expect(queryDots().every((dot) => dot.style.getPropertyValue('--n') !== '')).toBe(true);
    expect(document.querySelector('.timeline-preview-panel-compact')).toBeNull();
    expect(document.querySelector('.timeline-preview-panel')?.classList.contains('visible')).toBe(
      false,
    );
  });

  it('navigates a compact preview item without showing a tooltip', async () => {
    addTurn('first prompt');
    const second = addTurn('second prompt');
    second.getBoundingClientRect = vi.fn(() => ({ top: 700, bottom: 740, height: 40 }) as DOMRect);
    startClaudeTimeline({ compactView: true });
    await flush();

    const bar = document.querySelector<HTMLElement>('.gemini-timeline-bar')!;
    expect(bar.getAttribute('aria-expanded')).toBe('false');
    bar.dispatchEvent(new MouseEvent('mouseenter'));
    const items = document.querySelectorAll<HTMLElement>('.timeline-preview-item');
    items[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 450, behavior: 'smooth' });
    expect(document.getElementById('gemini-timeline-tooltip')?.classList.contains('visible')).toBe(
      false,
    );
  });

  it('updates active dot from the current viewport', async () => {
    const first = addTurn('first prompt');
    const second = addTurn('second prompt');
    const firstRect = vi.fn(() => ({ top: 0, bottom: 40, height: 40 }) as DOMRect);
    const secondRect = vi.fn(() => ({ top: 700, bottom: 740, height: 40 }) as DOMRect);
    first.getBoundingClientRect = firstRect;
    second.getBoundingClientRect = secondRect;
    startClaudeTimeline();
    await flush();

    const dots = queryDots();
    expect(dots[0].classList.contains('active')).toBe(true);
    firstRect.mockClear();
    secondRect.mockClear();

    Object.defineProperty(window, 'scrollY', { configurable: true, value: 500 });
    window.dispatchEvent(new Event('scroll'));

    expect(dots[1].classList.contains('active')).toBe(true);
    expect(firstRect).not.toHaveBeenCalled();
    expect(secondRect).not.toHaveBeenCalled();
  });

  it('activates the last dot when scrolled to the bottom', async () => {
    const first = addTurn('first prompt');
    const second = addTurn('second prompt');
    const third = addTurn('last prompt');
    first.getBoundingClientRect = vi.fn(() => ({ top: 0, bottom: 40, height: 40 }) as DOMRect);
    second.getBoundingClientRect = vi.fn(
      () => ({ top: 1580, bottom: 1620, height: 40 }) as DOMRect,
    );
    third.getBoundingClientRect = vi.fn(() => ({ top: 1950, bottom: 1990, height: 40 }) as DOMRect);
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 2000,
    });

    startClaudeTimeline();
    await flush();

    const dots = queryDots();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 1400 });
    window.dispatchEvent(new Event('scroll'));

    expect(dots[2].classList.contains('active')).toBe(true);
    expect(dots[1].classList.contains('active')).toBe(false);
  });

  it('keeps clicked dot active while the jump settles', async () => {
    const first = addTurn('first prompt');
    const second = addTurn('second prompt');
    first.getBoundingClientRect = vi.fn(() => ({ top: 0, bottom: 40, height: 40 }) as DOMRect);
    second.getBoundingClientRect = vi.fn(() => ({ top: 700, bottom: 740, height: 40 }) as DOMRect);

    startClaudeTimeline();
    await flush();

    const dots = queryDots();
    dots[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));

    Object.defineProperty(window, 'scrollY', { configurable: true, value: 500 });
    window.dispatchEvent(new Event('scroll'));

    expect(dots[0].classList.contains('active')).toBe(true);
    expect(dots[1].classList.contains('active')).toBe(false);
  });

  it('scrolls clicked markers to the active anchor', async () => {
    addTurn('first prompt');
    const second = addTurn('second prompt');
    second.getBoundingClientRect = vi.fn(() => ({ top: 700, bottom: 740, height: 40 }) as DOMRect);

    startClaudeTimeline();
    await flush();

    queryDots()[1].click();
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 450, behavior: 'smooth' });
  });

  it('jumps instantly when the reader asked for less motion', async () => {
    addTurn('first prompt');
    const second = addTurn('second prompt');
    second.getBoundingClientRect = vi.fn(() => ({ top: 700, bottom: 740, height: 40 }) as DOMRect);
    const media = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes('reduced-motion'),
      }) as MediaQueryList) as typeof window.matchMedia;

    try {
      startClaudeTimeline();
      await flush();

      queryDots()[1].click();
      expect(window.scrollTo).toHaveBeenCalledWith({ top: 450, behavior: 'instant' });
    } finally {
      window.matchMedia = media;
    }
  });

  it('long-presses a dot to star it', async () => {
    addTurn('remember this');
    startClaudeTimeline();
    await flush();

    const dot = queryDots()[0];
    dot.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(550);
    await flush();

    expect(addStarredMessage).toHaveBeenCalledTimes(1);
    expect(addStarredMessage).toHaveBeenCalledWith(
      expect.objectContaining({ turnId: buildTurnId('remember this') }),
    );
    expect(dot.classList.contains('starred')).toBe(true);
    expect(dot.getAttribute('aria-pressed')).toBe('true');
  });

  it('a starred prompt keeps the id stars saved by earlier versions carry', async () => {
    addTurn('remember this');
    startClaudeTimeline();
    await flush();

    queryDots()[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(550);
    await flush();

    // Literal on purpose: this id is the stored key of every existing Claude star.
    expect(addStarredMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'claude:conv:claude-123', turnId: 'c-o01tou' }),
    );
  });

  describe("with Claude's conversation id on the thread", () => {
    let scope: PluginScope | null = null;

    afterEach(async () => {
      await scope?.dispose();
      scope = null;
    });

    /** Start the timeline the way the plugin runtime does: the shipped manifest's op. */
    async function mount(): Promise<void> {
      const manifest = BUILTIN_PLUGINS.find((plugin) => plugin.id === 'voyager.claude-timeline');
      const op = manifest?.contributes.domOps?.find(
        (entry): entry is NativeOperation => entry.op === 'native',
      );
      const params = turnNavigatorPrimitive.validateParams(op?.params);
      if (!manifest || !params.success) throw new Error('invalid Claude timeline manifest');
      scope = new PluginScope();
      turnNavigatorPrimitive.activate(scope, params.data, {
        doc: document,
        adapter: requireBundledSiteAdapter('claude'),
        pluginId: manifest.id,
        settings: {},
        setTargetCounter: () => {},
      });
      await flush();
    }
    function thread(conversation: string | null): HTMLElement {
      const container = document.createElement('div');
      if (conversation) container.setAttribute('data-conv-id', conversation);
      document.body.appendChild(container);
      return container;
    }

    async function press(label: string): Promise<void> {
      const dot = queryDots().find((item) => item.getAttribute('aria-label') === label);
      dot?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(600);
      await flush();
    }

    /** Route watcher poll plus the refresh debounce. */
    async function settleRoute(): Promise<void> {
      await vi.advanceTimersByTimeAsync(600);
      await flush();
    }

    it('refuses a turn Claude files under another conversation, then stars it there', async () => {
      const container = thread('claude-123');
      container.appendChild(createTurn('first'));
      await mount();

      // Claude swaps the thread before the URL names the next conversation.
      container.setAttribute('data-conv-id', 'claude-456');
      container.replaceChildren(createTurn('other'));
      await settleRefresh();
      await press('other');
      expect(addStarredMessage).not.toHaveBeenCalled();

      history.pushState({}, '', '/chat/claude-456');
      await settleRoute();
      await press('other');
      expect(addStarredMessage).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: 'claude:conv:claude-456', content: 'other' }),
      );
    });

    it("stars a new chat's turn once Claude files it under the id in the URL", async () => {
      history.replaceState({}, '', '/new');
      const container = thread(null);
      container.appendChild(createTurn('brand new'));
      await mount();

      history.pushState({}, '', '/chat/claude-789');
      container.setAttribute('data-conv-id', 'claude-789');
      await settleRoute();
      await press('brand new');

      expect(addStarredMessage).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: 'claude:conv:claude-789', content: 'brand new' }),
      );
    });
  });

  it('long-presses a compact preview item to star without navigating', async () => {
    addTurn('remember compact item');
    startClaudeTimeline({ compactView: true });
    await flush();

    document
      .querySelector<HTMLElement>('.gemini-timeline-bar')!
      .dispatchEvent(new MouseEvent('mouseenter'));
    const item = document.querySelector<HTMLElement>('.timeline-preview-item')!;
    item.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 10,
        clientY: 10,
        isPrimary: true,
        pointerType: 'mouse',
      }),
    );
    vi.advanceTimersByTime(550);
    await flush();
    window.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, isPrimary: true, pointerType: 'mouse' }),
    );
    item.click();

    expect(addStarredMessage).toHaveBeenCalledWith(
      expect.objectContaining({ turnId: buildTurnId('remember compact item') }),
    );
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(document.querySelector('.timeline-preview-item')?.classList.contains('starred')).toBe(
      true,
    );
  });

  it('recognizes and unstars messages stored with the legacy index-based id', async () => {
    const legacyId = `c-0-${hashString('first prompt')}`;
    library.set('claude:conv:claude-123', [
      {
        turnId: legacyId,
        content: 'first prompt',
        conversationId: 'claude:conv:claude-123',
        conversationUrl: 'https://claude.ai/chat/claude-123',
        conversationTitle: 'test',
        starredAt: 111,
      },
    ]);
    addTurn('first prompt');
    startClaudeTimeline();
    await flush();

    const dot = queryDots()[0];
    expect(dot.classList.contains('starred')).toBe(true);

    dot.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(550);
    await flush();

    expect(removeStarredMessage).toHaveBeenCalledWith('claude:conv:claude-123', legacyId);
    expect(dot.classList.contains('starred')).toBe(false);
  });

  it('removes a legacy star from the compact preview without navigating', async () => {
    const legacyId = `c-0-${hashString('compact legacy prompt')}`;
    library.set('claude:conv:claude-123', [
      {
        turnId: legacyId,
        content: 'compact legacy prompt',
        conversationId: 'claude:conv:claude-123',
        conversationUrl: 'https://claude.ai/chat/claude-123',
        conversationTitle: 'test',
        starredAt: 111,
      },
    ]);
    addTurn('compact legacy prompt');
    startClaudeTimeline({ compactView: true });
    await flush();

    document
      .querySelector<HTMLElement>('.gemini-timeline-bar')!
      .dispatchEvent(new MouseEvent('mouseenter'));
    const item = document.querySelector<HTMLElement>('.timeline-preview-item')!;
    expect(item.classList.contains('starred')).toBe(true);
    item.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 10,
        clientY: 10,
        isPrimary: true,
        pointerType: 'mouse',
      }),
    );
    vi.advanceTimersByTime(550);
    await flush();
    window.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, isPrimary: true, pointerType: 'mouse' }),
    );
    item.click();

    expect(removeStarredMessage).toHaveBeenCalledWith('claude:conv:claude-123', legacyId);
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(document.querySelector('.timeline-preview-item')?.classList.contains('starred')).toBe(
      false,
    );
  });

  it('shows message content when hovering a dot', async () => {
    addTurn('hover preview text');
    startClaudeTimeline();
    await flush();

    const dot = queryDots()[0];
    dot.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    vi.advanceTimersByTime(300);

    const tooltip = document.querySelector<HTMLElement>('#gemini-timeline-tooltip')!;
    expect(tooltip.textContent).toContain('hover preview text');
    expect(tooltip.classList.contains('visible')).toBe(true);

    dot.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    vi.advanceTimersByTime(120);
    expect(tooltip.classList.contains('visible')).toBe(false);
  });

  it('keeps dots and ids stable when Claude virtualizes turns out during scroll', async () => {
    const first = addTurn('first prompt');
    addTurn('second prompt');
    startClaudeTimeline();
    await flush();
    expect(queryDots()).toHaveLength(2);
    const secondDotId = queryDots()[1].dataset.targetTurnId;

    // Scroll: Claude unmounts the first turn and mounts a newly visible one.
    first.remove();
    addTurn('third prompt');
    await settleRefresh();

    expect(dotLabels()).toEqual(['first prompt', 'second prompt', 'third prompt']);
    expect(queryDots()[1].dataset.targetTurnId).toBe(secondDotId);

    // Scrolling back re-mounts the first turn: nothing is duplicated.
    document.body.insertBefore(first, document.body.firstChild);
    await settleRefresh();
    expect(dotLabels()).toEqual(['first prompt', 'second prompt', 'third prompt']);
  });

  it('stitches older turns ahead of known ones when scrolling up', async () => {
    const third = addTurn('third prompt');
    const fourth = addTurn('fourth prompt');
    startClaudeTimeline();
    await flush();
    expect(queryDots()).toHaveLength(2);

    // Scrolling up: Claude mounts [first, second, third] and unmounts fourth.
    fourth.remove();
    document.body.insertBefore(createTurn('second prompt'), third);
    document.body.insertBefore(createTurn('first prompt'), third.previousSibling);
    await settleRefresh();

    expect(dotLabels()).toEqual(['first prompt', 'second prompt', 'third prompt', 'fourth prompt']);
  });

  it('files a remounted window of repeats past a turn measured before the page above shrank', async () => {
    // All fixture turns are visible; thousands of jsdom cascade reads obscure the merge behavior.
    const visibleStyle = getComputedStyle(document.body);
    const computedStyle = vi.spyOn(globalThis, 'getComputedStyle').mockReturnValue(visibleStyle);
    onTestFinished(() => computedStyle.mockRestore());
    const placeAt = (turn: HTMLElement, top: number): void => {
      turn.getBoundingClientRect = () => ({ top, bottom: top + 40, height: 40 }) as DOMRect;
    };
    // 700 identical prompts below a 100000px answer.
    const turns = Array.from({ length: 700 }, (_, index) => {
      const turn = addTurn('continue');
      placeAt(turn, 100_000 + 100 * index);
      return turn;
    });
    startClaudeTimeline();
    await flush();
    const ids = turns.map((turn) => turn.getAttribute('data-gv-turn-id'));
    expect(new Set(ids).size).toBe(700);

    // The answer collapses while turn 1 is virtualized out: only it keeps its old place.
    turns[1].remove();
    turns.forEach((turn, index) => placeAt(turn, 100 * index));
    document.body.appendChild(createTurn('marker'));
    await settleRefresh();

    // Claude remounts its thread; extension-owned UI stays outside that host subtree.
    document
      .querySelectorAll('[data-testid="user-message"]')
      .forEach((element) => element.remove());
    const window = Array.from({ length: 400 }, (_, r) => {
      const turn = addTurn('continue');
      placeAt(turn, 100 * (300 + r));
      return turn;
    });
    await settleRefresh();

    expect(window.map((turn) => turn.getAttribute('data-gv-turn-id'))).toEqual(ids.slice(300));
  });

  it('never shrinks when the mounted window turns sparse mid-transition', async () => {
    const turns = ['one', 'two', 'three', 'four', 'five'].map((text) => addTurn(text));
    startClaudeTimeline();
    await flush();
    expect(queryDots()).toHaveLength(5);

    // Jump from bottom to top: Claude briefly mounts a non-contiguous set
    // (top + bottom windows coexist) — the accumulated timeline must not drop
    // the unmounted turns in between.
    turns[1].remove();
    turns[2].remove();
    turns[3].remove();
    await settleRefresh();
    expect(dotLabels()).toEqual(['one', 'two', 'three', 'four', 'five']);

    // Turns re-mount as their region scrolls back in: still no duplicates.
    document.body.insertBefore(turns[2], turns[4]);
    await settleRefresh();
    expect(dotLabels()).toEqual(['one', 'two', 'three', 'four', 'five']);
  });

  it('keeps the opening turns ahead of the bottom window when Claude leaves the latest turn mounted', async () => {
    const rect = (top: number) => vi.fn(() => ({ top, bottom: top + 40, height: 40 }) as DOMRect);
    // Loaded at the bottom: only the last turns are mounted.
    const lateOne = addTurn('late one');
    const lateTwo = addTurn('late two');
    const last = addTurn('last prompt');
    lateOne.getBoundingClientRect = rect(38000);
    lateTwo.getBoundingClientRect = rect(38500);
    last.getBoundingClientRect = rect(39000);
    startClaudeTimeline();
    await flush();
    expect(dotLabels()).toEqual(['late one', 'late two', 'last prompt']);

    // Scrolled to the top: Claude mounts the opening turns, unmounts the late
    // ones, but keeps the latest turn mounted (and re-measured further down).
    lateOne.remove();
    lateTwo.remove();
    const first = createTurn('first prompt');
    const second = createTurn('second prompt');
    first.getBoundingClientRect = rect(100);
    second.getBoundingClientRect = rect(1200);
    document.body.insertBefore(second, last);
    document.body.insertBefore(first, second);
    last.getBoundingClientRect = rect(41600);
    await settleRefresh();

    expect(dotLabels()).toEqual([
      'first prompt',
      'second prompt',
      'late one',
      'late two',
      'last prompt',
    ]);
  });

  it('places a new turn by the drift of its nearer anchor when the two anchors drifted differently', async () => {
    const rect = (top: number) => vi.fn(() => ({ top, bottom: top + 40, height: 40 }) as DOMRect);
    const a = addTurn('turn a');
    const b = addTurn('turn b');
    const c = addTurn('turn c');
    const d = addTurn('turn d');
    a.getBoundingClientRect = rect(1000);
    b.getBoundingClientRect = rect(2000);
    c.getBoundingClientRect = rect(3000);
    d.getBoundingClientRect = rect(4000);
    startClaudeTimeline();
    await flush();

    // b and c unmount; a stays where it was, d is re-measured 2000px lower, and
    // a new turn x mounts between them at 2600. Under a's drift (0) x sits
    // after b; only under d's drift would it land before b.
    b.remove();
    c.remove();
    const x = createTurn('turn x');
    x.getBoundingClientRect = rect(2600);
    document.body.insertBefore(x, d);
    d.getBoundingClientRect = rect(6000);
    await settleRefresh();

    expect(dotLabels()).toEqual(['turn a', 'turn b', 'turn x', 'turn c', 'turn d']);
  });

  it('files a bottom window behind the known opening turns when the first turn stays mounted', async () => {
    const rect = (top: number) => vi.fn(() => ({ top, bottom: top + 40, height: 40 }) as DOMRect);
    const first = addTurn('first prompt');
    const second = addTurn('second prompt');
    const third = addTurn('third prompt');
    first.getBoundingClientRect = rect(100);
    second.getBoundingClientRect = rect(1200);
    third.getBoundingClientRect = rect(2300);
    startClaudeTimeline();
    await flush();

    second.remove();
    third.remove();
    const late = addTurn('late prompt');
    const last = addTurn('last prompt');
    late.getBoundingClientRect = rect(38000);
    last.getBoundingClientRect = rect(39000);
    await settleRefresh();

    expect(dotLabels()).toEqual([
      'first prompt',
      'second prompt',
      'third prompt',
      'late prompt',
      'last prompt',
    ]);
  });

  it('assigns distinct ids to turns with identical text', async () => {
    addTurn('same text');
    addTurn('same text');
    startClaudeTimeline();
    await flush();

    const ids = queryDots().map((dot) => dot.dataset.targetTurnId);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toBe(buildTurnId('same text'));
    expect(ids[1]).toBe(`${buildTurnId('same text')}~2`);
  });

  it('keeps homing toward a virtualized-out turn until it mounts, then aims precisely', async () => {
    const first = addTurn('first prompt');
    const second = addTurn('second prompt');
    first.getBoundingClientRect = vi.fn(() => ({ top: 0, bottom: 40, height: 40 }) as DOMRect);
    second.getBoundingClientRect = vi.fn(() => ({ top: 700, bottom: 740, height: 40 }) as DOMRect);
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 2000,
    });
    startClaudeTimeline();
    await flush();

    second.remove();
    await settleRefresh();
    expect(queryDots()).toHaveLength(2);

    // First hop jumps instantly to the remembered offset (center 720 → top 450).
    queryDots()[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 450, behavior: 'instant' });

    // Still unmounted after a hop interval: bisect further instead of giving up.
    vi.advanceTimersByTime(200);
    expect(window.scrollTo).toHaveBeenCalledTimes(2);
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 1030, behavior: 'instant' });

    // Turn mounts: the next hop aims precisely and stops.
    document.body.appendChild(second);
    await flush();
    vi.advanceTimersByTime(200);
    await flush();
    expect(window.scrollTo).toHaveBeenCalledTimes(3);
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 450, behavior: 'smooth' });

    vi.advanceTimersByTime(600);
    expect(window.scrollTo).toHaveBeenCalledTimes(3);
  });

  it('homes into a virtualization gap between mounted turns', async () => {
    const first = addTurn('first prompt');
    const second = addTurn('second prompt');
    const third = addTurn('third prompt');
    first.getBoundingClientRect = vi.fn(() => ({ top: 0, bottom: 40, height: 40 }) as DOMRect);
    second.getBoundingClientRect = vi.fn(() => ({ top: 700, bottom: 740, height: 40 }) as DOMRect);
    third.getBoundingClientRect = vi.fn(() => ({ top: 1300, bottom: 1340, height: 40 }) as DOMRect);
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 2000,
    });
    startClaudeTimeline();
    await flush();

    second.remove();
    await settleRefresh();
    expect(queryDots()).toHaveLength(3);

    // Target sits between two mounted turns: probe its remembered offset...
    queryDots()[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 450, behavior: 'instant' });

    // ...then bisect between the mounted neighbours instead of giving up.
    vi.advanceTimersByTime(200);
    expect(window.scrollTo).toHaveBeenCalledTimes(2);
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 400, behavior: 'instant' });

    document.body.insertBefore(second, third);
    await flush();
    vi.advanceTimersByTime(200);
    await flush();
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 450, behavior: 'smooth' });
  });

  it('glides a long jump to a mounted turn, then fine-aims once it settles', async () => {
    const first = addTurn('first prompt');
    const second = addTurn('second prompt');
    first.getBoundingClientRect = vi.fn(() => ({ top: 0, bottom: 40, height: 40 }) as DOMRect);
    second.getBoundingClientRect = vi.fn(
      () => ({ top: 5000, bottom: 5040, height: 40 }) as DOMRect,
    );
    startClaudeTimeline();
    await flush();

    // Distance > 3 viewports: glide, then fine-aim once the region re-measures.
    queryDots()[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 4750, behavior: 'smooth' });

    // The homing hop must not fire into a scroll that is still moving, so it
    // waits for two identical reads (2 x 80ms) before its own 200ms.
    vi.advanceTimersByTime(200);
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200);
    expect(window.scrollTo).toHaveBeenCalledTimes(2);
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 4750, behavior: 'smooth' });

    vi.advanceTimersByTime(600);
    expect(window.scrollTo).toHaveBeenCalledTimes(2);
  });

  it('stops homing when the user scrolls manually', async () => {
    const first = addTurn('first prompt');
    const second = addTurn('second prompt');
    first.getBoundingClientRect = vi.fn(() => ({ top: 0, bottom: 40, height: 40 }) as DOMRect);
    second.getBoundingClientRect = vi.fn(() => ({ top: 700, bottom: 740, height: 40 }) as DOMRect);
    startClaudeTimeline();
    await flush();

    second.remove();
    await settleRefresh();

    queryDots()[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(window.scrollTo).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('wheel'));
    vi.advanceTimersByTime(1000);
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
  });

  it('consumes a gv-turn hash once instead of re-navigating on every refresh', async () => {
    addTurn('first prompt');
    const second = addTurn('second prompt');
    second.getBoundingClientRect = vi.fn(() => ({ top: 700, bottom: 740, height: 40 }) as DOMRect);
    const legacyHashId = `c-1-${hashString('second prompt')}`;
    history.replaceState({}, '', `/chat/claude-123#gv-turn-${legacyHashId}`);

    startClaudeTimeline();
    await flush();

    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 450, behavior: 'smooth' });

    addTurn('third prompt');
    await settleRefresh();
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
  });

  it('keeps existing dots on unrelated DOM changes', async () => {
    addTurn('first prompt');
    startClaudeTimeline();
    await flush();
    const dot = queryDots()[0];

    document.body.appendChild(document.createElement('main'));
    await settleRefresh();

    expect(queryDots()[0]).toBe(dot);
  });

  it('rolls back data-gv-turn-id stamps on stop', async () => {
    addTurn('first prompt');
    startClaudeTimeline();
    await flush();
    expect(document.querySelectorAll('[data-gv-turn-id]').length).toBeGreaterThan(0);

    await stopClaudeTimeline();
    expect(document.querySelectorAll('[data-gv-turn-id]').length).toBe(0);
  });

  it('removes UI on stop', async () => {
    addTurn('first prompt');
    startClaudeTimeline();
    await flush();
    expect(document.querySelector('.gemini-timeline-bar')).toBeTruthy();

    await stopClaudeTimeline();
    expect(document.querySelector('.gemini-timeline-bar')).toBeNull();
    expect(document.querySelector('.timeline-preview-toggle')).toBeNull();
    expect(document.querySelector('#gv-turn-navigator-tooltip')).toBeNull();
  });
});
