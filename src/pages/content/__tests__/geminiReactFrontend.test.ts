/**
 * The rewritten Gemini frontend some accounts get (#1113): React, atomic classes, a Lexical
 * composer. The fixture keeps only the structure and the data attributes from the reporter's
 * Site check picks; the atomic `x…` classes are left out because they are build hashes.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { findOwnedGeminiMainInputs } from '@/core/gemini/composer/ownedInput';
import { resolveGeminiConversationRoot } from '@/core/gemini/content/conversation';
import { readGeminiUserLines } from '@/core/gemini/content/reads';
import { hasGeminiBoundaryConflict } from '@/core/gemini/domBoundary';
import { resolveGeminiUserLatexLines } from '@/core/gemini/math/userLatex';
import { acceptsGeminiTurnCollection } from '@/core/gemini/turnIntegrity';
import { getGeminiTurnSelectors } from '@/core/gemini/turnSelectors';
import { geminiAdapter } from '@/features/plugins/sites/adapters/gemini';
import { resetPageUrl, setPageUrl } from '@/tests/pageUrl';

import { resolveExportAdapter } from '../export/adapter/platformAdapters';
import { createGeminiCollectorPolicy } from '../export/sites/geminiCollectorPolicy';
import { GeminiTimelineTurnSource } from '../timeline/GeminiTimelineTurnSource';
import { installGeminiSelectorPatch } from './geminiOnlineSelectorFixture';

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

let stopPatch = () => {};

afterEach(() => {
  stopPatch();
  stopPatch = () => {};
  document.body.innerHTML = '';
  localStorage.clear();
  resetPageUrl();
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

  it('resolves the reply a response menu belongs to for single-reply export', () => {
    setPageUrl('https://gemini.google.com/app/abc');
    mountReactPage();
    const policy = createGeminiCollectorPolicy(resolveExportAdapter());
    const [, latestMore] = document.querySelectorAll<HTMLElement>(
      '[data-testid="response-more-button"]',
    );
    expect(policy.assistantMessageIdFor(latestMore)).toBe('u-1:a');
  });

  it('accepts an online LaTeX line repair proved against the React prompt hosts', async () => {
    setPageUrl('https://gemini.google.com/app/abc');
    // A later rename drops the prompt-content test id, so only an online fix can find the lines.
    document.body.innerHTML = `<div data-chat-scrollport><article><div>
      <section data-test-id="user-query"><div data-testid="user-prompt-bubble"><div><p>a</p><p>b</p></div></div></section>
    </div></article></div>`;
    const lines = Array.from(document.querySelectorAll('p'));
    stopPatch = await installGeminiSelectorPatch({
      'userLatex.lines': ['section[data-test-id="user-query"] p'],
    });
    expect(resolveGeminiUserLatexLines(document).value).toEqual(lines);
  });

  it('treats the scrollport and composer dock as app regions beside the sidebar', () => {
    for (const region of [
      '<div data-chat-scrollport><article id="turn"><p id="text">x</p></article></div>',
      '<div data-chat-composer-dock><div id="turn"><p id="text">x</p></div></div>',
    ]) {
      // An outer landmark around the whole app is a shell, not a copied preview.
      document.body.innerHTML = `<form id="shell"><main><side-navigation-content></side-navigation-content>${region}</main></form>`;
      const text = document.getElementById('text')!;
      expect(hasGeminiBoundaryConflict(text, document.getElementById('turn'), 'form')).toBe(false);
    }
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
