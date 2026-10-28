import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '@/core/services/LoggerService';
import { confirmDriver } from '@/tests/confirmDriver';
import { watchFullPageLoads } from '@/tests/pageUrl';

import { ForkNodesService } from '../ForkNodesService';
import { collectForkChatPairs } from '../chatPairs';
import { createForkIndicators } from '../forkIndicators';
import type { ForkNode } from '../forkTypes';

vi.mock('../ForkNodesService', () => ({
  ForkNodesService: {
    getForConversation: vi.fn(),
    getGroup: vi.fn(),
    removeForkNode: vi.fn(),
  },
}));
vi.mock('../chatPairs', () => ({ collectForkChatPairs: vi.fn() }));

function appendNativeLink(href: string): HTMLAnchorElement {
  const sidebar = document.createElement('conversations-list');
  sidebar.setAttribute('data-test-id', 'all-conversations');
  const row = document.createElement('gem-nav-list-item');
  row.setAttribute('data-test-id', 'conversation');
  const link = document.createElement('a');
  link.className = 'gem-nav-list-item';
  link.href = href;
  row.appendChild(link);
  sidebar.appendChild(row);
  document.body.appendChild(sidebar);
  return link;
}

describe('fork indicators', () => {
  let indicators: ReturnType<typeof createForkIndicators>;
  let source: ForkNode;
  let branch: ForkNode;
  let sequence = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // jsdom rejects Vitest's window proxy in view; omit only that realm field.
    const NativeMouseEvent = MouseEvent;
    vi.stubGlobal(
      'MouseEvent',
      class extends NativeMouseEvent {
        constructor(type: string, options?: MouseEventInit) {
          super(type, { ...options, view: null });
        }
      },
    );
    sequence += 1;
    window.history.replaceState({}, '', `/app/source-${sequence}`);
    source = {
      conversationId: `source-${sequence}`,
      conversationUrl: `${window.location.origin}/app/source-${sequence}`,
      conversationTitle: 'Source',
      turnId: 's-1111111111111111',
      forkGroupId: `group-${sequence}`,
      forkIndex: 0,
      createdAt: 1,
    };
    branch = {
      ...source,
      conversationId: `branch-${sequence}`,
      conversationUrl: `${window.location.origin}/app/branch-${sequence}`,
      forkIndex: 1,
    };
    document.body.innerHTML = '<div id="user">A turn</div>';
    const userElement = document.querySelector<HTMLElement>('#user')!;
    vi.mocked(collectForkChatPairs).mockReturnValue([
      { turnId: source.turnId, user: 'A turn', assistant: '', userElement },
    ]);
    vi.mocked(ForkNodesService.getForConversation).mockResolvedValue([source]);
    vi.mocked(ForkNodesService.getGroup).mockResolvedValue([source, branch]);
    vi.mocked(ForkNodesService.removeForkNode).mockResolvedValue(true);
    indicators = createForkIndicators({
      getConversationId: () => source.conversationId,
      resolveTurnId: (turnId) => turnId,
      ensureTurnId: () => source.turnId,
      resolveUserMessageHost: (element) => element,
    });
  });

  afterEach(() => {
    indicators.stop();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('keeps a branch when verification fails instead of deleting its data', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CSP blocked'));
    await indicators.inject();

    expect(document.querySelectorAll('.gv-fork-indicator')).toHaveLength(2);
    expect(ForkNodesService.removeForkNode).not.toHaveBeenCalled();
    const current = document.querySelector<HTMLButtonElement>('.gv-current')!;
    expect(current.disabled).toBe(true);
    expect(current.getAttribute('aria-current')).toBe('true');
  });

  it('prunes a branch whose URL redirects to a different conversation', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      url: 'https://gemini.google.com/app/different',
    } as Response);
    await indicators.inject();

    expect(ForkNodesService.removeForkNode).toHaveBeenCalledWith(
      branch.conversationId,
      branch.turnId,
      branch.forkGroupId,
    );
    expect(document.querySelector('.gv-fork-indicator-group')).toBeNull();
  });

  it('uses native sidebar events and reuses successful existence checks across a stop', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      url: branch.conversationUrl,
    } as Response);
    await indicators.inject();
    indicators.stop();
    indicators = createForkIndicators({
      getConversationId: () => source.conversationId,
      resolveTurnId: (turnId) => turnId,
      ensureTurnId: () => source.turnId,
      resolveUserMessageHost: (element) => element,
    });
    await indicators.inject();
    expect(fetch).toHaveBeenCalledOnce();

    const link = appendNativeLink(branch.conversationUrl);
    const events: string[] = [];
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      link.addEventListener(type, (event) => {
        events.push(type);
        event.preventDefault();
        if (type === 'click') window.history.pushState({}, '', link.pathname);
      });
    }
    document.querySelectorAll<HTMLButtonElement>('.gv-fork-indicator')[1].click();
    expect(events).toEqual(['pointerdown', 'mousedown', 'mouseup', 'click']);
    expect(window.location.pathname).toBe(`/app/${branch.conversationId}`);
  });

  it('opens a fork through the router without reloading when its native sidebar row is absent', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await indicators.inject();
    const user = document.querySelector('#user')!;
    const routed: string[] = [];
    const onRoute = () => {
      routed.push(window.location.pathname);
      user.setAttribute('data-rendered-conversation', window.location.pathname);
    };
    window.addEventListener('popstate', onRoute, { once: true });

    document.querySelectorAll<HTMLButtonElement>('.gv-fork-indicator')[1].click();

    expect(routed).toEqual([`/app/${branch.conversationId}`]);
    expect(document.querySelector('#user')).toBe(user);
    expect(user.getAttribute('data-rendered-conversation')).toBe(`/app/${branch.conversationId}`);
  });

  it.each([
    ['missing URL', ''],
    ['external URL', 'https://other.example/u/2/gem/external-gem/{id}'],
    ['malformed URL', 'http://['],
    ['different conversation URL', '/u/2/app/other-conversation'],
  ])('keeps the current account when a fork has a %s', async (_label, savedUrl) => {
    window.history.replaceState({}, '', `/u/1/app/${source.conversationId}`);
    branch.conversationUrl = savedUrl.replace('{id}', branch.conversationId);
    const link = appendNativeLink(`/u/1/app/${branch.conversationId}`);
    await indicators.inject();
    // The host virtualizes the previously visible native row before navigation.
    link.closest('conversations-list')!.remove();
    document.querySelectorAll<HTMLButtonElement>('.gv-fork-indicator')[1].click();
    expect(window.location.pathname).toBe(`/u/1/app/${branch.conversationId}`);
    expect(window.location.origin).toBe(new URL(source.conversationUrl).origin);
  });

  it('keeps a saved Gem route in the current account instead of returning to its old account', async () => {
    window.history.replaceState({}, '', `/u/1/app/${source.conversationId}`);
    branch.conversationUrl = `${window.location.origin}/u/2/gem/my-gem/${branch.conversationId}?hl=en#turn`;
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await indicators.inject();
    document.querySelectorAll<HTMLButtonElement>('.gv-fork-indicator')[1].click();
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      `/u/1/gem/my-gem/${branch.conversationId}?hl=en#turn`,
    );
  });

  it.each([
    'outside sidebar',
    'other origin',
    'other account',
    'wrong conversation',
    'malformed URL',
    'wrong Gem',
  ])('ignores a fork link with %s instead of misrouting the native click', async (mismatch) => {
    window.history.replaceState({}, '', `/u/1/app/${source.conversationId}`);
    branch.conversationUrl = `${window.location.origin}/u/1/gem/right-gem/${branch.conversationId}`;
    const href =
      mismatch === 'other origin'
        ? `https://other.example/u/1/gem/right-gem/${branch.conversationId}`
        : mismatch === 'other account'
          ? `/u/2/gem/right-gem/${branch.conversationId}`
          : mismatch === 'wrong conversation'
            ? '/u/1/gem/right-gem/other-conversation'
            : mismatch === 'malformed URL'
              ? 'http://['
              : mismatch === 'wrong Gem'
                ? `/u/1/gem/other-gem/${branch.conversationId}`
                : `/u/1/gem/right-gem/${branch.conversationId}`;
    const link = appendNativeLink(href);
    if (mismatch === 'outside sidebar') document.body.appendChild(link.parentElement!);
    const clicked = vi.fn((event: Event) => event.preventDefault());
    link.addEventListener('click', clicked);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await indicators.inject();
    document.querySelectorAll<HTMLButtonElement>('.gv-fork-indicator')[1].click();
    expect(clicked).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(`/u/1/gem/right-gem/${branch.conversationId}`);
  });

  it('keeps the page and its fork buttons when the router rejects navigation', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await indicators.inject();
    const user = document.querySelector('#user');
    const warning = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const hardNavigation = watchFullPageLoads();
    vi.spyOn(window.history, 'pushState').mockImplementation(() => {
      throw new DOMException('Navigation rejected', 'SecurityError');
    });
    document.querySelectorAll<HTMLButtonElement>('.gv-fork-indicator')[1].click();
    expect(document.querySelector('#user')).toBe(user);
    expect(document.querySelectorAll('.gv-fork-indicator')).toHaveLength(2);
    expect(warning).toHaveBeenCalledOnce();
    expect(hardNavigation).not.toHaveBeenCalled();
  });

  it('removes a branch link only after the user confirms', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await indicators.inject();
    const deleteBranch = () =>
      document.querySelectorAll<HTMLButtonElement>('.gv-fork-indicator-delete')[1].click();

    deleteBranch();
    expect(confirmDriver.message()).toContain('Delete this branch link?');
    confirmDriver.answer('Cancel');
    await vi.advanceTimersByTimeAsync(0);
    expect(ForkNodesService.removeForkNode).not.toHaveBeenCalled();

    deleteBranch();
    confirmDriver.answer('Delete');
    await vi.advanceTimersByTimeAsync(0);
    expect(ForkNodesService.removeForkNode).toHaveBeenCalledWith(
      branch.conversationId,
      branch.turnId,
      branch.forkGroupId,
    );
  });

  it('keeps a branch link when the conversation changes while its delete confirm is open', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await indicators.inject();

    document.querySelectorAll<HTMLButtonElement>('.gv-fork-indicator-delete')[1].click();
    source.conversationId = 'another-conversation';
    confirmDriver.answer('Delete');
    await vi.advanceTimersByTimeAsync(0);

    expect(ForkNodesService.removeForkNode).not.toHaveBeenCalled();
  });

  it('closes an open delete confirm when stopped', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await indicators.inject();

    document.querySelectorAll<HTMLButtonElement>('.gv-fork-indicator-delete')[1].click();
    indicators.stop();
    await vi.advanceTimersByTimeAsync(0);

    expect(confirmDriver.isOpen()).toBe(false);
    expect(ForkNodesService.removeForkNode).not.toHaveBeenCalled();
  });

  it('cancels a queued storage refresh when stopped', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await indicators.inject();
    indicators.refresh();
    indicators.stop();
    await vi.advanceTimersByTimeAsync(500);

    expect(document.querySelector('.gv-fork-indicator-group')).toBeNull();
    expect(ForkNodesService.getForConversation).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
