import './__tests__/chatgptTimelineHarness';
/**
 * A ChatGPT scheduled task keeps one prompt and appends a reply per run, all in
 * one `[data-turn-key]` item and one assistant unit; each reply sits in its own
 * `[data-dil-source-message-id]` wrapper (sanitized from the live page,
 * 2026-11-11). Issue #1091: the rail marked only the prompt.
 */
import { describe, expect, it, vi } from 'vitest';

import { buildTurnId } from '@/features/timeline/adapters/catalog/turnMerge';

import {
  CONVERSATION_ATTR,
  dots,
  exchange,
  labels,
  longPress,
  makeScroller,
  mount,
  rect,
  settle,
  starStore,
  thread,
  urlConversation,
} from './__tests__/chatgptTimelineHarness';

function run(text: string, id: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-dil-source-message-id', id);
  wrapper.setAttribute('data-markdown-copy', 'contents');
  wrapper.innerHTML = `<div><div data-theme=""><div data-dil-response="" data-dil-message-id="${id}"><p data-d-component="text"></p></div></div></div>`;
  wrapper.querySelector('p')!.textContent = text;
  return wrapper;
}

/** One scheduled-task conversation: its prompt, then one wrapper per reply. */
function scheduledTask(prompt: string, replies: readonly string[]): HTMLElement {
  const item = document.createElement('div');
  item.setAttribute('data-turn-key', '');
  item.innerHTML = `
    <div data-content-search-turn-key="fallback-turn-0">
      <div data-talvt-turn-state="complete">
        <div data-chatgpt-search-unit-key="fallback-turn-0_0_user">
          <div data-user-message-bubble="true"></div>
        </div>
        <div data-chatgpt-search-unit-key="fallback-turn-0_2_assistant">
          <div ${CONVERSATION_ATTR}="${urlConversation()}">
            <div data-selected-text-overlay-target="" data-markdown-text-style="assistant-message"></div>
          </div>
        </div>
      </div>
    </div>`;
  item.querySelector('[data-user-message-bubble]')!.textContent = prompt;
  const runs = item.querySelector('[data-markdown-text-style]')!;
  replies.forEach((text, index) => runs.append(run(text, `run-${index + 1}`)));
  thread.append(item);
  return item;
}

describe('ChatGPT timeline on a scheduled task', () => {
  it('gives each later run of a scheduled task its own marker that jumps to it', async () => {
    const scroller = makeScroller();
    const item = scheduledTask('Send me the daily brief', [
      'Task created. I will send the brief every morning.',
      'Brief for Monday',
      'Brief for Tuesday',
    ]);
    item.querySelector<HTMLElement>('[data-dil-source-message-id="run-3"]')!.getBoundingClientRect =
      rect(700);
    await mount();

    // The first reply answers the prompt and is reached through the prompt's marker.
    expect(labels()).toEqual(['Send me the daily brief', 'Brief for Monday', 'Brief for Tuesday']);
    dots()[2].click();
    expect(scroller.scrollTo).toHaveBeenLastCalledWith({ top: 450, behavior: 'smooth' });
    expect(dots()[2].getAttribute('aria-current')).toBe('true');

    // The next run arrives while the conversation is open.
    item.querySelector('[data-markdown-text-style]')!.append(run('Brief for Wednesday', 'run-4'));
    await settle();
    expect(labels()).toEqual([
      'Send me the daily brief',
      'Brief for Monday',
      'Brief for Tuesday',
      'Brief for Wednesday',
    ]);
  });

  it('a conversation with one reply per prompt keeps only its prompt markers', async () => {
    for (const prompt of ['First question', 'Second question', 'Third question']) {
      const item = exchange(prompt);
      item
        .querySelector('[data-chatgpt-selection-message-id]')!
        .append(run(`Answer to ${prompt}`, `reply-${prompt}`));
    }
    await mount();

    expect(labels()).toEqual(['First question', 'Second question', 'Third question']);
    expect(dots().map((dot) => dot.dataset.targetTurnId)).toEqual(
      ['First question', 'Second question', 'Third question'].map(buildTurnId),
    );
  });

  it('a run never takes the id or star of a later prompt with the same text', async () => {
    scheduledTask('Daily brief', ['Task created.', 'Same words']);
    exchange('Same words');
    await mount();
    expect(labels()).toEqual(['Daily brief', 'Same words', 'Same words']);
    expect(dots()[2].dataset.targetTurnId).toBe(buildTurnId('Same words'));

    await longPress(dots()[1]);
    await vi.waitFor(() => expect(starStore.get('chatgpt:conv:first')).toHaveLength(1));
    const [saved] = starStore.get('chatgpt:conv:first')!;
    expect(saved.content).toBe('Same words');
    // Export's starred filter matches prompts by this id's hash.
    expect(saved.turnId).not.toBe(buildTurnId('Same words'));
  });
});
