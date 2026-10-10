import { beforeEach, describe, expect, it } from 'vitest';

import { createContentExtractor } from '@/features/export/services/DOMContentExtractor';
import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';

import { buildChatGptAdapter } from '../platform/chatgpt';

const extractor = createContentExtractor(buildChatGptAdapter(chatgptAdapter));

/**
 * ChatGPT's code block as measured on the live site in October 2026: no `pre`,
 * no `language-*` class; the header's localized label names the language.
 */
function codeBlockMarkup(label: string, lines: string[]): string {
  const code = lines.map((line) => `<span>${line}</span>`).join('\n');
  return (
    '<div data-markdown-copy="code-block" class="CodeSurface" data-theme="light">' +
    '<div data-markdown-copy="exclude" class="StickyActionBar"><svg></svg>' +
    `<div class="min-w-0 flex-1 truncate">${label}</div>` +
    '<div><button aria-label="启用自动换行"><svg></svg></button>' +
    '<button aria-label="复制"><svg></svg>复制</button></div></div>' +
    `<div><code class="whitespace-pre! block"><span>${code}</span></code></div>` +
    '</div>'
  );
}

function reply(innerHtml: string): HTMLElement {
  const element = document.createElement('div');
  element.innerHTML = `<div class="markdown"><p>Here it is:</p>${innerHtml}<p>Done.</p></div>`;
  document.body.append(element);
  return element;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('ChatGPT code block export', () => {
  it('a ChatGPT code block exports as a fenced block with its language', () => {
    const exported = extractor.extractAssistantContent(
      reply(codeBlockMarkup('python', ['def add(a, b):', '    return a + b'])),
    );

    expect(exported.text).toBe(
      'Here it is:\n\n```python\ndef add(a, b):\n    return a + b\n```\nDone.',
    );
    expect(exported.html).toContain('<pre><code class="language-python">def add(a, b):');
    expect(exported.hasCode).toBe(true);
  });

  it('an untagged ChatGPT code block exports without header text', () => {
    const exported = extractor.extractAssistantContent(
      reply(codeBlockMarkup('纯文本', ['graph TD', '  A[开始] --&gt; B[处理]'])),
    );

    expect(exported.text).toContain('```\ngraph TD\n  A[开始] --> B[处理]\n```');
    expect(exported.text).not.toContain('纯文本');
    expect(exported.text).not.toContain('复制');
    expect(exported.hasCode).toBe(true);
  });

  it('a plain-text label in a language-id shape is not taken as the language', () => {
    const exported = extractor.extractAssistantContent(
      reply(codeBlockMarkup('plaintext', ['just words'])),
    );

    expect(exported.text).toContain('```\njust words\n```');
  });

  it('older pre code blocks still export', () => {
    const exported = extractor.extractAssistantContent(
      reply(
        '<pre><div><div>python</div><div><button>Copy code</button></div>' +
          '<div><code class="hljs language-python">print("hi")\nprint("bye")</code></div></div></pre>',
      ),
    );

    expect(exported.text).toBe('Here it is:\n\n```python\nprint("hi")\nprint("bye")\n```\nDone.');
    expect(exported.text).not.toContain('Copy code');
    expect(exported.hasCode).toBe(true);
  });

  it('a natively drawn Mermaid chart without its source leaves no chart text behind', () => {
    const exported = extractor.extractAssistantContent(
      reply(
        '<div data-chatgpt-mermaid-preview="">' +
          '<svg><g><text>开始</text></g><g><text>处理</text></g></svg></div>',
      ),
    );

    expect(exported.text).toBe('Here it is:\nDone.');
  });
});
