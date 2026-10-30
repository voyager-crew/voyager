/**
 * The diagram primitives as Gemini's official plugins call them: export keeps
 * the drawn image (PNG/PDF) and the fenced source (Markdown), the toolbar can
 * copy the source while the diagram hides Gemini's own copy button, and the
 * fullscreen styles two diagram plugins share stay until the last one leaves.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createContentExtractor } from '@/features/export/services/DOMContentExtractor';
import { buildChatGptAdapter } from '@/pages/content/export/adapter/platform/chatgpt';
import { buildGeminiAdapter } from '@/pages/content/export/adapter/platform/gemini';

import { requireBundledSiteAdapter } from '../catalog/sites';
import chatgptManifest from '../catalog/sites/chatgpt/plugins/diagram-rendering/plugin.json';
import echartsManifest from '../catalog/sites/gemini/plugins/echarts/plugin.json';
import mermaidManifest from '../catalog/sites/gemini/plugins/mermaid/plugin.json';
import waveDromManifest from '../catalog/sites/gemini/plugins/wavedrom/plugin.json';
import { PluginScope } from '../runtime/pluginScope';
import type { SiteAdapter } from '../types';
import type { CodeBlockDiagramParams } from './codeBlockDiagram';
import { readDiagramExport } from './diagramExportRegistry';
import { echartsPrimitive } from './echarts/index';
import {
  chatgptReply,
  drawn,
  fenced,
  geminiCodeBlock,
  geminiReply,
  panelOf,
  toolbarButtons,
} from './mermaid/__tests__/diagramBridgeFixtures';
import { mermaidPrimitive } from './mermaid/index';
import type { Primitive, PrimitiveContext } from './types';
import { wavedromPrimitive } from './wavedrom/index';

const mermaidLibrary = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock('mermaid', () => ({ default: mermaidLibrary }));
vi.mock('@/pages/content/mermaid/isolatedRender', async () => ({
  renderInIsolatedDocument: async (
    request: import('@/pages/mermaidRenderer/protocol').MermaidRenderRequest,
  ) => ({
    kind: 'rendered',
    diagram: await (await import('@/pages/mermaidRenderer/render')).renderMermaidDocument(request),
  }),
}));

const echartsLibrary = vi.hoisted(() => ({
  init: vi.fn(() => ({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    getDataURL: vi.fn(() => 'data:image/png;base64,Q0hBUlQ='),
  })),
}));
vi.mock('@/pages/content/echarts/runtime', () => ({ init: echartsLibrary.init }));

const FLOWCHART = 'flowchart TD\n  Start --> Middle\n  Middle --> Finish';
const OTHER_FLOWCHART = 'flowchart LR\n  Left --> Right';
const BAR_OPTION = `{
  "xAxis": { "type": "category", "data": ["A", "B"] },
  "yAxis": { "type": "value" },
  "series": [{ "type": "bar", "data": [1, 2] }]
}`;
/** Mermaid's light-theme directive: the renderer appends it to draw the export copy. */
const LIGHT_DIRECTIVE = '%%{init: {"theme":"default"}}%%';

const geminiSite = requireBundledSiteAdapter('gemini');
/** Gemini as the official plugins see it once its site.json names `code-block` (stage 3D). */
const gemini: SiteAdapter = {
  ...geminiSite,
  selectors: { ...geminiSite.selectors, codeBlock: 'code-block' },
};
const chatgpt = requireBundledSiteAdapter('chatgpt');

/** The params a shipped manifest passes to `handler`. */
function paramsOf(
  manifest: { contributes: { domOps: ReadonlyArray<{ handler: string; params: object }> } },
  handler: string,
): CodeBlockDiagramParams {
  return manifest.contributes.domOps.find((op) => op.handler === handler)!
    .params as CodeBlockDiagramParams;
}
const geminiMermaidParams = paramsOf(mermaidManifest, 'mermaid');
const geminiEChartsParams = paramsOf(echartsManifest, 'echarts');
const geminiWaveDromParams = paramsOf(waveDromManifest, 'wavedrom');

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

const exportGemini = (reply: HTMLElement) =>
  createContentExtractor(buildGeminiAdapter(gemini)).extractAssistantContent(reply);

beforeEach(() => {
  mermaidLibrary.initialize.mockReset();
  mermaidLibrary.render.mockReset();
  mermaidLibrary.render.mockImplementation(async (_id: string, code: string) => ({
    svg: `<svg viewBox="0 0 10 10"><text>${code.includes(LIGHT_DIRECTIVE) ? 'Light' : code.includes('Left') ? 'Other' : 'Diagram'}</text></svg>`,
  }));
  echartsLibrary.init.mockClear();
  document.head.replaceChildren();
  document.body.innerHTML = '<main></main>';
});

afterEach(async () => {
  await Promise.all(scopes.splice(0).map((scope) => scope.dispose()));
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-gv-scheme');
});

describe('Gemini diagram export', () => {
  it('exports a plugin-drawn diagram as an image in PNG and PDF and as fenced source in Markdown', async () => {
    const reply = geminiReply(`<p>Here:</p>${geminiCodeBlock(FLOWCHART, 'Mermaid')}`);
    activate(mermaidPrimitive, gemini, geminiMermaidParams);
    await vi.waitFor(() => expect(drawn(reply)).toBe('Diagram'));

    const exported = exportGemini(reply);

    // PNG and PDF render `html`: the export markup the image and print pipelines style.
    const html = document.createElement('div');
    html.innerHTML = exported.html;
    const image = html.querySelector('.gv-export-mermaid[data-gv-mermaid-theme="light"] > svg');
    expect(image?.textContent).toBe('Diagram');
    expect(html.querySelector('pre')).toBeNull();
    // Markdown renders `text`: the source, fenced, never the diagram's labels.
    expect(exported.text).toContain(fenced('mermaid', FLOWCHART));
    expect(exported.text).not.toContain('Diagram');
    expect(exported.hasCode).toBe(true);

    // Gemini's own code-block reading, which list and fallback paths call, agrees.
    const htmlParts: string[] = [];
    const textParts: string[] = [];
    const flags = { hasImages: false, hasFormulas: false, hasTables: false, hasCode: false };
    buildGeminiAdapter(gemini).extractCodeBlock(
      reply.querySelector('code-block')!,
      htmlParts,
      textParts,
      flags,
      'code-block',
    );
    expect(htmlParts.join('')).toContain('gv-export-mermaid');
    expect(textParts.join('')).toContain(fenced('mermaid', FLOWCHART));
  });

  it('exports the light Mermaid copy when the page is dark', async () => {
    document.documentElement.setAttribute('data-gv-scheme', 'dark');
    const reply = geminiReply(geminiCodeBlock(FLOWCHART, 'Mermaid'));
    activate(mermaidPrimitive, gemini, geminiMermaidParams);
    await vi.waitFor(() => expect(drawn(reply)).toBe('Diagram'));
    expect(mermaidLibrary.render).toHaveBeenCalledTimes(2);

    const html = document.createElement('div');
    html.innerHTML = exportGemini(reply).html;

    expect(
      html.querySelector('.gv-export-mermaid[data-gv-mermaid-theme="light"]')?.textContent,
    ).toBe('Light');
  });

  it('maps live plugin diagrams to their clones when serializing a list', async () => {
    const reply = geminiReply(
      '<ol>' +
        `<li><p>First</p>${geminiCodeBlock(FLOWCHART, 'Mermaid')}</li>` +
        `<li><p>Plain</p>${geminiCodeBlock('print(1)', 'Python')}</li>` +
        `<li><p>Second</p>${geminiCodeBlock(OTHER_FLOWCHART, 'Mermaid')}</li>` +
        '</ol>',
    );
    activate(mermaidPrimitive, gemini, geminiMermaidParams);
    await vi.waitFor(() => expect(reply.querySelectorAll('.gv-diagram-panel')).toHaveLength(2));
    await vi.waitFor(() =>
      expect(
        Array.from(reply.querySelectorAll('.gv-diagram-panel')).map(
          (panel) => panel.shadowRoot?.querySelector('.diagram')?.textContent,
        ),
      ).toEqual(['Diagram', 'Other']),
    );

    const exported = exportGemini(reply);

    const html = document.createElement('div');
    html.innerHTML = exported.html;
    expect(
      Array.from(html.querySelectorAll('ol .gv-export-mermaid > svg')).map(
        (svg) => svg.textContent,
      ),
    ).toEqual(['Diagram', 'Other']);
    expect(html.querySelector('ol .gv-diagram-panel')).toBeNull();
    expect(html.querySelector('ol pre code')?.textContent).toBe('print(1)');
    expect(exported.text).toContain('First');
    expect(exported.text).toContain('```mermaid');
    expect(exported.text).toContain('Left --> Right');
  });

  it('falls back to source for a diagram still rendering, shown as code, failed or turned off', async () => {
    const isSource = (reply: HTMLElement, source: string) => {
      const exported = exportGemini(reply);
      const html = document.createElement('div');
      html.innerHTML = exported.html;
      return (
        html.querySelector('.gv-export-mermaid') === null &&
        html.querySelector('pre code')?.textContent === source &&
        exported.text.includes(source)
      );
    };

    // Still rendering: the library has not answered yet.
    let finish!: (value: { svg: string }) => void;
    mermaidLibrary.render.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const reply = geminiReply(geminiCodeBlock(FLOWCHART, 'Mermaid'));
    const scope = activate(mermaidPrimitive, gemini, geminiMermaidParams);
    await vi.waitFor(() => expect(mermaidLibrary.render).toHaveBeenCalled());
    expect(isSource(reply, FLOWCHART)).toBe(true);
    finish({ svg: '<svg><text>Diagram</text></svg>' });
    await vi.waitFor(() => expect(isSource(reply, FLOWCHART)).toBe(false));

    // Streaming: the source moved on and the redraw has not landed.
    const code = reply.querySelector('code')!;
    code.textContent = `${FLOWCHART}\n  Finish --> Done`;
    expect(isSource(reply, code.textContent)).toBe(true);
    await vi.waitFor(() => expect(isSource(reply, code.textContent!)).toBe(false), {
      timeout: 3000,
    });

    // Shown as code.
    const [, , codeButton] = toolbarButtons(reply);
    codeButton.click();
    expect(isSource(reply, code.textContent)).toBe(true);
    toolbarButtons(reply)[1].click();
    expect(isSource(reply, code.textContent)).toBe(false);

    // Turned off.
    await scope.dispose();
    expect(isSource(reply, code.textContent)).toBe(true);

    // Failed: a syntax error card is no diagram to export.
    mermaidLibrary.render.mockRejectedValue(new Error('Parse error on line 2'));
    const broken = geminiReply(geminiCodeBlock('flowchart TD\n  A -->', 'Mermaid'));
    activate(mermaidPrimitive, gemini, geminiMermaidParams);
    await vi.waitFor(() => expect(drawn(broken)).toContain('Parse error'));
    expect(isSource(broken, 'flowchart TD\n  A -->')).toBe(true);
  }, 10_000);

  it('exports an ECharts chart as a PNG and falls back to source while it is fullscreen', async () => {
    const reply = geminiReply(geminiCodeBlock(BAR_OPTION, 'ECharts'));
    activate(echartsPrimitive, gemini, geminiEChartsParams);
    const chartOf = () =>
      panelOf(reply)?.shadowRoot?.querySelector<HTMLElement>('.gv-echarts-diagram') ?? null;
    await vi.waitFor(() => expect(chartOf()).not.toBeNull());
    // The mocked library draws nothing; ECharts paints into a canvas of its own.
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 150;
    chartOf()!.append(canvas);

    const html = document.createElement('div');
    html.innerHTML = exportGemini(reply).html;
    expect(html.querySelector('.gv-export-echarts > img')?.getAttribute('src')).toBe(
      'data:image/png;base64,Q0hBUlQ=',
    );

    const fullscreenButton = toolbarButtons(reply).at(-1)!;
    fullscreenButton.click();
    expect(document.querySelector('.gv-echarts-modal-card')?.contains(chartOf() ?? canvas)).toBe(
      true,
    );
    const whileFullscreen = exportGemini(reply);
    expect(whileFullscreen.html).not.toContain('gv-export-echarts');
    expect(whileFullscreen.text).toContain('"series"');
  });
  it('exports a WaveDrom timing diagram as its drawn SVG', async () => {
    const source = '{ signal: [\n  { name: "clk", wave: "p...." }\n] }';
    const reply = geminiReply(geminiCodeBlock(source, 'WaveDrom'));
    activate(wavedromPrimitive, gemini, geminiWaveDromParams);
    await vi.waitFor(
      () => expect(panelOf(reply)?.shadowRoot?.querySelector('.diagram svg')).toBeTruthy(),
      { timeout: 5000 },
    );

    const exported = exportGemini(reply);

    const html = document.createElement('div');
    html.innerHTML = exported.html;
    expect(html.querySelector('.gv-export-wavedrom > svg')).not.toBeNull();
    expect(exported.text).toContain(fenced('wavedrom', source));
  });
});

describe('diagram toolbar copy', () => {
  it('copies the diagram source from the toolbar while the diagram view is shown', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const reply = geminiReply(geminiCodeBlock(FLOWCHART, 'Mermaid'));
    activate(mermaidPrimitive, gemini, geminiMermaidParams);
    await vi.waitFor(() => expect(drawn(reply)).toBe('Diagram'));
    expect(reply.querySelector('code-block')!.hasAttribute('data-gv-diagram-hidden')).toBe(true);

    const [copyButton] = toolbarButtons(reply);
    expect(copyButton.getAttribute('aria-label')).toBe('Copy');
    copyButton.click();

    expect(writeText).toHaveBeenCalledWith(FLOWCHART);
    await vi.waitFor(() => expect(copyButton.getAttribute('aria-label')).toBe('Copied'));
  });

  it('leaves ChatGPT diagram plugins without copy or export image unless the params ask for them', async () => {
    document.documentElement.setAttribute('data-gv-scheme', 'dark');
    const shipped: CodeBlockDiagramParams = { codeBlock: 'pre' };
    const plain = chatgptReply(FLOWCHART);
    activate(mermaidPrimitive, chatgpt, shipped);
    await vi.waitFor(() => expect(drawn(plain)).toBe('Diagram'));

    expect(toolbarButtons(plain)).toHaveLength(2);
    expect(readDiagramExport(plain.querySelector('pre')!)).toBeNull();
    // No light copy is drawn for an export that will not use it.
    expect(mermaidLibrary.render).toHaveBeenCalledTimes(1);
    const exported = createContentExtractor(buildChatGptAdapter(chatgpt)).extractAssistantContent(
      plain,
    );
    expect(exported.text).toContain(fenced('mermaid', FLOWCHART));
    expect(exported.html).not.toContain('gv-export-mermaid');

    // The shipped ChatGPT plugin's ECharts op, on ChatGPT's current block, drawn with pixels.
    const chart = document.createElement('div');
    chart.setAttribute('data-chatgpt-selection-message-id', 'chart');
    chart.innerHTML =
      '<div class="markdown"><div data-markdown-copy="code-block">' +
      '<div data-markdown-copy="exclude"><span class="truncate">echarts</span></div>' +
      '<div><code></code></div></div></div>';
    chart.querySelector('code')!.textContent = BAR_OPTION;
    document.querySelector('main')!.append(chart);
    activate(echartsPrimitive, chatgpt, paramsOf(chatgptManifest, 'echarts'));
    const chartContainer = () =>
      panelOf(chart)?.shadowRoot?.querySelector<HTMLElement>('.gv-echarts-diagram') ?? null;
    await vi.waitFor(() => expect(chartContainer()).not.toBeNull());
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 150;
    chartContainer()!.append(canvas);
    expect(toolbarButtons(chart)).toHaveLength(3);
    expect(readDiagramExport(chart.querySelector('[data-markdown-copy="code-block"]')!)).toBeNull();

    await Promise.all(scopes.splice(0).map((scope) => scope.dispose()));
    const asked = chatgptReply(OTHER_FLOWCHART);
    activate(mermaidPrimitive, chatgpt, { ...shipped, copyButton: true, exportImage: true });
    await vi.waitFor(() => expect(drawn(asked)).toBe('Other'));

    expect(toolbarButtons(asked)).toHaveLength(3);
    const askedExport = exportChatGpt(asked);
    expect(askedExport.html).toContain('gv-export-mermaid');
    expect(askedExport.html).toContain('Light');
    expect(askedExport.text).toContain(fenced('mermaid', OTHER_FLOWCHART));
  });
});

describe('shared fullscreen styles', () => {
  it('keeps the shared fullscreen style while another diagram plugin still uses it', async () => {
    document.querySelector('main')!.innerHTML =
      `<div class="reply-a"><pre><code class="language-mermaid">${FLOWCHART}</code></pre></div>` +
      `<div class="reply-b"><pre><code class="language-mermaid">${OTHER_FLOWCHART}</code></pre></div>`;
    const first = activate(mermaidPrimitive, chatgpt, { turn: '.reply-a', codeBlock: 'pre' });
    const second = activate(mermaidPrimitive, chatgpt, { turn: '.reply-b', codeBlock: 'pre' });
    await vi.waitFor(() => expect(document.querySelectorAll('.gv-diagram-panel')).toHaveLength(2));
    expect(document.querySelectorAll('#gv-mermaid-styles')).toHaveLength(1);

    await first.dispose();
    expect(document.getElementById('gv-mermaid-styles')).not.toBeNull();

    await second.dispose();
    expect(document.getElementById('gv-mermaid-styles')).toBeNull();
  });
});
