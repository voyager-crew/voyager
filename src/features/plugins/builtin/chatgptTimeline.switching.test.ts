import './__tests__/chatgptTimelineHarness';
/** Starring on the ChatGPT timeline while conversations, new chats and pages switch. */
import { describe, expect, it, vi } from 'vitest';

import type { StarredMessage } from '@/features/savedLibrary/starTypes';

import {
  ROUTE_SETTLE_MS,
  SLOW_HOST_MS,
  thread,
  mount,
  settle,
  openPage,
  hidePage,
  switchPage,
  showPage,
  exchange,
  nameConversation,
  draftId,
  star,
  starred,
  notifyStars,
  longPress,
  dots,
  labels,
  starStore,
  getStarredMessagesForConversation,
  addStarredMessage,
  removeStarredMessage,
} from './__tests__/chatgptTimelineHarness';

describe('ChatGPT timeline', () => {
  it('refuses a turn whose reply has not named the conversation yet, then stars it once it has', async () => {
    exchange('Answered');
    await mount();

    // Sent: the prompt shows before the reply carries the conversation id.
    const pending = exchange('Streaming', null);
    await settle();
    await longPress(dots()[1]);
    expect(addStarredMessage).not.toHaveBeenCalled();

    nameConversation(pending, 'first');
    await longPress(dots()[1]);
    expect(starred('chatgpt:conv:first')).toEqual(['Streaming']);
  });

  it('refuses a turn whose reply names another conversation', async () => {
    exchange('Mine');
    exchange('Theirs', 'elsewhere');
    await mount();

    await longPress(dots()[1]);
    expect(addStarredMessage).not.toHaveBeenCalled();
    await longPress(dots()[0]);
    expect(starred('chatgpt:conv:first')).toEqual(['Mine']);
  });

  it('keeps the next conversation starrable while the previous page stays hidden in the DOM', async () => {
    const pageA = document.querySelector<HTMLElement>('[data-app-shell-active-page]')!;
    exchange('Prompt A');
    await mount();

    history.pushState({}, '', '/c/second');
    hidePage(pageA);
    const pageB = openPage();
    exchange('Prompt B');
    await settle(ROUTE_SETTLE_MS);

    expect(labels()).toEqual(['Prompt B']);
    await longPress(dots()[0]);
    expect(starred('chatgpt:conv:second')).toEqual(['Prompt B']);

    // Back to the cached page: ChatGPT flips which surface is hidden.
    history.pushState({}, '', '/c/first');
    hidePage(pageB);
    showPage(pageA);
    await settle(ROUTE_SETTLE_MS);
    expect(labels()).toEqual(['Prompt A']);
    await longPress(dots()[0]);
    expect(starred('chatgpt:conv:first')).toEqual(['Prompt A']);
    expect(starred('chatgpt:conv:second')).toEqual(['Prompt B']);
  });

  it('shows what is on screen while the URL changes before the page', async () => {
    exchange('Prompt A');
    await mount();

    history.pushState({}, '', '/c/second');
    await settle(ROUTE_SETTLE_MS);
    // A's page is still the open one until ChatGPT swaps it, and its turn is still A's.
    expect(labels()).toEqual(['Prompt A']);
    await longPress(dots()[0]);
    expect(addStarredMessage).not.toHaveBeenCalled();

    switchPage();
    exchange('Prompt B');
    await settle();

    expect(labels()).toEqual(['Prompt B']);
    expect(getStarredMessagesForConversation).toHaveBeenLastCalledWith('chatgpt:conv:second');
    await longPress(dots()[0]);
    expect(starred('chatgpt:conv:second')).toEqual(['Prompt B']);
  });

  it("drops the previous conversation's turns, mounted or not, when its page is put away", async () => {
    const items = [exchange('Prompt A1'), exchange('Prompt A2'), exchange('Prompt A3')];
    await mount();
    items[0].remove();
    await settle();
    expect(labels()).toEqual(['Prompt A1', 'Prompt A2', 'Prompt A3']);

    history.pushState({}, '', '/c/second');
    await settle(ROUTE_SETTLE_MS);
    switchPage();
    exchange('Prompt B');
    await settle();

    expect(labels()).toEqual(['Prompt B']);
  });

  it('stars the next conversation as soon as the URL names what its replies name', async () => {
    exchange('Prompt A');
    await mount();

    // ChatGPT rendered B before the URL changed: B's turns are not this URL's.
    switchPage();
    exchange('Prompt B', 'second');
    await settle(600);
    expect(labels()).toEqual(['Prompt B']);
    await longPress(dots()[0]);
    expect(addStarredMessage).not.toHaveBeenCalled();

    history.pushState({}, '', '/c/second');
    await settle(ROUTE_SETTLE_MS);
    expect(labels()).toEqual(['Prompt B']);
    await longPress(dots()[0]);
    expect(starred('chatgpt:conv:second')).toEqual(['Prompt B']);
    expect(starred('chatgpt:conv:first')).toBeUndefined();
  });

  it('keeps the previous conversation off the rail when a star change lands mid-switch', async () => {
    exchange('Prompt A');
    await mount();

    history.pushState({}, '', '/c/second');
    // Another tab starred something before this tab noticed the route change.
    notifyStars();
    switchPage();
    exchange('Prompt B');
    await settle(ROUTE_SETTLE_MS);

    expect(labels()).toEqual(['Prompt B']);
  });

  it('leaves a turn removed outright after the route changed as a dot that cannot be starred', async () => {
    const old = exchange('Prompt A');
    await mount();

    history.pushState({}, '', '/c/second');
    await settle(ROUTE_SETTLE_MS);
    // Removal looks like virtualization, so the dot stays; its reply still names A.
    exchange('Prompt B');
    await settle();
    old.remove();
    await settle();
    expect(labels()).toEqual(['Prompt A', 'Prompt B']);
    await longPress(dots()[0]);
    expect(addStarredMessage).not.toHaveBeenCalled();
  });

  it("stars a new chat's turns once their replies name the id ChatGPT gave it, with no reload", async () => {
    history.replaceState({}, '', '/');
    // Whether a draft's reply carries an id before the URL has one is not
    // proven live; either way nothing on / can be starred.
    const draft = exchange('Brand new chat', null);
    await mount();

    await longPress(dots()[0]);
    expect(addStarredMessage).not.toHaveBeenCalled();
    // Every new chat on / shares one path-hash id: nothing there is this chat's.
    expect(getStarredMessagesForConversation).not.toHaveBeenCalled();

    history.pushState({}, '', '/c/assigned-id');
    await settle(ROUTE_SETTLE_MS);
    expect(getStarredMessagesForConversation).toHaveBeenLastCalledWith('chatgpt:conv:assigned-id');
    // Still no id on the reply: unstarrable rather than guessed.
    await longPress(dots()[0]);
    expect(addStarredMessage).not.toHaveBeenCalled();

    nameConversation(draft, 'assigned-id');
    await longPress(dots()[0]);
    expect(starred('chatgpt:conv:assigned-id')).toEqual(['Brand new chat']);
  });

  it('cannot star a new chat turn under a conversation opened before that one renders', async () => {
    history.replaceState({}, '', '/');
    exchange('Draft prompt', 'draft-id');
    await mount();

    history.pushState({}, '', '/c/unrelated');
    await settle(ROUTE_SETTLE_MS);
    expect(labels()).toEqual(['Draft prompt']);
    await longPress(dots()[0]);

    expect(addStarredMessage).not.toHaveBeenCalled();
  });

  it('never moves or deletes a star stored under a new-chat id', async () => {
    history.replaceState({}, '', '/');
    const saved = star(draftId(), 'Star me');
    starStore.set(draftId(), [saved]);
    // A store near its quota drops a write without an error.
    addStarredMessage.mockImplementation(async () => {});
    exchange('Star me', null);
    await mount();

    history.pushState({}, '', '/c/assigned-id');
    await settle(ROUTE_SETTLE_MS + SLOW_HOST_MS);

    expect(removeStarredMessage).not.toHaveBeenCalled();
    expect(starStore.get(draftId())).toEqual([saved]);
  });

  it('keeps a new chat out of a conversation opened while the new chat is still on screen', async () => {
    history.replaceState({}, '', '/');
    starStore.set('chatgpt:conv:other', [star('chatgpt:conv:other', 'Other prompt')]);
    exchange('Draft prompt', null);
    await mount();
    await longPress(dots()[0]);

    history.pushState({}, '', '/c/other');
    // ChatGPT is slow to load the conversation: the new chat stays on screen.
    await settle(ROUTE_SETTLE_MS + SLOW_HOST_MS);
    await longPress(dots()[0]);
    expect(addStarredMessage).not.toHaveBeenCalled();
    switchPage();
    exchange('Other prompt');
    await settle();

    expect(labels()).toEqual(['Other prompt']);
    expect(dots()[0].getAttribute('aria-pressed')).toBe('true');

    exchange('Next prompt');
    await settle();
    await longPress(dots()[1]);
    expect(starred('chatgpt:conv:other')).toEqual(['Other prompt', 'Next prompt']);
  });

  it('ignores a star press in the moment between a URL change and the next refresh', async () => {
    exchange('Prompt A');
    await mount();

    dots()[0].dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(549);
    history.pushState({}, '', '/c/second');
    await settle(ROUTE_SETTLE_MS);

    expect(addStarredMessage).not.toHaveBeenCalled();
  });

  it("stars the next conversation's turns, never the previous one's, while both are on screen", async () => {
    exchange('Prompt A');
    await mount();

    history.pushState({}, '', '/c/second');
    await settle(ROUTE_SETTLE_MS);
    exchange('Prompt B');
    await settle();
    expect(labels()).toEqual(['Prompt A', 'Prompt B']);

    await longPress(dots()[0]);
    expect(addStarredMessage).not.toHaveBeenCalled();
    await longPress(dots()[1]);
    expect(starred('chatgpt:conv:second')).toEqual(['Prompt B']);
    expect(starred('chatgpt:conv:first')).toBeUndefined();
  });

  it('cannot star a previous-conversation turn that mounts after the URL changed', async () => {
    exchange('Prompt A');
    await mount();
    history.pushState({}, '', '/c/second');
    await settle(ROUTE_SETTLE_MS);

    thread.replaceChildren();
    await settle();
    exchange('Prompt A', 'first');
    await settle();
    expect(labels()).toEqual(['Prompt A']);
    await longPress(dots()[0]);

    expect(addStarredMessage).not.toHaveBeenCalled();
  });

  it('drops a press begun in the previous conversation when the next one has the same prompt', async () => {
    exchange('Same prompt');
    await mount();

    dots()[0].dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(100);
    history.pushState({}, '', '/c/second');
    thread.replaceChildren();
    exchange('Same prompt');
    await settle(ROUTE_SETTLE_MS);

    expect(addStarredMessage).not.toHaveBeenCalled();
  });

  it('drops a star press whose read was still pending when the user moved on', async () => {
    exchange('Same prompt');
    await mount();
    let release!: (messages: StarredMessage[]) => void;
    getStarredMessagesForConversation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    dots()[0].dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(549);
    history.pushState({}, '', '/c/second');
    await vi.advanceTimersByTimeAsync(1);
    // The next conversation opens with the same prompt before that read lands.
    history.pushState({}, '', '/c/third');
    thread.replaceChildren();
    exchange('Same prompt');
    await settle(ROUTE_SETTLE_MS);
    release?.([]);
    await settle();

    expect(addStarredMessage).not.toHaveBeenCalled();
  });
});
