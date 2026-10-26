// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://gemini.google.com/app/test" }
import { afterEach, describe, expect, it } from 'vitest';

import {
  geminiAnswerChain,
  renameGeminiAnswer,
} from '@/core/gemini/content/__tests__/answerFixture';
import { createContentExtractor } from '@/features/export/services/DOMContentExtractor';
import { MarkdownFormatter } from '@/features/export/services/MarkdownFormatter';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { collectForkChatPairs } from '../../fork/chatPairs';
import { resolveExportAdapter } from '../adapter/platformAdapters';
import { createConversationCollector } from '../conversationCollector';

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((stop) => stop());
  document.body.replaceChildren();
  localStorage.clear();
});

function fixture(): void {
  document.body.innerHTML = `<main><section id="chat-history" class="online-root">
    <div class="conversation-container" id="turn-a"><user-query class="user-query-container online-user"><p class="query-text-line line">Prompt one</p><p class="query-text-line line">Second line</p><user-query-file-preview><span data-test-id="uploaded-file" aria-label="notes.pdf">notes.pdf</span></user-query-file-preview></user-query><model-response class="response-container online-assistant"><model-thoughts><message-content>Private reasoning</message-content></model-thoughts><message-content class="answer"><div class="markdown"><p>Prose <b>bold</b></p><code-block><pre><code data-test-id="code-content">const x = 1;</code></pre></code-block><span data-math="x^2">x²</span><single-image><img src="https://example.com/one.png" alt="one"></single-image><p>Tail</p></div></message-content></model-response></div>
    <div class="conversation-container" id="turn-b"><user-query class="user-query-container online-user"><p class="query-text-line line">Pending prompt</p></user-query></div>
  </section></main>`;
}
function collector() {
  return createConversationCollector(resolveExportAdapter());
}
function snapshot() {
  const current = collector();
  const messages = current.collectSelectionMessages();
  const turns = current.turnsForMessageIds(new Set(messages.map((message) => message.messageId)));
  return {
    ids: messages.map((message) => message.messageId),
    pairs: current.collectChatPairs(),
    turns,
  };
}

describe('online export content collection', () => {
  it('preserves mixed Markdown, JSON, attachment order, pending turn and fork IDs on the same DOM', async () => {
    fixture();
    const bundled = snapshot();
    const bundledFork = collectForkChatPairs();
    cleanups.push(
      await installGeminiSelectorPatch({
        'content.answer': ['.answer'],
        'content.userLines': ['.line'],
      }),
    );
    const online = snapshot();
    expect(online.ids).toEqual(bundled.ids);
    expect(
      online.turns.map(({ userContent, assistantContent }) => ({ userContent, assistantContent })),
    ).toEqual(
      bundled.turns.map(({ userContent, assistantContent }) => ({ userContent, assistantContent })),
    );
    expect(JSON.stringify(online.turns)).toBe(JSON.stringify(bundled.turns));
    const metadata = {
      title: 'Fixture',
      url: 'https://gemini.google.com/app/test',
      exportedAt: new Date(0).toISOString(),
      platform: 'Gemini',
      count: online.turns.length,
    };
    expect(MarkdownFormatter.format(online.turns, metadata)).toBe(
      MarkdownFormatter.format(bundled.turns, metadata),
    );
    expect(online.turns[0].userContent?.attachments).toEqual([{ name: 'notes.pdf', type: 'pdf' }]);
    expect(online.pairs.at(-1)?.user).toBe('Pending prompt');
    expect(collectForkChatPairs()).toEqual(bundledFork);
    expect(online.turns[0].assistantContent?.text).toContain('Prose');
    expect(online.turns[0].assistantContent?.text).toContain('Tail');
  });

  it('exports and forks the renamed answer through Gemini’s real response wrappers', async () => {
    fixture();
    document.querySelector('model-response')!.outerHTML = geminiAnswerChain(
      '<p>Prose</p><ol><li>Step</li></ol><h3>Heading</h3><blockquote><p>Quote</p></blockquote><ul><li>Tail</li></ul>',
    );
    const host = document.querySelector<HTMLElement>('model-response')!;
    const answer = renameGeminiAnswer(host);
    const expected = snapshot();
    cleanups.push(await installGeminiSelectorPatch({ 'content.answer': ['.answer-surface'] }));
    const repaired = snapshot();
    expect(repaired.pairs[0].assistantElement).toBe(answer);
    expect(repaired.turns[0].assistantContent).toEqual(expected.turns[0].assistantContent);
    expect(repaired.turns[0].assistantContent?.text).toContain('### Heading');
    expect(repaired.turns[0].assistantContent?.text).toContain('> Quote');
    expect(collectForkChatPairs()[0].assistant).toContain('### Heading');
  });

  it('a repaired answer cannot lose its heading or code frame while retaining the same text', async () => {
    fixture();
    const host = document.querySelector<HTMLElement>('model-response')!;
    host.innerHTML =
      '<h1><span class="answer">Heading</span></h1><code-block><pre><code data-test-id="code-content">Source</code></pre></code-block>';
    const bundled = snapshot();
    cleanups.push(await installGeminiSelectorPatch({ 'content.answer': ['.answer'] }));
    const online = snapshot();
    expect(online.turns[0].assistantContent?.html).toBe(bundled.turns[0].assistantContent?.html);
    expect(online.turns[0].assistantContent?.text).toContain('# Heading');
    host.innerHTML = '<h1><div class="answer">Only heading</div></h1>';
    const extractor = createContentExtractor(resolveExportAdapter());
    expect(extractor.extractAssistantContent(host).text).toBe('# Only heading');
    expect(extractor.extractAssistantContent(host).html).toBe('<h1>Only heading</h1>');
  });

  it('a second content read preserves sibling images beside an already accepted message root', async () => {
    fixture();
    const answer = document.querySelector<HTMLElement>('message-content.answer')!;
    answer.innerHTML =
      '<div class="markdown"><p>Prose</p></div><single-image><img src="https://example.com/sibling.png" alt="Sibling"></single-image>';
    const bundled = createContentExtractor(resolveExportAdapter()).extractAssistantContent(answer);
    cleanups.push(
      await installGeminiSelectorPatch({
        'content.answer': ['message-content.answer', '.markdown'],
      }),
    );
    const online = createContentExtractor(resolveExportAdapter()).extractAssistantContent(answer);
    expect(online).toEqual(bundled);
    expect(online.text).toContain('![Sibling](https://example.com/sibling.png)');
  });

  it('a partial turn profile cannot renumber or mark only the first response', async () => {
    fixture();
    const expected = snapshot();
    cleanups.push(await installGeminiSelectorPatch({ 'turn.user': ['#turn-a user-query'] }));
    expect(snapshot().ids).toEqual(expected.ids);
    expect(collectForkChatPairs().map((pair) => pair.user)).toEqual([
      '📎 notes.pdf\n\nPrompt one\nSecond line',
      'Pending prompt',
    ]);
  });

  it('unproven online-only turns never become export or fork content', async () => {
    document.body.innerHTML =
      '<main><div class="online-user">Foreign prompt</div><div class="online-answer">Foreign response</div></main>';
    cleanups.push(
      await installGeminiSelectorPatch({
        'turn.user': ['.online-user'],
        'turn.assistant': ['.online-answer'],
      }),
    );
    expect(collector().collectChatPairs()).toEqual([]);
    expect(collectForkChatPairs()).toEqual([]);
    document
      .querySelector('main')!
      .insertAdjacentHTML(
        'beforeend',
        '<user-query class="user-query-container"><p class="query-text-line">Native prompt</p></user-query><model-response><message-content>Native answer</message-content></model-response>',
      );
    expect(
      collector()
        .collectChatPairs()
        .map((pair) => pair.assistant),
    ).toEqual(['Native answer']);
  });

  it('one incomplete answer reruns every content read with the bundled view before extraction', async () => {
    fixture();
    document
      .querySelector('#turn-b')!
      .insertAdjacentHTML(
        'beforeend',
        '<model-response><message-content><p class="answer">Partial</p><p>Tail two</p></message-content></model-response>',
      );
    document.querySelector('#turn-a message-content.answer')!.outerHTML =
      '<div class="answer"><p>Renamed answer</p></div>';
    const expected = snapshot();
    cleanups.push(await installGeminiSelectorPatch({ 'content.answer': ['.answer'] }));
    const actual = snapshot();
    expect(actual.pairs.map((pair) => pair.assistantElement)).toEqual(
      expected.pairs.map((pair) => pair.assistantElement),
    );
    expect(actual.turns.map((turn) => turn.assistantContent)).toEqual(
      expected.turns.map((turn) => turn.assistantContent),
    );
  });
});
