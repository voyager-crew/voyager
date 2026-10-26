import { afterEach, describe, expect, it, vi } from 'vitest';

import { initializeSiteSelectors } from '@/core/selectors';
import { preservesCompleteContent } from '@/core/selectors/contentIntegrity';

import { resolveExportMessageContent } from '../exportContentRoots';

const stops: Array<() => void> = [];
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  document.body.replaceChildren();
});

async function online(siteId: string, host: string, selector: string): Promise<void> {
  const running = initializeSiteSelectors(siteId, {
    host,
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 0,
    read: async () => ({
      id: siteId,
      catalogRevision: 1,
      locators: { 'export.assistantContent': [selector] },
    }),
  });
  stops.push(running.stop);
  await running.ready;
}

function message(markup: string): HTMLElement {
  document.body.innerHTML = `<article>${markup}</article>`;
  return document.querySelector('article')!;
}

describe('site-owned export bodies', () => {
  it.each([
    ['chatgpt', 'chatgpt.com'],
    ['claude', 'claude.ai'],
    ['deepseek', 'chat.deepseek.com'],
    ['kimi', 'www.kimi.com'],
  ])('a %s body has the same nodes through bundled and online profiles', async (siteId, host) => {
    const owner = message(
      '<div class="markdown body"><p>Answer <strong>one</strong></p><img src="https://example.test/image.png"></div><button>Copy</button>',
    );
    const bundled = resolveExportMessageContent(owner, siteId);
    await online(siteId, host, '.body');
    const remote = resolveExportMessageContent(owner, siteId);
    expect(remote).toBe(bundled);
    expect(remote.innerHTML).toBe(
      '<p>Answer <strong>one</strong></p><img src="https://example.test/image.png">',
    );
  });

  it('an unrelated online input repair adds no body scans to a bundled export', async () => {
    const owner = message('<div class="markdown"><p>Answer</p></div>');
    const scans = vi.spyOn(owner, 'querySelectorAll');
    const bundled = resolveExportMessageContent(owner, 'claude');
    const count = scans.mock.calls.length;
    const running = initializeSiteSelectors('claude', {
      host: 'claude.ai',
      doc: document,
      lifetime: new AbortController().signal,
      bundledRevision: 0,
      read: async () => ({
        id: 'claude',
        catalogRevision: 1,
        locators: { 'input.candidates': ['.renamed-input'] },
      }),
    });
    stops.push(running.stop);
    await running.ready;
    scans.mockClear();
    expect(resolveExportMessageContent(owner, 'claude')).toBe(bundled);
    expect(scans.mock.calls.length).toBe(count);
    scans.mockRestore();
  });

  it('a renamed complete body is repaired inside the message that started the export', async () => {
    const owner = message(
      '<div class="new-body"><p>Answer</p><pre><code>sample()</code></pre></div><button>Copy</button>',
    );
    expect(resolveExportMessageContent(owner, 'claude')).toBe(owner);
    await online('claude', 'claude.ai', '.new-body');
    expect(resolveExportMessageContent(owner, 'claude')).toBe(owner.firstElementChild);
    expect(resolveExportMessageContent(owner, 'claude').textContent).toBe('Answersample()');
  });

  it('a partial body cannot drop a sibling image from an export', async () => {
    const owner = message(
      '<div class="partial"><p>Answer</p></div><img src="https://example.test/image.png">',
    );
    await online('chatgpt', 'chatgpt.com', '.partial');
    const body = resolveExportMessageContent(owner, 'chatgpt');
    expect(body).toBe(owner);
    expect(body.querySelector('img')?.src).toBe('https://example.test/image.png');
  });

  it('a same-text duplicate cannot replace the bundled answer', async () => {
    const owner = message(
      '<div class="markdown"><p>Answer</p></div><div class="duplicate"><p>Answer</p></div>',
    );
    await online('deepseek', 'chat.deepseek.com', '.duplicate');
    expect(resolveExportMessageContent(owner, 'deepseek')).toBe(owner.firstElementChild);
  });

  it('a partial online body cannot drop code inside a sibling shadow root', async () => {
    const owner = message('<div class="body"><p>Answer</p></div><x-code></x-code>');
    const shadow = owner.querySelector('x-code')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<pre><code>important()</code></pre>';
    await online('claude', 'claude.ai', '.body');
    const body = resolveExportMessageContent(owner, 'claude');
    expect(body).toBe(owner);
    expect(body.querySelector('x-code')?.shadowRoot?.textContent).toBe('important()');
  });

  it('an online light-DOM body cannot discard the original message shadow content', async () => {
    const owner = message('<div class="body"><p>Answer</p></div>');
    owner.attachShadow({ mode: 'open' }).innerHTML = '<pre><code>shadow()</code></pre>';
    await online('claude', 'claude.ai', '.body');
    expect(resolveExportMessageContent(owner, 'claude')).toBe(owner);
    expect(resolveExportMessageContent(owner, 'claude').shadowRoot?.textContent).toBe('shadow()');
  });

  it('a partial body cannot drop a licensed image inside a native button', async () => {
    const owner = message(
      '<div class="body"><p>Answer</p></div><button class="image-button"><img src="https://example.test/licensed.png"></button>',
    );
    await online('chatgpt', 'chatgpt.com', '.body');
    expect(resolveExportMessageContent(owner, 'chatgpt')).toBe(owner);
    expect(resolveExportMessageContent(owner, 'chatgpt').querySelector('img')?.src).toBe(
      'https://example.test/licensed.png',
    );
  });

  it('a partial body cannot discard formula source before its glyphs have rendered', async () => {
    const owner = message(
      '<div class="body"><p>Answer</p></div><span class="katex" data-math-source="x^2"></span>',
    );
    await online('chatgpt', 'chatgpt.com', '.body');
    expect(resolveExportMessageContent(owner, 'chatgpt')).toBe(owner);
    expect(
      resolveExportMessageContent(owner, 'chatgpt')
        .querySelector('.katex')
        ?.getAttribute('data-math-source'),
    ).toBe('x^2');
  });

  it('a broader remote wrapper cannot replace the bundled answer body', async () => {
    const owner = message('<div class="wrapper"><div class="markdown"><p>Answer</p></div></div>');
    await online('claude', 'claude.ai', '.wrapper');
    expect(resolveExportMessageContent(owner, 'claude')).toBe(owner.querySelector('.markdown'));
  });

  it('two matching bodies cannot hide the second part of the answer', async () => {
    const owner = message(
      '<div class="body"><div class="body"><p>First</p><p>Second</p></div></div>',
    );
    await online('kimi', 'www.kimi.com', '.body');
    expect(resolveExportMessageContent(owner, 'kimi')).toBe(owner);
    expect(resolveExportMessageContent(owner, 'kimi').textContent).toBe('FirstSecond');
  });

  it('selecting a paragraph as the body cannot discard its formatting frame', async () => {
    const owner = message('<p class="body">Complete answer</p>');
    await online('claude', 'claude.ai', '.body');
    expect(resolveExportMessageContent(owner, 'claude')).toBe(owner);
    expect(resolveExportMessageContent(owner, 'claude').innerHTML).toBe(
      '<p class="body">Complete answer</p>',
    );
  });

  it('an input cannot become the exported body even if its text is the whole message', async () => {
    const owner = message('<div contenteditable="true" class="body">Draft</div>');
    await online('chatgpt', 'chatgpt.com', '.body');
    expect(resolveExportMessageContent(owner, 'chatgpt')).toBe(owner);
  });

  it('a body from another message cannot pass completeness with identical text', () => {
    const owner = message('<div>Same answer</div>');
    const other = document.createElement('div');
    other.textContent = 'Same answer';
    document.body.append(other);
    expect(preservesCompleteContent(other, owner)).toBe(false);
    expect(preservesCompleteContent(document.body, owner)).toBe(false);
    expect(preservesCompleteContent(owner.firstElementChild!, owner)).toBe(true);
  });
});
