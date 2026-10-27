// @vitest-environment-options { "url": "https://gemini.google.com/app/test" }
import { afterEach, beforeEach, expect, it } from 'vitest';

import { resolveExportAdapter } from '../export/adapter/platformAdapters';
import { createConversationCollector } from '../export/conversationCollector';
import { collectForkChatPairs } from '../fork/chatPairs';
import { installGeminiTurnPatch } from './geminiOnlineTurnFixture';

let stop: (() => void) | undefined;
beforeEach(() => {
  document.body.innerHTML = `<main><section id="chat-history">
    <section class="conversation-container" id="1111111111111111"><div class="online-user"><p class="query-text-line">First prompt</p></div><div class="online-answer"><message-content>First answer</message-content></div></section>
    <section class="conversation-container" id="2222222222222222"><div class="online-user"><p class="query-text-line">Last prompt</p></div><div class="online-answer"><message-content>Last answer</message-content></div></section>
  </section></main>`;
});
afterEach(() => {
  stop?.();
  stop = undefined;
  localStorage.clear();
  document.body.replaceChildren();
});
async function repair(users = '.online-user', assistants = '.online-answer'): Promise<void> {
  stop?.();
  stop = await installGeminiTurnPatch({
    'turn.user': [users],
    'turn.assistant': [assistants],
    'turn.assistantFallback': ['.missing-fallback'],
  });
}
function pairs() {
  return [
    createConversationCollector(resolveExportAdapter()).collectChatPairs(),
    collectForkChatPairs(),
  ].map((collection) => collection.map(({ user, assistant }) => ({ user, assistant })));
}
const completed = [
  { user: 'First prompt', assistant: 'First answer' },
  { user: 'Last prompt', assistant: 'Last answer' },
];

it('renamed host repair cannot export only the first native turn', async () => {
  await repair(
    '.conversation-container:first-child .online-user',
    '.conversation-container:first-child .online-answer',
  );
  expect(pairs()).toEqual([[], []]);
  await repair();
  expect(pairs()).toEqual([completed, completed]);
});

it.each(['.online-user', '.online-answer'])(
  'an empty renamed %s cannot acquire a fork ID',
  async (selector) => {
    const host = document.querySelector<HTMLElement>(selector)!;
    const contents = host.innerHTML;
    host.replaceChildren();
    await repair();
    expect(pairs()).toEqual([[], []]);
    expect(document.querySelector<HTMLElement>('.online-user')!.dataset.turnId).toBeUndefined();
    host.innerHTML = contents;
    expect(pairs()).toEqual([completed, completed]);
  },
);

it('a renamed reply owned by a nested foreign turn cannot answer the first prompt', async () => {
  const firstOwner = document.querySelector<HTMLElement>('.conversation-container')!;
  const reply = firstOwner.querySelector<HTMLElement>('.online-answer')!;
  const foreignOwner = document.createElement('section');
  foreignOwner.className = 'conversation-container';
  firstOwner.append(foreignOwner);
  foreignOwner.append(reply);
  await repair();
  expect(pairs()).toEqual([[], []]);
  firstOwner.append(reply);
  expect(pairs()).toEqual([completed, completed]);
});

it('an unmatched renamed reply prevents incomplete pair export', async () => {
  const extra = document.createElement('div');
  extra.className = 'online-answer';
  extra.innerHTML = '<message-content>Orphan answer</message-content>';
  const actions = document.createElement('message-actions');
  actions.append(extra);
  document.querySelector('.conversation-container')!.append(actions);
  await repair();
  expect(pairs()).toEqual([[], []]);
  extra.remove();
  expect(pairs()).toEqual([completed, completed]);
});

it('renamed turns outside the accepted history cannot leak into export', async () => {
  const history = document.querySelector<HTMLElement>('#chat-history')!;
  const owners = Array.from(history.children);
  document.querySelector('main')!.append(...owners);
  await repair();
  expect(pairs()).toEqual([[], []]);
  history.append(...owners);
  expect(pairs()).toEqual([completed, completed]);
});

it('an omitted renamed final answer is not mistaken for a pending prompt', async () => {
  document.querySelectorAll('.online-answer')[1].innerHTML =
    '<div class="renamed-content">Last answer</div>';
  await repair('.online-user', '.conversation-container:first-child .online-answer');
  expect(pairs()).toEqual([[], []]);
  await repair();
  expect(pairs()).toEqual([completed, completed]);
});

it('a genuine pending final prompt remains exportable after the turn hosts are renamed', async () => {
  document.querySelectorAll('.online-answer')[1].remove();
  document
    .querySelectorAll('.conversation-container')[1]
    .insertAdjacentHTML(
      'beforeend',
      '<button>Copy prompt</button><message-actions><a href="https://g.co/share/x">Share</a></message-actions><model-thoughts>Thinking</model-thoughts>',
    );
  await repair();
  const expected = [completed[0], { user: 'Last prompt', assistant: '' }];
  expect(pairs()).toEqual([expected, expected]);
});

it.each(['user', 'answer'])(
  'a renamed %s fragment cannot drop the rest of its native turn',
  async (role) => {
    const host = document.querySelector<HTMLElement>(`.online-${role}`)!;
    const original = host.innerHTML;
    host.innerHTML = '<div class="partial-host">Partial</div><div>Tail</div>';
    await repair(
      role === 'user'
        ? '.partial-host, .conversation-container:last-child .online-user'
        : '.online-user',
      role === 'answer'
        ? '.partial-host, .conversation-container:last-child .online-answer'
        : '.online-answer',
    );
    expect(pairs()).toEqual([[], []]);
    host.innerHTML = original;
    await repair();
    expect(pairs()).toEqual([completed, completed]);
  },
);

it.each(['user', 'answer'])(
  'a semantic %s host cannot turn complete visible content into an empty rich export',
  async (role) => {
    document.querySelector('.online-answer')!.innerHTML =
      '<h3 class="semantic-answer">First answer</h3>';
    document.querySelector('.query-text-line')!.classList.add('semantic-user');
    await repair(
      role === 'user'
        ? '.semantic-user, .conversation-container:last-child .online-user'
        : '.online-user',
      role === 'answer'
        ? '.semantic-answer, .conversation-container:last-child .online-answer'
        : '.online-answer',
    );
    const richTurns = () => {
      const collector = createConversationCollector(resolveExportAdapter());
      const ids = collector.collectSelectionMessages().map(({ messageId }) => messageId);
      return collector.turnsForMessageIds(new Set(ids));
    };
    expect(richTurns()).toEqual([]);
    await repair();
    const turns = richTurns();
    expect(turns).toHaveLength(2);
    expect(turns[0].userContent?.html).toBe('<p>First prompt</p>');
    expect(turns[0].assistantContent?.html).toBe('<h3>First answer</h3>');
    expect(turns[0].assistantContent?.text).toBe('### First answer');
  },
);
