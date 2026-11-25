/**
 * The rewritten Gemini frontend some accounts get (#1113): React, atomic classes, a Lexical
 * composer. The fixture keeps only the structure and the data attributes from the reporter's
 * Site check picks; the atomic `x…` classes are left out because they are build hashes.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { findOwnedGeminiMainInputs } from '@/core/gemini/composer/ownedInput';
import { resolveGeminiConversationRoot } from '@/core/gemini/content/conversation';
import { readGeminiUserLines } from '@/core/gemini/content/reads';
import { acceptsGeminiTurnCollection } from '@/core/gemini/turnIntegrity';
import { getGeminiTurnSelectors } from '@/core/gemini/turnSelectors';
import { geminiAdapter } from '@/features/plugins/sites/adapters/gemini';

import { GeminiTimelineTurnSource } from '../timeline/GeminiTimelineTurnSource';

function exchange(prompt: string, answer: string, latest = false): string {
  return `<article><div><div${latest ? ' data-testid="latest-turn-exchange"' : ''}>
    <section data-test-id="user-query">
      <div data-testid="user-prompt-bubble"><div data-testid="user-prompt-content"><p>${prompt}</p><p>second line</p></div></div>
    </section>
    <section data-test-id="model-response" data-turn-status>
      <div data-model-response-turn-id data-inline-copy-host><div><div data-inline-copy-host><div><p><span>${answer}</span></p></div></div></div></div>
      <div role="toolbar" data-testid="chat-response-action-bar"><div>
        <button aria-pressed="false" data-testid="response-copy-button"><span aria-hidden="true"></span></button>
        <span><button data-testid="response-more-button" aria-haspopup="menu" aria-expanded="false"><span aria-hidden="true"></span></button></span>
      </div></div>
    </section>
  </div></div></article>`;
}

function mountReactPage(): void {
  document.body.innerHTML = `<div data-chat-container>
    <div data-chat-scrollport data-id><div role="presentation">
      ${exchange('first prompt', 'first answer')}
      ${exchange('latest prompt', 'latest answer', true)}
    </div></div>
    <div data-chat-composer-dock><div><div><form><div><div>
      <div data-dark><span aria-hidden="true"><span></span><span></span></span>
        <div role="textbox" data-test-id="prompt-input" data-lexical-editor="true" contenteditable="true"><p><br></p></div>
      </div>
    </div></div></form></div></div></div>
  </div>`;
}

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('Gemini React frontend', () => {
  it('lists every user turn on the timeline', async () => {
    mountReactPage();
    const source = new GeminiTimelineTurnSource(false);
    expect(await source.initialize(new AbortController().signal)).toBe(true);
    expect(source.count()).toBe(2);
    // Each exchange is its own article, so the timeline must watch the whole conversation.
    expect(source.root).toBe(document.body);
    source.stop();
  });

  it('roots the conversation at the scrollport', () => {
    mountReactPage();
    const scrollport = document.querySelector('[data-chat-scrollport]');
    expect(resolveGeminiConversationRoot(getGeminiTurnSelectors('turn.user'))).toBe(scrollport);
    expect(document.querySelector(geminiAdapter.selectors.scrollContainer!)).toBe(scrollport);
  });

  it('reads the prompt paragraphs as lines', () => {
    mountReactPage();
    const turn = document.querySelector<HTMLElement>('section[data-test-id="user-query"]')!;
    expect(Array.from(readGeminiUserLines(turn), (line) => line.textContent)).toEqual([
      'first prompt',
      'second line',
    ]);
  });

  it('owns the Lexical editor as the main composer, not an editor inside a turn', () => {
    mountReactPage();
    const lexical = document.querySelector('[data-lexical-editor="true"]');
    document
      .querySelector('[data-testid="user-prompt-bubble"]')!
      .insertAdjacentHTML('beforeend', '<div contenteditable="true" role="textbox"></div>');
    expect(findOwnedGeminiMainInputs(document)).toEqual([lexical]);
    expect(document.querySelector(geminiAdapter.selectors.composerRoot!)).toBe(
      document.querySelector('[data-chat-composer-dock] form'),
    );
  });

  it('proves a renamed turn list against the exchange articles', () => {
    mountReactPage();
    const root = document.body;
    const users = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="user-prompt-bubble"]'),
    );
    const assistants = Array.from(
      document.querySelectorAll<HTMLElement>('[data-model-response-turn-id]'),
    );
    const none = { root, users: [], assistants: [] };
    expect(acceptsGeminiTurnCollection({ root, users, assistants }, none)).toBe(true);
    // Dropping a prompt would leave its exchange's answer paired with nothing.
    expect(acceptsGeminiTurnCollection({ root, users: users.slice(1), assistants }, none)).toBe(
      false,
    );
  });
});
