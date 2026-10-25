import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveExportAdapter } from '../export/adapter/platformAdapters';
import { createConversationCollector } from '../export/conversationCollector';
import { collectForkChatPairs } from '../fork/chatPairs';
import { collectHighlightTurns } from '../highlight/dom';
import { installGeminiTurnPatch } from './geminiOnlineTurnFixture';

describe('native pair readers with online Gemini turn profiles', () => {
  let stopSelectors: (() => void) | undefined;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = `<main>
      <section class="conversation-container" id="1111111111111111">
        <div class="user-query-container online-user"><p class="query-text-line">First question</p></div>
        <div class="response-container online-assistant"><message-content>First answer</message-content></div>
      </section>
      <section class="conversation-container" id="2222222222222222">
        <div class="user-query-container online-user"><p class="query-text-line">Second question</p></div>
        <div class="response-container online-assistant"><message-content>Second answer</message-content></div>
      </section>
    </main>`;
  });

  afterEach(() => {
    stopSelectors?.();
    stopSelectors = undefined;
    localStorage.clear();
    document.body.replaceChildren();
  });

  async function useAliases(): Promise<void> {
    stopSelectors = await installGeminiTurnPatch({
      'turn.user': ['.online-user'],
      'turn.assistant': ['.online-assistant'],
      'turn.assistantFallback': ['.online-fallback'],
    });
  }

  it('exports the same ordered nodes, answer text and selection ids through renamed hosts', async () => {
    const collector = createConversationCollector(resolveExportAdapter());
    const before = collector.collectChatPairs();
    const selectedBefore = collector.collectSelectionMessages();
    await useAliases();

    expect(collector.collectChatPairs()).toEqual(before);
    expect(collector.collectSelectionMessages()).toEqual(selectedBefore);
    expect(collector.topUserElement()).toBe(before[0].userElement);
    expect(collector.conversationRoot()).toBe(document.querySelector('main'));
  });

  it('forks the same ordered prompts, answers and canonical ids through renamed hosts', async () => {
    const before = collectForkChatPairs();
    await useAliases();

    expect(collectForkChatPairs()).toEqual(before);
    expect(before.map(({ turnId }) => turnId)).toEqual([
      's-1111111111111111',
      's-2222222222222222',
    ]);
  });

  it('highlights the same answer roots and canonical turns through renamed hosts', async () => {
    const before = collectHighlightTurns();
    await useAliases();

    expect(collectHighlightTurns()).toEqual(before);
    expect(before.map(({ assistantRoot }) => assistantRoot.textContent)).toEqual([
      'First answer',
      'Second answer',
    ]);
  });

  it('reads online-only turns when no bundled user or assistant host remains', async () => {
    await useAliases();
    document.querySelectorAll('.user-query-container').forEach((element) => {
      element.classList.remove('user-query-container');
    });
    document.querySelectorAll('.response-container').forEach((element) => {
      element.classList.remove('response-container');
    });

    const expectedIds = ['s-1111111111111111', 's-2222222222222222'];
    expect(
      createConversationCollector(resolveExportAdapter())
        .collectChatPairs()
        .map(({ turnId }) => turnId),
    ).toEqual(expectedIds);
    expect(collectForkChatPairs().map(({ turnId }) => turnId)).toEqual(expectedIds);
    expect(collectHighlightTurns().map(({ turnId }) => turnId)).toEqual(expectedIds);
  });

  it('ignores stale Auto nodes in highlight and export while an online user profile is active', async () => {
    document
      .querySelector('main')!
      .insertAdjacentHTML(
        'afterbegin',
        '<div class="stale-user">Not a prompt</div><div class="response-container online-assistant"><message-content>Not a reply</message-content></div>',
      );
    localStorage.setItem('geminiTimelineUserTurnSelectorAuto', '.stale-user');
    await useAliases();

    expect(collectHighlightTurns().map(({ userElement }) => userElement.textContent)).toEqual([
      'First question',
      'Second question',
    ]);
    expect(
      createConversationCollector(resolveExportAdapter())
        .collectChatPairs()
        .map(({ user }) => user),
    ).toEqual(['First question', 'Second question']);
    expect(localStorage.getItem('geminiTimelineUserTurnSelectorAuto')).toBe('.stale-user');
  });

  it('keeps a readable online user-only turn without mixing in bundled assistants', async () => {
    stopSelectors = await installGeminiTurnPatch({
      'turn.user': ['.online-user'],
      'turn.assistant': ['.missing-assistant'],
      'turn.assistantFallback': ['.missing-fallback'],
    });

    const pairs = createConversationCollector(resolveExportAdapter()).collectChatPairs();
    expect(pairs.map(({ user, assistant }) => ({ user, assistant }))).toEqual([
      { user: 'First question', assistant: '' },
      { user: 'Second question', assistant: '' },
    ]);
    expect(collectForkChatPairs().map(({ assistant }) => assistant)).toEqual(['', '']);
    // Highlight needs a complete pair, so its entire operation uses the bundled view.
    expect(collectHighlightTurns().map(({ assistantRoot }) => assistantRoot.textContent)).toEqual([
      'First answer',
      'Second answer',
    ]);
  });

  it('falls back export content but keeps a structurally accepted empty fork user host', async () => {
    document
      .querySelector('main')!
      .insertAdjacentHTML('afterbegin', '<div class="empty-online-user"></div>');
    stopSelectors = await installGeminiTurnPatch({
      'turn.user': ['.empty-online-user'],
      'turn.assistant': ['.missing-assistant'],
      'turn.assistantFallback': ['.missing-fallback'],
    });

    const collector = createConversationCollector(resolveExportAdapter());
    expect(collector.collectChatPairs().map(({ assistant }) => assistant)).toEqual([
      'First answer',
      'Second answer',
    ]);
    expect(collectForkChatPairs()).toEqual([]);
    expect(document.querySelector<HTMLElement>('.empty-online-user')!.dataset.turnId).toBe('u-0');
  });

  it('leaves rejected online code untouched before extracting the accepted bundled fork', async () => {
    const html = `<main>
      <section class="conversation-container" id="1111111111111111">
        <div class="user-query-container">Question</div>
        <div class="response-container"><message-content><pre><code id="accepted-code">accepted code</code></pre></message-content></div>
      </section>
      <div class="rejected-assistant"><message-content><pre><code id="rejected-code">rejected code</code></pre></message-content></div>
    </main>`;
    document.body.innerHTML = html;
    const before = collectForkChatPairs().map(({ turnId, user, assistant }) => ({
      turnId,
      user,
      assistant,
    }));
    document.body.innerHTML = html;
    stopSelectors = await installGeminiTurnPatch({
      'turn.user': ['.missing-online-user'],
      'turn.assistant': ['.rejected-assistant'],
      'turn.assistantFallback': ['.missing-online-fallback'],
    });

    expect(
      collectForkChatPairs().map(({ turnId, user, assistant }) => ({ turnId, user, assistant })),
    ).toEqual(before);
    const rejected = document.getElementById('rejected-code') as HTMLElement & {
      processedByGV?: boolean;
    };
    expect(rejected.processedByGV).toBeUndefined();
    expect(
      document.querySelector<HTMLElement>('.rejected-assistant')!.dataset.turnId,
    ).toBeUndefined();
    expect(document.querySelector<HTMLElement>('.user-query-container')!.dataset.turnId).toBe(
      's-1111111111111111',
    );
  });

  it('keeps highlight selector-priority collection and specific-assistant preference', async () => {
    document
      .querySelectorAll<HTMLElement>('.online-user')[1]
      .classList.add('preferred-online-user');
    stopSelectors = await installGeminiTurnPatch({
      'turn.user': ['.preferred-online-user', '.online-user'],
      'turn.assistant': ['.online-assistant'],
      'turn.assistantFallback': ['[role="listitem"]'],
    });
    document
      .querySelector('.online-user')!
      .insertAdjacentHTML('afterend', '<div role="listitem">Generic fallback</div>');

    // The highlight reader has always kept selector-priority order, not a DOM sort.
    expect(
      collectHighlightTurns().map(({ userElement, assistantRoot }) => [
        userElement.textContent,
        assistantRoot.textContent,
      ]),
    ).toEqual([['First question', 'Second answer']]);
  });
});
