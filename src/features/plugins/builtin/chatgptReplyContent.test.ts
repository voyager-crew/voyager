import { afterEach, describe, expect, it } from 'vitest';

import { getBundledSiteSelectorView, type SiteSelectorView } from '@/core/selectors';

import { resolveChatgptReplyContent } from './chatgptReplyContent';

const KEY = 'bridge.replyContent';

function remote(selector: string): SiteSelectorView {
  const bundle = getBundledSiteSelectorView('chatgpt');
  return {
    ...bundle,
    profiles: { ...bundle.profiles, [KEY]: [selector] },
    remoteKeys: new Set([KEY]),
    revision: 20,
  };
}

function response(markup: string): HTMLElement {
  const reply = document.createElement('article');
  reply.innerHTML = markup;
  document.body.append(reply);
  return reply;
}

afterEach(() => document.body.replaceChildren());

describe('ChatGPT bridge reply content', () => {
  it('reads the same original body and content with bundled and online profiles', () => {
    const reply = response(
      '<h4 data-conversation-role="assistant">ChatGPT said:</h4><div data-markdown-text-style="assistant-message" data-body><p>Answer</p><pre>code</pre><img src="data:image/png;base64,AA=="></div>',
    );
    const bundled = resolveChatgptReplyContent(reply, getBundledSiteSelectorView('chatgpt'));
    const online = resolveChatgptReplyContent(reply, remote('[data-body]'));
    expect(online).toBe(bundled);
    expect(online.innerHTML).toBe(
      '<p>Answer</p><pre>code</pre><img src="data:image/png;base64,AA==">',
    );
  });

  it('repairs a renamed complete reply wrapper while retaining code and images', () => {
    const reply = response(
      '<h4 data-conversation-role="assistant">ChatGPT said:</h4><div data-new-body><p>Answer</p><pre>code</pre><img src="data:image/png;base64,AA=="></div>',
    );
    const body = resolveChatgptReplyContent(reply, remote('[data-new-body]'));
    expect(body).toBe(reply.querySelector('[data-new-body]'));
    expect(body.textContent).toBe('Answercode');
    expect(body.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AA==');
  });

  it('a partial online body cannot drop the rest of a bridge reply', () => {
    const reply = response(
      '<h4 data-conversation-role="assistant">ChatGPT said:</h4><div data-body><p>First part</p></div><p>Final answer</p>',
    );
    const body = resolveChatgptReplyContent(reply, remote('[data-body]'));
    expect(body.textContent).toBe('First partFinal answer');
    expect(body.querySelectorAll('p')).toHaveLength(2);
  });

  it('an online wrapper cannot replace a known body with surrounding file-card text', () => {
    const reply = response(
      '<div data-wrapper><div data-markdown-text-style="assistant-message">Answer</div><aside>Download private-file.txt</aside></div>',
    );
    const body = resolveChatgptReplyContent(reply, remote('[data-wrapper]'));
    expect(body).toBe(reply.querySelector('[data-markdown-text-style]'));
    expect(body.textContent).toBe('Answer');
  });

  it('two complete-looking online wrappers keep the original response as the extraction root', () => {
    const reply = response('<div data-body><div data-body><p>Whole answer</p></div></div>');
    const body = resolveChatgptReplyContent(reply, remote('[data-body]'));
    expect(body).toBe(reply);
    expect(body.textContent).toBe('Whole answer');
  });

  it('a same-text paragraph cannot become the body and lose its serialization frame', () => {
    const reply = response('<p data-body><a href="https://example.com">Linked answer</a></p>');
    const body = resolveChatgptReplyContent(reply, remote('[data-body]'));
    expect(body).toBe(reply);
    expect(body.querySelector('p > a')?.getAttribute('href')).toBe('https://example.com');
  });

  it('another response with identical text cannot become the requested reply', () => {
    const reply = response('<div><p>Same answer</p></div>');
    response('<div data-body><p>Same answer</p></div>');
    const body = resolveChatgptReplyContent(reply, remote('[data-body]'));
    expect(body).toBe(reply);
    expect(body.textContent).toBe('Same answer');
  });
});
