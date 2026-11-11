// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/c/6740a1b2-58cd-8001-9a3e-0f1e2d3c4b5a" }
import { afterEach, describe, expect, it } from 'vitest';

import { MAX_PAGE_OUTLINE_CHARS } from '@/features/plugins/local/creation/messages';
import { DEFAULT_ADAPTERS } from '@/features/plugins/sites/registry';

import { buildPageOutline, pathShape } from '../pageOutline';

const chatgpt = DEFAULT_ADAPTERS.find((site) => site.id === 'chatgpt')!;
const URL_NOW = location.href;

const SECRETS = {
  email: 'ada.lovelace@example.org',
  uuid: '6740a1b2-58cd-8001-9a3e-0f1e2d3c4b5a',
  account: 'Ada Lovelace',
  draft: 'my unsent draft about the merger',
  prompt: 'What should I tell my landlord',
  reply: 'Your landlord must give notice',
  title: 'Tenancy dispute',
};

/** A ChatGPT conversation as the page shapes it, with something private in every slot an outline could leak. */
function conversation(replies: number): void {
  const turn = (index: number) => `
    <div data-turn-key="turn-${SECRETS.uuid}-${index}" class="group/turn text-token-text-primary msg-${SECRETS.uuid}">
      <div data-content-search-turn-key="k-${index}" data-testid="${SECRETS.email}">
        <div data-user-message-bubble="true" aria-label="${SECRETS.account}" title="${SECRETS.title}">
          <p>${SECRETS.prompt} ${SECRETS.email}</p>
        </div>
        <div data-chatgpt-selection-message-id="${SECRETS.uuid}">
          <div data-dil-source-message-id="${SECRETS.uuid}" role="article" data-message-id="${SECRETS.uuid}">
            <div class="markdown prose"><p>${SECRETS.reply}</p><a href="https://chatgpt.com/c/${SECRETS.uuid}">link</a></div>
            <pre><code>const secret = "${SECRETS.email}";</code></pre>
          </div>
        </div>
      </div>
    </div>`;
  document.body.innerHTML = `
    <nav aria-label="Chat history"><a href="/c/${SECRETS.uuid}">${SECRETS.title}</a><span>${SECRETS.account}</span></nav>
    <main>
      <div data-app-action-timeline-scroll="">${Array.from({ length: replies }, (_, index) => turn(index)).join('')}</div>
      <form data-type="unified-composer">
        <div id="prompt-textarea" contenteditable="true" data-placeholder="${SECRETS.draft}"><p>${SECRETS.draft}</p></div>
        <button type="submit" data-testid="send-button" aria-label="Send">Send</button>
      </form>
    </main>`;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the page outline a creation message carries', () => {
  it('names structure only: no text, ids, emails, names or URLs from the page', () => {
    conversation(3);
    const outline = buildPageOutline(document, chatgpt, URL_NOW);
    for (const [slot, secret] of Object.entries(SECRETS))
      expect(outline, slot).not.toContain(secret);
    expect(outline).not.toMatch(/https?:\/\//);
    expect(outline).not.toContain('6740');
    // What it does say: the tags, attribute names and plain values an author targets.
    expect(outline).toContain('Path: /c/*');
    expect(outline).toContain('[data-dil-source-message-id]');
    expect(outline).toContain('[role="article"]');
    expect(outline).toContain('.markdown.prose');
  });

  it('counts each anchor and the reply marker, and leaves the composer’s contents out', () => {
    conversation(3);
    const outline = buildPageOutline(document, chatgpt, URL_NOW);
    expect(outline).toContain('- userTurn: 3');
    expect(outline).toContain('- assistantTurn: 3');
    expect(outline).toMatch(/- reply, one per AI reply \(\[data-dil-source-message-id\]\): 3/);
    expect(outline).toContain('- composer: 1');
  });

  it('leaves out what is inside a composer that sits in a message, such as an edit box', () => {
    conversation(1);
    const bubble = document.querySelector('[data-user-message-bubble]')!;
    bubble.innerHTML = `<div data-composer-markdown="" contenteditable="true"><p data-edit-line="">${SECRETS.draft}</p></div>`;
    const outline = buildPageOutline(document, chatgpt, URL_NOW);
    expect(outline).toContain('(composer; contents left out)');
    expect(outline).not.toContain('data-edit-line');
  });

  it('says there is no conversation on a page without one', () => {
    document.body.innerHTML =
      '<main><form><div id="prompt-textarea" contenteditable="true"></div></form></main>';
    const outline = buildPageOutline(document, chatgpt, 'https://chatgpt.com/');
    expect(outline).toContain('- userTurn: 0');
    expect(outline).toContain('No AI reply on this page.');
    expect(outline).toContain('No user message on this page.');
  });

  it('stays within its ceiling and reads the same page the same way', () => {
    conversation(400);
    const outline = buildPageOutline(document, chatgpt, URL_NOW);
    expect(outline.length).toBeLessThanOrEqual(MAX_PAGE_OUTLINE_CHARS);
    expect(outline).toContain('- userTurn: 400');
    expect(buildPageOutline(document, chatgpt, URL_NOW)).toBe(outline);
  });

  it('keeps route words and hides every other path segment', () => {
    expect(pathShape(`https://chatgpt.com/g/g-p-${SECRETS.uuid}-rent/project`, chatgpt)).toBe(
      '/g/*/project',
    );
    expect(pathShape('https://chatgpt.com/', chatgpt)).toBe('/');
  });
});
