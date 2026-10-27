// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://gemini.google.com/app/owners" }
import { afterEach, expect, it } from 'vitest';

import { createContentExtractor } from '@/features/export/services/DOMContentExtractor';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { resolveExportAdapter } from '../adapter/platformAdapters';
import { createConversationCollector } from '../conversationCollector';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.replaceChildren();
});

function page(bundled = false): void {
  document.body.innerHTML = `<main><section class="conversation-container">
    <section class="repaired-user ${bundled ? 'user-query-container' : ''}"><p>First line</p><p>Second line</p><user-query-file-preview><span data-test-id="uploaded-file">notes.pdf</span></user-query-file-preview></section>
    <section class="repaired-answer ${bundled ? 'response-container' : ''}"><div class="new-answer"><p>Complete answer</p></div><message-actions><button>More</button></message-actions></section>
  </section></main>`;
}

async function online(answer = '.new-answer'): Promise<void> {
  stop = await installGeminiSelectorPatch({
    'turn.user': ['.repaired-user'],
    'turn.userWithHosts': ['.repaired-user'],
    'turn.assistant': ['.repaired-answer'],
    'turn.assistantWithHosts': ['.repaired-answer'],
    'content.answer': [answer],
    'content.userLines': ['p'],
  });
}

it('the menu of a renamed response still exports its own selected answer', async () => {
  page();
  await online();
  const collector = createConversationCollector(resolveExportAdapter());
  const messageId = collector.assistantMessageIdFor(document.querySelector('button'));
  expect(messageId).toBeTruthy();
  const turns = collector.turnsForMessageIds(new Set([messageId!]));
  expect(turns).toHaveLength(1);
  expect(turns[0].assistantContent?.text).toBe('Complete answer');
  expect(turns[0].user).toBe('');
  const outside = document.createElement('button');
  document.body.append(outside);
  expect(collector.assistantMessageIdFor(outside)).toBeNull();
});

it('the same response menu selects identical content through bundled and repaired owners', async () => {
  page(true);
  const trigger = document.querySelector('button');
  const before = createConversationCollector(resolveExportAdapter());
  const expectedId = before.assistantMessageIdFor(trigger);
  const expected = before.turnsForMessageIds(new Set([expectedId!]));
  await online();
  const after = createConversationCollector(resolveExportAdapter());
  expect(after.assistantMessageIdFor(trigger)).toBe(expectedId);
  // The content-line repair is intentionally outside this menu ownership assertion.
  expect(after.turnsForMessageIds(new Set([expectedId!]))[0].assistantContent).toEqual(
    expected[0].assistantContent,
  );
});

it('a direct prompt export cannot accept a content repair by overlooking its renamed paired response', async () => {
  page();
  await online('.missing-answer');
  const extractor = createContentExtractor(resolveExportAdapter());
  const user = document.querySelector<HTMLElement>('.repaired-user')!;
  expect(extractor.extractUserContent(user).text).toBe('📎 notes.pdf');
  stop?.();
  await online();
  expect(createContentExtractor(resolveExportAdapter()).extractUserContent(user).text).toBe(
    '📎 notes.pdf\n\nFirst line\nSecond line',
  );
});

it('an incomplete repaired turn collection cannot certify a direct prompt content repair', async () => {
  page();
  const second = document.querySelector('.conversation-container')!.cloneNode(true) as HTMLElement;
  second.querySelector('.repaired-user')!.classList.remove('repaired-user');
  second.querySelector('.repaired-answer')!.classList.remove('repaired-answer');
  document.querySelector('main')!.append(second);
  await online();
  const extractor = createContentExtractor(resolveExportAdapter());
  const user = document.querySelector<HTMLElement>('.repaired-user')!;
  expect(extractor.extractUserContent(user).text).toBe('📎 notes.pdf');
  second.remove();
  expect(extractor.extractUserContent(user).text).toBe('📎 notes.pdf\n\nFirst line\nSecond line');
});

it('a repaired fallback response still participates in its paired prompt content proof', async () => {
  page(true);
  document.querySelector('.response-container')!.classList.remove('response-container');
  stop = await installGeminiSelectorPatch({
    'turn.assistantFallback': ['.repaired-answer'],
    'content.answer': ['.missing-answer'],
    'content.userLines': ['p'],
  });
  const user = document.querySelector<HTMLElement>('.repaired-user')!;
  const extractor = createContentExtractor(resolveExportAdapter());
  expect(extractor.extractUserContent(user).text).toBe('📎 notes.pdf');
  document.querySelector('.new-answer')!.classList.add('missing-answer');
  expect(extractor.extractUserContent(user).text).toBe('📎 notes.pdf\n\nFirst line\nSecond line');
});

it('a repaired turn alias inside thoughts cannot replace the real export pair', async () => {
  page();
  document
    .querySelector('.conversation-container')!
    .insertAdjacentHTML(
      'beforeend',
      '<model-thoughts><section class="repaired-answer">Private thought preview</section></model-thoughts>',
    );
  await online();
  const extractor = createContentExtractor(resolveExportAdapter());
  expect(
    extractor.extractUserContent(document.querySelector<HTMLElement>('.repaired-user')!).text,
  ).toBe('📎 notes.pdf\n\nFirst line\nSecond line');
  const collector = createConversationCollector(resolveExportAdapter());
  const messageId = collector.assistantMessageIdFor(document.querySelector('button'));
  expect(messageId).toBeTruthy();
  expect(collector.turnsForMessageIds(new Set([messageId!]))[0].assistantContent?.text).toBe(
    'Complete answer',
  );
});

it('a retained prompt moved into thoughts cannot borrow a replacement turn proof for its content repair', async () => {
  page();
  const live = document.querySelector<HTMLElement>('.repaired-user')!;
  live.innerHTML = `<div class="live-content">${live.innerHTML}</div><model-thoughts><section class="repaired-user"><p>Stale prompt</p><user-query-file-preview><span data-test-id="uploaded-file">stale.pdf</span></user-query-file-preview></section></model-thoughts>`;
  const stale = live.querySelector<HTMLElement>('model-thoughts section')!;
  await online();
  const extractor = createContentExtractor(resolveExportAdapter());
  expect(extractor.extractUserContent(stale).text).toBe('📎 stale.pdf');
  expect(extractor.extractUserContent(live.querySelector<HTMLElement>('.live-content')!).text).toBe(
    '📎 notes.pdf\n\nFirst line\nSecond line',
  );
});

it('a detached old prompt cannot borrow the live replacement conversation proof', async () => {
  page();
  const user = document.querySelector<HTMLElement>('.repaired-user')!;
  const oldOwner = document
    .querySelector('.conversation-container')!
    .cloneNode(true) as HTMLElement;
  const stale = oldOwner.querySelector<HTMLElement>('.repaired-user')!;
  await online();
  const extractor = createContentExtractor(resolveExportAdapter());
  expect(extractor.extractUserContent(stale).text).toBe('📎 notes.pdf');
  expect(extractor.extractUserContent(user).text).toBe('📎 notes.pdf\n\nFirst line\nSecond line');
});

it('a retained element reclassified as answer content cannot supply repaired prompt lines', async () => {
  page();
  const answer = document.querySelector<HTMLElement>('.new-answer')!;
  await online();
  const extractor = createContentExtractor(resolveExportAdapter());
  expect(extractor.extractUserContent(answer).text).toBe('');
  expect(
    extractor.extractAssistantContent(document.querySelector<HTMLElement>('.repaired-answer')!)
      .text,
  ).toBe('Complete answer');
  expect(
    extractor.extractUserContent(document.querySelector<HTMLElement>('.repaired-user')!).text,
  ).toBe('📎 notes.pdf\n\nFirst line\nSecond line');
});
