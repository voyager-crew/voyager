import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createContentExtractor } from '@/features/export/services/DOMContentExtractor';
import { buildChatGptAdapter } from '@/pages/content/export/adapter/platform/chatgpt';

import { requireBundledSiteAdapter } from '../catalog/sites';
import { PluginScope } from '../runtime/pluginScope';
import type { SiteAdapter } from '../types';
import type { CodeBlockDiagramParams } from './codeBlockDiagram';
import {
  chatgptReply,
  drawn,
  fenced,
  toolbarButtons,
} from './mermaid/__tests__/diagramBridgeFixtures';
import { mermaidPrimitive } from './mermaid/index';
import type { Primitive, PrimitiveContext } from './types';

const mermaidLibrary = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock('mermaid', () => ({ default: mermaidLibrary }));
vi.mock('@/pages/content/mermaid/isolatedRender', async () => ({
  renderInIsolatedDocument: (await import('@/pages/mermaidRenderer/render')).renderMermaidDocument,
}));

const FLOWCHART = 'flowchart TD\n  Start --> Middle\n  Middle --> Finish';
const LIGHT_DIRECTIVE = '%%{init: {"theme":"default"}}%%';
const chatgpt = requireBundledSiteAdapter('chatgpt');

const scopes: PluginScope[] = [];
function activate(
  primitive: Primitive<CodeBlockDiagramParams>,
  adapter: SiteAdapter,
  params: CodeBlockDiagramParams,
): PluginScope {
  const scope = new PluginScope();
  scopes.push(scope);
  const context: PrimitiveContext = {
    doc: document,
    adapter,
    pluginId: 'test.diagrams',
    settings: {},
    setTargetCounter: () => {},
  };
  void primitive.activate(scope, params, context);
  return scope;
}

const exportChatGpt = (reply: HTMLElement) =>
  createContentExtractor(buildChatGptAdapter(chatgpt)).extractAssistantContent(reply);

beforeEach(() => {
  mermaidLibrary.initialize.mockReset();
  mermaidLibrary.render.mockReset();
  mermaidLibrary.render.mockImplementation(async (_id: string, code: string) => ({
    svg: `<svg viewBox="0 0 10 10"><text>${code.includes(LIGHT_DIRECTIVE) ? 'Light' : code.includes('Left') ? 'Other' : 'Diagram'}</text></svg>`,
  }));
  document.head.replaceChildren();
  document.body.innerHTML = '<main></main>';
});

afterEach(async () => {
  await Promise.all(scopes.splice(0).map((scope) => scope.dispose()));
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-gv-scheme');
});

describe('ChatGPT diagram export when the plugin asks for the image', () => {
  const asked: CodeBlockDiagramParams = { codeBlock: 'pre', exportImage: true };
  const count = (text: string, part: string) => text.split(part).length - 1;

  it('exports the light drawing of a diagram block among the reply text, and its source once in Markdown', async () => {
    document.documentElement.setAttribute('data-gv-scheme', 'dark');
    const reply = chatgptReply(FLOWCHART);
    activate(mermaidPrimitive, chatgpt, asked);
    await vi.waitFor(() => expect(drawn(reply)).toBe('Diagram'));

    const exported = exportChatGpt(reply);

    const html = document.createElement('div');
    html.innerHTML = exported.html;
    expect(html.querySelector('.gv-export-mermaid svg')?.textContent).toBe('Light');
    expect(html.querySelector('pre')).toBeNull();
    expect(exported.text).toContain('Here it is:');
    expect(count(exported.text, fenced('mermaid', FLOWCHART))).toBe(1);
    expect(exported.hasCode).toBe(true);
  });

  it('exports a bare pre > code diagram block once, as its drawing', async () => {
    const reply = document.createElement('div');
    reply.innerHTML = `<div class="markdown"><pre><code class="language-mermaid"></code></pre></div>`;
    reply.querySelector('code')!.textContent = FLOWCHART;
    document.querySelector('main')!.append(reply);
    activate(mermaidPrimitive, chatgpt, {
      turn: 'main > div',
      codeBlock: 'pre',
      exportImage: true,
    });
    await vi.waitFor(() => expect(drawn(reply)).toBe('Diagram'));

    const exported = exportChatGpt(reply);

    expect(exported.html).toContain('gv-export-mermaid');
    expect(exported.html).not.toContain('<pre>');
    expect(count(exported.text, fenced('mermaid', FLOWCHART))).toBe(1);
  });

  it('exports the drawing of a diagram block inside a list item', async () => {
    document.documentElement.setAttribute('data-gv-scheme', 'dark');
    const reply = chatgptReply(FLOWCHART, { inList: true });
    activate(mermaidPrimitive, chatgpt, asked);
    await vi.waitFor(() => expect(drawn(reply)).toBe('Diagram'));

    const exported = exportChatGpt(reply);

    expect(exported.html).toContain('gv-export-mermaid');
    expect(exported.html).toContain('Light');
    expect(exported.text).toContain('mermaid');
  });

  it('exports the source of a diagram block shown as code', async () => {
    const reply = chatgptReply(FLOWCHART);
    activate(mermaidPrimitive, chatgpt, asked);
    await vi.waitFor(() => expect(drawn(reply)).toBe('Diagram'));
    // The toolbar's Code button (copy is off): the drawing is not what the reader sees.
    toolbarButtons(reply)[1].click();

    const exported = exportChatGpt(reply);

    expect(exported.html).not.toContain('gv-export-mermaid');
    expect(exported.html).toContain('language-mermaid');
    expect(count(exported.text, fenced('mermaid', FLOWCHART))).toBe(1);
  });
});
