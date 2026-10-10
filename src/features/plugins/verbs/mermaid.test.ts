import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createContentExtractor } from '@/features/export/services/DOMContentExtractor';
import { turnSummary } from '@/features/timeline/adapters/catalog/turnHash';
import { buildChatGptAdapter } from '@/pages/content/export/adapter/platform/chatgpt';

import { requireBundledSiteAdapter } from '../catalog/sites';
import { PluginScope } from '../runtime/pluginScope';
import type { SiteAdapter } from '../types';
import { mermaidPrimitive } from './mermaid';
import type { PrimitiveContext } from './types';

const library = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock('mermaid', () => ({ default: library }));

const FLOWCHART = 'flowchart TD\n  Start --> Middle\n  Middle --> Finish\n  Finish --> Done';

/** ChatGPT's reply code block: header label, copy button, then `code.language-*`. */
function chatgptReply(source: string, language = 'mermaid'): HTMLElement {
  const reply = document.createElement('div');
  reply.setAttribute(
    'data-chatgpt-selection-message-id',
    `m${document.querySelectorAll('*').length}`,
  );
  reply.innerHTML =
    '<div class="markdown"><p>Here it is:</p><pre class="overflow-visible!"><div class="contain-inline-size">' +
    `<div class="flex items-center">${language}</div>` +
    '<div class="sticky"><button aria-label="Copy">Copy code</button></div>' +
    `<div class="overflow-y-auto p-4" dir="ltr"><code class="whitespace-pre! language-${language}"></code></div>` +
    '</div></pre></div>';
  reply.querySelector('code')!.textContent = source;
  document.querySelector('main')!.append(reply);
  return reply;
}

/** Claude's reply code block: label and copy button around `pre > code.language-*`. */
function claudeReply(source: string, language = 'mermaid'): HTMLElement {
  const reply = document.createElement('div');
  reply.className = 'font-claude-message';
  reply.innerHTML =
    `<div class="relative group/copy"><div class="text-text-500">${language}</div>` +
    '<div class="overflow-x-auto"><pre class="code-block__code">' +
    `<code class="language-${language}"></code></pre></div></div>`;
  reply.querySelector('code')!.textContent = source;
  document.querySelector('main')!.append(reply);
  return reply;
}

const sites = [
  { adapter: requireBundledSiteAdapter('chatgpt'), reply: chatgptReply },
  { adapter: requireBundledSiteAdapter('claude'), reply: claudeReply },
];
const chatgpt = sites[0];

let scope: PluginScope;

function activate(adapter: SiteAdapter, params = {}) {
  let counter: () => number = () => -1;
  const context: PrimitiveContext = {
    doc: document,
    adapter,
    pluginId: 'test.diagram-rendering',
    settings: {},
    setTargetCounter: (count) => (counter = count),
  };
  void mermaidPrimitive.activate(scope, params, context);
  return { count: () => counter() };
}

const panelOf = (reply: Element) => reply.querySelector<HTMLElement>('.gv-diagram-panel');
const drawn = (reply: Element) =>
  panelOf(reply)?.shadowRoot?.querySelector('.diagram')?.textContent ?? null;

beforeEach(() => {
  library.initialize.mockReset();
  library.render.mockReset();
  library.render.mockResolvedValue({ svg: '<svg><text>Diagram</text></svg>' });
  document.head.replaceChildren();
  document.body.innerHTML = '<main></main>';
  scope = new PluginScope();
});

afterEach(async () => {
  await scope.dispose();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-gv-scheme');
});

describe('mermaid primitive', () => {
  it('accepts optional selectors and rejects anything else', () => {
    expect(mermaidPrimitive.validateParams(undefined)).toEqual({ success: true, data: {} });
    const params = { codeBlock: '.md-code-block', code: 'pre', language: '.label' };
    expect(mermaidPrimitive.validateParams(params)).toEqual({ success: true, data: params });
    expect(mermaidPrimitive.validateParams({ codeLine: ' ' }).success).toBe(false);
    expect(mermaidPrimitive.validateParams({ theme: 'dark' }).success).toBe(false);
    expect(mermaidPrimitive.validateParams([]).success).toBe(false);
  });

  it('a ChatGPT mermaid code block renders as a diagram', async () => {
    const reply = chatgptReply(FLOWCHART);
    const { count } = activate(chatgpt.adapter);

    await vi.waitFor(() => expect(drawn(reply)).toBe('Diagram'));
    const pre = reply.querySelector('pre')!;
    expect(panelOf(reply)!.nextElementSibling).toBe(pre);
    expect(pre.hasAttribute('data-gv-diagram-hidden')).toBe(true);
    expect(library.render).toHaveBeenCalledWith(expect.any(String), FLOWCHART);
    // Plugin sites export the code, so no second light-theme render.
    expect(library.render).toHaveBeenCalledTimes(1);
    expect(count()).toBe(1);
  });

  it.each(sites)('renders a mermaid block that arrives later on $adapter.label', async (site) => {
    activate(site.adapter);
    const reply = site.reply(FLOWCHART);

    await vi.waitFor(() => expect(drawn(reply)).toBe('Diagram'), { timeout: 3000 });
    expect(reply.querySelector('pre')!.hasAttribute('data-gv-diagram-hidden')).toBe(true);
  });

  it('turning the plugin off restores the code block', async () => {
    const reply = chatgptReply(FLOWCHART);
    const markdown = reply.querySelector('.markdown')!;
    const before = markdown.innerHTML;
    const pre = reply.querySelector('pre')!;
    const copy = reply.querySelector('button')!;
    activate(chatgpt.adapter);
    await vi.waitFor(() => expect(drawn(reply)).toBe('Diagram'));

    await scope.dispose();

    expect(panelOf(reply)).toBeNull();
    expect(markdown.innerHTML).toBe(before);
    expect(reply.querySelector('pre')).toBe(pre);
    expect(reply.querySelector('button')).toBe(copy);
    expect(document.getElementById('gv-mermaid-styles')).toBeNull();
    expect(document.querySelector('style[data-gv-plugin-scope]')).toBeNull();
  });

  it('a non-mermaid code block is left alone', async () => {
    // Mermaid-looking text under another language label stays code, as on Gemini.
    const python = chatgptReply(FLOWCHART, 'python');
    const short = chatgptReply('graph TD\nA-->B', 'text');
    const mermaid = chatgptReply(FLOWCHART);
    activate(chatgpt.adapter);

    await vi.waitFor(() => expect(drawn(mermaid)).toBe('Diagram'));
    for (const reply of [python, short]) {
      expect(panelOf(reply)).toBeNull();
      expect(reply.querySelector('pre')!.hasAttribute('data-gv-diagram-hidden')).toBe(false);
    }
    expect(library.render).toHaveBeenCalledTimes(1);
  });

  it('an unlabelled block that reads as a complete diagram renders', async () => {
    const reply = chatgptReply(FLOWCHART, 'plaintext');
    activate(chatgpt.adapter);

    await vi.waitFor(() => expect(drawn(reply)).toBe('Diagram'));
  });

  it('a code block in a user message is left alone', async () => {
    const user = document.createElement('div');
    user.setAttribute('data-message-author-role', 'user');
    user.innerHTML = '<pre><code class="language-mermaid"></code></pre>';
    user.querySelector('code')!.textContent = FLOWCHART;
    document.querySelector('main')!.append(user);
    const reply = chatgptReply(FLOWCHART);
    activate(chatgpt.adapter);

    await vi.waitFor(() => expect(drawn(reply)).toBe('Diagram'));
    expect(panelOf(user)).toBeNull();
  });

  it('the Code toggle shows the untouched host block and keeps the choice across redraws', async () => {
    const reply = chatgptReply(FLOWCHART);
    const pre = reply.querySelector('pre')!;
    activate(chatgpt.adapter);
    await vi.waitFor(() => expect(drawn(reply)).toBe('Diagram'));
    const [diagramButton, codeButton] = Array.from(
      panelOf(reply)!.shadowRoot!.querySelectorAll('button'),
    );

    codeButton.click();
    expect(pre.hasAttribute('data-gv-diagram-hidden')).toBe(false);
    expect(codeButton.getAttribute('aria-pressed')).toBe('true');

    library.render.mockResolvedValue({ svg: '<svg><text>Updated</text></svg>' });
    reply.querySelector('code')!.textContent = `${FLOWCHART}\n  Done --> Again`;
    await vi.waitFor(() => expect(drawn(reply)).toBe('Updated'), { timeout: 3000 });
    expect(pre.hasAttribute('data-gv-diagram-hidden')).toBe(false);
    expect(reply.querySelectorAll('.gv-diagram-panel')).toHaveLength(1);

    diagramButton.click();
    expect(pre.hasAttribute('data-gv-diagram-hidden')).toBe(true);
  });

  it('a syntax error shows the error card instead of the diagram', async () => {
    library.render.mockRejectedValue(new Error('Parse error on line 2'));
    const reply = chatgptReply('flowchart TD\n  A -->');
    activate(chatgpt.adapter);

    await vi.waitFor(() => expect(drawn(reply)).toContain('Parse error on line 2'));
  });

  it('a rendered reply keeps its timeline summary and exports its code', async () => {
    const reply = chatgptReply(FLOWCHART);
    const summary = turnSummary(reply);
    activate(chatgpt.adapter);
    await vi.waitFor(() => expect(drawn(reply)).toBe('Diagram'));

    expect(turnSummary(reply)).toBe(summary);
    const extractor = createContentExtractor(buildChatGptAdapter(chatgpt.adapter));
    const exported = extractor.extractAssistantContent(reply);
    expect(exported.text).toContain(`\`\`\`mermaid\n${FLOWCHART}\n\`\`\``);
    expect(exported.text).not.toContain('Diagram');
  });

  it('draws with the page scheme and redraws when it changes', async () => {
    document.documentElement.setAttribute('data-gv-scheme', 'dark');
    const reply = chatgptReply(FLOWCHART);
    activate(chatgpt.adapter);
    await vi.waitFor(() => expect(drawn(reply)).toBe('Diagram'));
    expect(library.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'dark' }));

    library.render.mockResolvedValue({ svg: '<svg><text>Light</text></svg>' });
    document.documentElement.setAttribute('data-gv-scheme', 'light');

    await vi.waitFor(() => expect(drawn(reply)).toBe('Light'));
    expect(library.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: 'default' }),
    );
  });

  it('a page without Mermaid never loads the library', async () => {
    chatgptReply('print("hi")', 'python');
    activate(chatgpt.adapter);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(library.initialize).not.toHaveBeenCalled();
  });
});
