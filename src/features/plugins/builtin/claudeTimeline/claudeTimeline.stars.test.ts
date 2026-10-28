import './__tests__/claudeTimelineHarness';
/** Starring Claude prompts from dots and the compact preview, including legacy ids. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hashString } from '@/core/utils/hash';
import { buildTurnId } from '@/features/timeline/adapters/catalog/turnMerge';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { PluginScope } from '../../runtime/pluginScope';
import type { NativeOperation } from '../../types';
import { turnNavigatorPrimitive } from '../../verbs/turnNavigator';
import { BUILTIN_PLUGINS } from '../index';
import {
  library,
  startClaudeTimeline,
  createTurn,
  addTurn,
  queryDots,
  flush,
  settleRefresh,
  addStarredMessage,
  removeStarredMessage,
  useClaudeTimelinePage,
} from './__tests__/claudeTimelineHarness';

describe('Claude timeline', () => {
  useClaudeTimelinePage();

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
});
