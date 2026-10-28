import './__tests__/chatgptTimelineHarness';
/** The ChatGPT timeline's rail: its dots, navigation and scrolling, live updates and teardown. */
import { describe, expect, it, vi } from 'vitest';

import { buildTurnId } from '@/features/timeline/adapters/catalog/turnMerge';

import { requireBundledSiteAdapter } from '../catalog/sites';
import {
  ROUTE_SETTLE_MS,
  scope,
  thread,
  targetCount,
  mount,
  settle,
  exchange,
  bubble,
  starred,
  notifyStars,
  longPress,
  dots,
  labels,
  rect,
  makeScroller,
  starStore,
  getStarredMessagesForConversation,
} from './__tests__/chatgptTimelineHarness';

describe('ChatGPT timeline', () => {
  it('shows and navigates live bubbles and older turns without duplicates', async () => {
    const scroller = makeScroller();
    for (const prompt of [
      'First question',
      'Second question',
      'Third question',
      'Fourth question',
    ]) {
      exchange(prompt);
    }
    bubble(thread.lastElementChild as HTMLElement).getBoundingClientRect = rect(700);
    await mount();

    expect(labels()).toEqual([
      'First question',
      'Second question',
      'Third question',
      'Fourth question',
    ]);
    expect(targetCount()).toBe(4);
    dots()[3].click();
    expect(scroller.scrollTo).toHaveBeenLastCalledWith({ top: 450, behavior: 'smooth' });
    expect(dots()[3].getAttribute('aria-current')).toBe('true');

    // Older pages expose only author-role; transitional pages may expose both.
    const legacy = document.createElement('section');
    legacy.setAttribute('data-testid', 'conversation-turn-5');
    legacy.innerHTML = '<div data-message-author-role="user">Older question</div>';
    const prompt = legacy.firstElementChild as HTMLElement;
    prompt.getBoundingClientRect = rect(900);
    thread.append(legacy);
    bubble(thread.firstElementChild as HTMLElement).parentElement!.setAttribute(
      'data-message-author-role',
      'user',
    );
    bubble(thread.children[1] as HTMLElement).setAttribute('data-message-author-role', 'user');
    await settle();

    expect(labels()).toEqual([
      'First question',
      'Second question',
      'Third question',
      'Fourth question',
      'Older question',
    ]);
    expect(targetCount()).toBe(5);
    dots()[4].click();
    expect(scroller.scrollTo).toHaveBeenLastCalledWith({ top: 650, behavior: 'smooth' });
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('uses the remote adapter userTurn to select and navigate prompts', async () => {
    const scroller = makeScroller();
    exchange('Not selected by the remote adapter');
    const selected = bubble(exchange('Remote-selected prompt'));
    selected.classList.add('remote-user-turn');
    selected.getBoundingClientRect = rect(700);
    const adapter = requireBundledSiteAdapter('chatgpt');
    // The runtime passes the resolved remote adapter to the builtin primitive.
    await mount({
      ...adapter,
      selectors: { ...adapter.selectors, userTurn: '.remote-user-turn' },
    });

    expect(labels()).toEqual(['Remote-selected prompt']);
    expect(targetCount()).toBe(1);
    dots()[0].click();
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 450, behavior: 'smooth' });
    expect(dots()[0].getAttribute('aria-current')).toBe('true');
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('marks every prompt, skips replies, and files stars under chatgpt with the loaded account', async () => {
    document.documentElement.setAttribute('data-theme-user-id', 'user-account-a');
    document.documentElement.setAttribute('data-theme-account-id', 'workspace-a');
    exchange('First question');
    exchange('Second question');

    await mount();

    expect(document.querySelectorAll('[data-gv-turn-navigator="chatgpt"]')).toHaveLength(1);
    // Account hashing uses real WebCrypto work, which advancing fake timers does not await.
    await vi.waitFor(() => expect(labels()).toEqual(['First question', 'Second question']));
    expect(targetCount()).toBe(2);
    expect(getStarredMessagesForConversation).toHaveBeenLastCalledWith('chatgpt:conv:first');

    await longPress(dots()[1]);
    await vi.waitFor(() =>
      expect(starStore.get('chatgpt:conv:first')?.[0].account).toBe(
        'chatgpt:ab894c1ca59dbaea95295fae9a616794d31cffbfdf53b53649933ca4842b5bca',
      ),
    );
    expect(starred('chatgpt:conv:first')).toEqual(['Second question']);
  });

  it('a starred prompt keeps the id stars saved by earlier versions carry', async () => {
    exchange('First question');
    exchange('Second question');
    await mount();

    await longPress(dots()[1]);

    // Literal on purpose: this id is the stored key of every existing ChatGPT star.
    await vi.waitFor(() =>
      expect(starStore.get('chatgpt:conv:first')?.map((message) => message.turnId)).toEqual([
        'c-wxhcs3',
      ]),
    );
  });

  it('scrolls the conversation container, not the window, when a dot is clicked', async () => {
    const scroller = makeScroller();
    exchange('Opening question');
    bubble(exchange('Jump here')).getBoundingClientRect = rect(700);
    await mount();

    dots()[1].click();

    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 450, behavior: 'smooth' });
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(dots()[1].getAttribute('aria-current')).toBe('true');
  });

  it('jumps through a column-reverse thread, whose offsets run negative from the newest turn', async () => {
    const scroller = makeScroller({ reverse: true });
    // Resting at scrollTop 0 shows the last 600px of 2000, so the view starts
    // 1400px in. This 40px turn starts 640px above that edge: its centre is
    // 1400 - 640 + 20 = 780px into the conversation.
    bubble(exchange('Older question')).getBoundingClientRect = rect(-640);
    exchange('Newest question');
    await mount();

    dots()[0].click();

    // Centre at 45% of the view: 780 - 0.45 * 600 = 510 from the start, which
    // a column-reverse scroller counts as 510 - 1400.
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: -890, behavior: 'smooth' });
  });

  it('treats a normal scroller in rubber-band overscroll as a normal scroller', async () => {
    const scroller = makeScroller();
    // Safari reports a negative scrollTop while bouncing past the top edge.
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, value: -20 });
    exchange('Opening question');
    bubble(exchange('Jump here')).getBoundingClientRect = rect(700);
    await mount();

    dots()[1].click();

    // -20 + 700 + 20 - 0.45 * 600, on the ordinary axis.
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 430, behavior: 'smooth' });
  });

  it('homes in on an unmounted older turn through the column-reverse thread', async () => {
    const scroller = makeScroller({ reverse: true });
    // At rest the view starts 1400px in: the older turn is centred 780px in,
    // the two newer ones are on screen.
    const older = exchange('Older question');
    bubble(older).getBoundingClientRect = rect(-640);
    const middle = exchange('Middle question');
    bubble(middle).getBoundingClientRect = rect(100);
    bubble(exchange('Newest question')).getBoundingClientRect = rect(400);
    await mount();
    // Scrolled away: ChatGPT unmounts the whole item.
    older.remove();
    await settle();

    dots()[0].click();
    // Towards the older end, where the remembered centre puts it.
    expect(scroller.scrollTo).toHaveBeenLastCalledWith({ top: -890, behavior: 'instant' });

    // The jump landed: the item is back, the newer ones are out of view.
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, value: -890 });
    bubble(middle).getBoundingClientRect = rect(990);
    const remounted = exchange('Older question');
    middle.before(remounted);
    bubble(remounted).getBoundingClientRect = rect(300);
    await settle(1_000);

    // Aimed at the mounted bubble: centred 510 + 300 + 20 = 830px in.
    expect(scroller.scrollTo).toHaveBeenLastCalledWith({ top: -840, behavior: 'smooth' });
    expect(labels()).toEqual(['Older question', 'Middle question', 'Newest question']);
  });

  it('adds a dot when a new prompt is sent', async () => {
    exchange('First question');
    await mount();

    exchange('Follow-up');
    await settle();

    expect(labels()).toEqual(['First question', 'Follow-up']);
  });

  it('keeps a dot while ChatGPT unmounts the item, and does not duplicate it on remount', async () => {
    const first = exchange('Scrolled away');
    const second = exchange('Still visible');
    await mount();
    const id = dots()[0].dataset.targetTurnId;

    first.remove();
    await settle();
    expect(labels()).toEqual(['Scrolled away', 'Still visible']);

    const remounted = exchange('Scrolled away');
    second.before(remounted);
    await settle();
    expect(labels()).toEqual(['Scrolled away', 'Still visible']);
    expect(bubble(remounted).getAttribute('data-gv-turn-id')).toBe(id);
    await longPress(dots()[0]);
    expect(starred('chatgpt:conv:first')).toEqual(['Scrolled away']);
  });

  it('updates the dot when a prompt is edited in place, without leaving a phantom', async () => {
    const item = exchange('Hello');
    exchange('After');
    await mount();

    bubble(item).textContent = 'Hello edited';
    await settle();
    expect(labels()).toEqual(['Hello edited', 'After']);

    // The star belongs to the edited text, and survives the store's echo.
    await longPress(dots()[0]);
    notifyStars();
    await settle();

    expect(starStore.get('chatgpt:conv:first')?.map((message) => message.turnId)).toEqual([
      buildTurnId('Hello edited'),
    ]);
    expect(dots()[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('updates the dot when only the text node of a prompt changes', async () => {
    const item = exchange('Hello');
    await mount();

    (bubble(item).firstChild as Text).data = 'Hello edited';
    await settle();
    expect(labels()).toEqual(['Hello edited']);

    await longPress(dots()[0]);
    expect(starred('chatgpt:conv:first')).toEqual(['Hello edited']);
  });

  it('rebuilds for the next conversation, Projects routes included', async () => {
    exchange('Old conversation');
    await mount();

    history.pushState({}, '', '/g/g-p-6a9f32f7/c/second');
    thread.replaceChildren();
    exchange('New conversation');
    await settle(ROUTE_SETTLE_MS);

    expect(labels()).toEqual(['New conversation']);
    expect(getStarredMessagesForConversation).toHaveBeenLastCalledWith('chatgpt:conv:second');
    await longPress(dots()[0]);
    expect(starred('chatgpt:conv:second')).toEqual(['New conversation']);
  });

  it('clears the rail when leaving for a page without turns', async () => {
    const first = exchange('Question');
    await mount();

    // The thread goes away before the URL changes: the turn mutation alone
    // still sees the old conversation and keeps its dots.
    first.remove();
    await settle();
    history.pushState({}, '', '/gpts');
    await settle(ROUTE_SETTLE_MS);

    expect(dots()).toHaveLength(0);
  });

  it('removes the rail, tooltip and every stamp on disable, and stays gone', async () => {
    exchange('Question');
    await mount();
    expect(document.querySelectorAll('[data-gv-turn-id]')).toHaveLength(1);

    await scope.dispose();
    exchange('After disable');
    history.pushState({}, '', '/c/other');
    await settle(ROUTE_SETTLE_MS);

    expect(document.querySelector('[data-gv-turn-navigator]')).toBeNull();
    expect(document.getElementById('gv-turn-navigator-tooltip')).toBeNull();
    expect(document.querySelector('.timeline-preview-panel')).toBeNull();
    expect(document.querySelectorAll('[data-gv-turn-id]')).toHaveLength(0);
  });
});
