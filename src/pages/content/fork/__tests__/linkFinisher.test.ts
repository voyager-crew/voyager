import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '@/core/services/LoggerService';
import { capturePageIdentity } from '@/pages/content/selectionToolbar/pageIdentity';

import { installGeminiTurnPatch } from '../../__tests__/geminiOnlineTurnFixture';
import { ForkNodesService } from '../ForkNodesService';
import type { PendingForkData } from '../forkLaunch';
import { handoffPendingForkLink, startForkLinkFinisher } from '../linkFinisher';

const key = vi.hoisted(() => ({ value: 'host' as 'host' | 'ctrlEnter' }));
vi.mock('@/core/services/composer/sendKeys/sendKeyCoordinator', () => ({
  getSendKeyCoordinator: () => ({ effectiveSendKey: () => key.value }),
}));

describe('the page-owned fork first-send finisher', () => {
  let stopCore: () => void;
  let stopSelectors: (() => void) | undefined;
  let linked: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let finished: ReturnType<typeof vi.fn<() => void>>;
  let pending: PendingForkData;
  const input = () => document.querySelector<HTMLElement>('#input')!;
  const button = () => document.querySelector<HTMLButtonElement>('#send')!;
  const flush = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  const go = (path: string) => {
    history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };
  const sentTurn = (text = 'First request', id = 'b7603911375615a5') => {
    const turn = document.createElement('div');
    turn.className = 'conversation-container';
    turn.id = id;
    const bubble = document.createElement('div');
    bubble.className = 'user-query-bubble-with-background';
    bubble.textContent = text;
    turn.append(bubble);
    document.querySelector('main')!.append(turn);
    return turn;
  };
  const handoff = (remaining = 60000) =>
    handoffPendingForkLink({
      pendingFork: pending,
      receiver: capturePageIdentity(),
      deadline: Date.now() + remaining,
      getConversationTitle: () => document.title,
      onLinked: linked,
      onFinished: finished,
    })!;
  const send = () => button().click();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
    key.value = 'host';
    history.replaceState({}, '', '/app');
    document.title = 'New branch';
    document.body.innerHTML =
      '<header data-email="first@example.com"></header><main></main>' +
      '<div class="text-input-field"><rich-textarea><div id="input" contenteditable="true">First request</div></rich-textarea>' +
      '<button id="send" aria-label="Send"><span>Send</span></button></div>';
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      height: 24,
    } as DOMRect);
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body);
    vi.spyOn(ForkNodesService, 'addForkNode').mockResolvedValue(true);
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    linked = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    finished = vi.fn<() => void>();
    pending = {
      sourceConversationId: 'source',
      sourceTurnId: 's-1111111111111111',
      sourceUrl: `${location.origin}/app/source`,
      sourceTitle: 'Source',
      forkGroupId: 'group',
      sourceForkIndex: 0,
      nextForkIndex: 1,
      markdown: 'Context',
      mode: 'paste',
      createdAt: Date.now(),
    };
    stopCore = startForkLinkFinisher();
  });

  afterEach(() => {
    stopCore();
    stopSelectors?.();
    stopSelectors = undefined;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('does not link a sidebar conversation without a send and releases the watcher', async () => {
    handoff();
    go('/app/existing');
    sentTurn();
    await flush();
    expect(ForkNodesService.addForkNode).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(finished).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['slot', 'email', 'Gem'])('abandons a handoff when its %s changes', async (change) => {
    if (change === 'Gem') history.replaceState({}, '', '/gem/custom');
    handoff();
    send();
    if (change === 'email')
      document.querySelector('header')!.setAttribute('data-email', 'other@example.com');
    go(
      change === 'slot'
        ? '/u/1/app/branch'
        : change === 'Gem'
          ? '/gem/another/branch'
          : '/app/branch',
    );
    sentTurn();
    await flush();
    expect(ForkNodesService.addForkNode).not.toHaveBeenCalled();
    expect(finished).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pins the first destination before its DOM arrives and refuses the second conversation', async () => {
    handoff();
    send();
    go('/app/first');
    expect(ForkNodesService.addForkNode).not.toHaveBeenCalled();
    go('/app/second');
    sentTurn();
    await flush();
    expect(ForkNodesService.addForkNode).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not revive the first destination after leaving it for the new-chat page', async () => {
    handoff();
    send();
    go('/app/first');
    go('/app');
    go('/app/first');
    sentTurn();
    await flush();
    expect(ForkNodesService.addForkNode).not.toHaveBeenCalled();
    expect(finished).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('links the delayed first user turn after the next draft starts and ignores a redrawn old turn', async () => {
    const old = sentTurn();
    handoff();
    send();
    input().textContent = '';
    go('/app/branch');
    await flush();
    expect(ForkNodesService.addForkNode).not.toHaveBeenCalled();
    old.remove();
    const redrawnOld = sentTurn();
    await flush();
    expect(ForkNodesService.addForkNode).not.toHaveBeenCalled();
    redrawnOld.remove();
    input().textContent = 'My next draft';
    input().dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    expect(ForkNodesService.addForkNode).not.toHaveBeenCalled();
    sentTurn('An unrelated question', '2222222222222222');
    await flush();
    expect(ForkNodesService.addForkNode).not.toHaveBeenCalled();
    sentTurn('First request', '3333333333333333');
    await flush();
    expect(ForkNodesService.addForkNode).toHaveBeenCalledTimes(2);
  });

  it('records the first user server id so the new branch appears before history aliases arrive', async () => {
    handoff();
    send();
    go('/app/branch');
    sentTurn();
    await flush();
    expect(ForkNodesService.addForkNode).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        conversationId: 'branch',
        turnId: 's-b7603911375615a5',
        conversationTitle: 'New branch',
      }),
    );
    expect(linked).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the legacy first-turn fallback when Gemini exposes no server id', async () => {
    handoff();
    send();
    go('/app/branch');
    sentTurn('First request', '');
    await flush();
    expect(ForkNodesService.addForkNode).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ turnId: 'u-0' }),
    );
  });

  it.each(['online host', 'bundled fallback'])(
    'links the same account-scoped first-send server id using the %s',
    async (kind) => {
      stopSelectors = await installGeminiTurnPatch({
        'turn.userWithHosts': [kind === 'online host' ? '.online-user' : '.missing-user'],
      });
      history.replaceState({}, '', '/u/1/app');
      handoff();
      send();
      go('/u/1/app/branch');
      const container = sentTurn();
      if (kind === 'online host') container.firstElementChild!.className = 'online-user';
      await flush();

      expect(ForkNodesService.addForkNode).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          turnId: 's-b7603911375615a5',
          conversationId: 'branch',
          conversationUrl: `${location.origin}/u/1/app/branch`,
        }),
      );
      expect(linked).toHaveBeenCalledOnce();
    },
  );

  it('does not link an earlier identical prompt that only the bundled profile would find', async () => {
    stopSelectors = await installGeminiTurnPatch({ 'turn.userWithHosts': ['.online-host'] });
    // An earlier turn with the same text and no server id, matched online by its host element.
    const earlier = document.createElement('div');
    earlier.className = 'online-host';
    const bubble = document.createElement('div');
    bubble.className = 'user-query-bubble-with-background';
    bubble.textContent = 'First request';
    earlier.append(bubble);
    document.querySelector('main')!.append(earlier);
    handoff();
    send();
    go('/app/branch');
    await flush();
    expect(ForkNodesService.addForkNode).not.toHaveBeenCalled();

    sentTurn().classList.add('online-host');
    await flush();
    expect(ForkNodesService.addForkNode).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ turnId: 's-b7603911375615a5', conversationId: 'branch' }),
    );
  });

  it('links the default account even when Gemini adds its explicit u/0 route', async () => {
    handoff();
    go('/u/0/app');
    send();
    go('/u/0/app/branch');
    sentTurn();
    await flush();
    expect(ForkNodesService.addForkNode).toHaveBeenCalledTimes(2);
  });

  it.each(['IME', '229', 'Stop', 'upload', 'edit', 'dialog', 'plain in ctrl mode'])(
    'does not count %s as a main-composer send',
    async (invalid) => {
      handoff();
      if (invalid === 'Stop') button().setAttribute('aria-label', 'Stop');
      if (invalid === 'upload') button().parentElement!.append(document.createElement('progress'));
      if (invalid === 'edit') input().closest('rich-textarea')!.className = 'edit-container';
      if (invalid === 'dialog') input().closest('rich-textarea')!.setAttribute('role', 'dialog');
      if (invalid === 'plain in ctrl mode') key.value = 'ctrlEnter';
      input().dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          isComposing: invalid === 'IME',
          keyCode: invalid === '229' ? 229 : 13,
        }),
      );
      go('/app/branch');
      sentTurn();
      await flush();
      expect(ForkNodesService.addForkNode).not.toHaveBeenCalled();
    },
  );

  it('uses the effective Ctrl+Enter key and can link even when the response is stopped', async () => {
    key.value = 'ctrlEnter';
    handoff();
    input().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
    );
    go('/app/branch');
    button().setAttribute('aria-label', 'Stop');
    sentTurn();
    await flush();
    expect(ForkNodesService.addForkNode).toHaveBeenCalledTimes(2);
  });

  it('ignores sidebar navigation after a send attempt instead of linking an existing chat', async () => {
    handoff();
    send();
    const link = document.createElement('a');
    link.href = '/app/existing';
    document.body.append(link);
    link.addEventListener('click', (event) => event.preventDefault());
    link.click();
    go('/app/existing');
    sentTurn();
    await flush();
    expect(ForkNodesService.addForkNode).not.toHaveBeenCalled();
  });

  it.each(['download', 'new tab', 'external'] as const)(
    'keeps the handoff after a %s link and still accepts the first send',
    async (kind) => {
      handoff();
      const link = document.createElement('a');
      link.href = kind === 'external' ? 'https://example.com/help' : '/file.md';
      if (kind === 'download') link.download = 'file.md';
      if (kind === 'new tab') link.target = '_blank';
      link.addEventListener('click', (event) => event.preventDefault());
      document.body.append(link);
      link.click();
      send();
      go('/app/branch');
      sentTurn();
      await flush();
      expect(ForkNodesService.addForkNode).toHaveBeenCalledTimes(2);
    },
  );

  it('abandons a waiting link on page teardown and an old owner cannot stop its successor', async () => {
    handoff();
    send();
    stopCore();
    go('/app/branch');
    sentTurn();
    await flush();
    expect(ForkNodesService.addForkNode).not.toHaveBeenCalled();
    history.replaceState({}, '', '/app');
    const stopOld = stopCore;
    stopCore = startForkLinkFinisher();
    handoff();
    stopOld();
    send();
    go('/app/next');
    sentTurn('First request', '4444444444444444');
    await flush();
    expect(ForkNodesService.addForkNode).toHaveBeenCalledTimes(2);
  });

  it.each(['feature', 'page'])(
    'writes the captured pair when %s stops between the writes',
    async (stop) => {
      let release!: (value: boolean) => void;
      vi.mocked(ForkNodesService.addForkNode).mockReturnValueOnce(
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
      );
      const receipt = handoff();
      send();
      go('/app/branch');
      sentTurn();
      await flush();
      expect(ForkNodesService.addForkNode).toHaveBeenCalledTimes(1);
      if (stop === 'feature') receipt.hideUi();
      else stopCore();
      document.title = 'Another conversation';
      go('/u/2/app/unrelated');
      release(true);
      await flush();
      expect(ForkNodesService.addForkNode).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          conversationId: 'branch',
          conversationTitle: 'New branch',
          conversationUrl: `${location.origin}/app/branch`,
        }),
      );
      expect(linked).not.toHaveBeenCalled();
    },
  );

  it('keeps the original deadline and releases every wait when it expires', async () => {
    const receipt = handoff(1000);
    send();
    receipt.hideUi();
    await vi.advanceTimersByTimeAsync(1000);
    go('/app/too-late');
    sentTurn();
    await flush();
    expect(ForkNodesService.addForkNode).not.toHaveBeenCalled();
    expect(finished).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
