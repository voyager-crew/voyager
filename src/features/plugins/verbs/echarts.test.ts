import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createContentExtractor } from '@/features/export/services/DOMContentExtractor';
import { turnSummary } from '@/features/timeline/adapters/catalog/turnHash';
import { PANEL_BG } from '@/pages/content/echarts/renderer';
import { buildChatGptAdapter } from '@/pages/content/export/adapter/platform/chatgpt';
import { setCachedLanguage } from '@/utils/i18n';

import { requireBundledSiteAdapter } from '../catalog/sites';
import manifest from '../catalog/sites/chatgpt/plugins/diagram-rendering/plugin.json';
import { PluginScope } from '../runtime/pluginScope';
import { echartsPrimitive } from './echarts';
import type { PrimitiveContext } from './types';

const library = vi.hoisted(() => {
  const instances: Array<Record<'setOption' | 'resize' | 'dispose', ReturnType<typeof vi.fn>>> = [];
  return {
    instances,
    init: vi.fn(() => {
      const instance = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
      instances.push(instance);
      return instance;
    }),
  };
});
vi.mock('@/pages/content/echarts/runtime', () => ({ init: library.init }));

const PIE_OPTION = '{\n  series: [{ type: "pie", data: [{ value: 1, name: "a" }] }],\n}';
const BAR_OPTION = `{
  "xAxis": { "type": "category", "data": ["A", "B"] },
  "yAxis": { "type": "value" },
  "series": [{ "type": "bar", "data": [1, 2] }]
}`;

const chatgpt = requireBundledSiteAdapter('chatgpt');
/** The params the shipped ChatGPT plugin passes to this primitive. */
const chatgptParams =
  manifest.contributes.domOps.find((op) => op.handler === 'echarts')?.params ?? {};

/**
 * ChatGPT's reply code block as of October 2026: no `pre` and no `language-*`
 * class; the header's localized label names the language, 纯文本 when untagged.
 */
function chatgptReply(source: string, label = 'echarts'): HTMLElement {
  const reply = document.createElement('div');
  reply.setAttribute(
    'data-chatgpt-selection-message-id',
    `m${document.querySelectorAll('*').length}`,
  );
  reply.innerHTML =
    '<div class="markdown"><p>Here it is:</p>' +
    '<div class="contain-inline-size" data-markdown-copy="code-block">' +
    '<div class="flex items-center" data-markdown-copy="exclude">' +
    `<div class="flex gap-1"><span class="truncate">${label}</span></div>` +
    '<button aria-label="Copy">Copy</button></div>' +
    '<div class="overflow-y-auto p-4" dir="ltr"><code class="whitespace-pre!"></code></div>' +
    '</div></div>';
  reply.querySelector('code')!.textContent = source;
  document.querySelector('main')!.append(reply);
  return reply;
}

const blockOf = (reply: Element) =>
  reply.querySelector<HTMLElement>('[data-markdown-copy="code-block"]')!;

let scope: PluginScope;

function activate() {
  let counter: () => number = () => -1;
  const context: PrimitiveContext = {
    doc: document,
    adapter: chatgpt,
    pluginId: 'test.diagram-rendering',
    settings: {},
    setTargetCounter: (count) => (counter = count),
  };
  void echartsPrimitive.activate(scope, chatgptParams, context);
  return { count: () => counter() };
}

const panelOf = (reply: Element) => reply.querySelector<HTMLElement>('.gv-diagram-panel');
const chartOf = (reply: Element) =>
  panelOf(reply)?.shadowRoot?.querySelector<HTMLElement>('.gv-echarts-diagram') ?? null;
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeEach(() => {
  library.init.mockClear();
  library.instances.length = 0;
  document.head.replaceChildren();
  document.body.innerHTML = '<main></main>';
  scope = new PluginScope();
});

afterEach(async () => {
  await scope.dispose();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-gv-scheme');
});

describe('echarts primitive', () => {
  it('a ChatGPT echarts code block renders as a chart', async () => {
    // The header label is matched case-insensitively.
    const reply = chatgptReply(PIE_OPTION, 'ECharts');
    const { count } = activate();

    await vi.waitFor(() => expect(library.init).toHaveBeenCalledTimes(1));
    const chart = chartOf(reply)!;
    expect(library.init).toHaveBeenCalledWith(chart, undefined, { renderer: 'canvas' });
    // Gemini's sanitizer runs: the panel backdrop and aria are forced on.
    expect(library.instances[0].setOption).toHaveBeenCalledWith(
      expect.objectContaining({ aria: { enabled: true }, backgroundColor: PANEL_BG.light }),
      true,
    );
    const block = blockOf(reply);
    expect(panelOf(reply)!.nextElementSibling).toBe(block);
    expect(block.hasAttribute('data-gv-diagram-hidden')).toBe(true);
    expect(count()).toBe(1);
  });

  it('turning the plugin off restores the echarts code block', async () => {
    const reply = chatgptReply(PIE_OPTION);
    const markdown = reply.querySelector('.markdown')!;
    const before = markdown.innerHTML;
    const block = blockOf(reply);
    activate();
    await vi.waitFor(() => expect(chartOf(reply)).not.toBeNull());

    await scope.dispose();

    expect(library.instances[0].dispose).toHaveBeenCalledTimes(1);
    expect(panelOf(reply)).toBeNull();
    expect(markdown.innerHTML).toBe(before);
    expect(blockOf(reply)).toBe(block);
    expect(document.getElementById('gv-echarts-styles')).toBeNull();
    expect(document.querySelector('style[data-gv-plugin-scope]')).toBeNull();
  });

  it('decides which blocks are charts as Gemini does', async () => {
    // An unlabelled option renders; a json-labelled one and plain JSON stay code.
    const unlabelled = chatgptReply(BAR_OPTION, '纯文本');
    const json = chatgptReply(PIE_OPTION, 'JSON');
    const data = chatgptReply('{"foo": "bar", "list": [1, 2, 3]}', '纯文本');
    activate();

    await vi.waitFor(() => expect(chartOf(unlabelled)).not.toBeNull());
    await settle();
    for (const reply of [json, data]) {
      expect(panelOf(reply)).toBeNull();
      expect(blockOf(reply).hasAttribute('data-gv-diagram-hidden')).toBe(false);
    }
    expect(library.init).toHaveBeenCalledTimes(1);
  });

  it.each(['纯文本', 'Texte brut', 'プレーンテキスト', 'Testo normale', 'Plain text'])(
    'an untagged block in any UI language is detected by its content (%s)',
    async (label) => {
      const reply = chatgptReply(BAR_OPTION, label);
      activate();

      await vi.waitFor(() => expect(chartOf(reply)).not.toBeNull());
    },
  );

  it('an echarts block that does not parse stays code', async () => {
    const reply = chatgptReply('{ series: [{ type: "pie", data: [ }');
    activate();
    await settle();

    expect(panelOf(reply)).toBeNull();
    expect(blockOf(reply).hasAttribute('data-gv-diagram-hidden')).toBe(false);
    expect(library.init).not.toHaveBeenCalled();
  });

  it('chart clicks stay on the chart; the fullscreen button opens and returns it', async () => {
    const reply = chatgptReply(PIE_OPTION);
    activate();
    await vi.waitFor(() => expect(chartOf(reply)).not.toBeNull());
    const chart = chartOf(reply)!;
    const buttons = Array.from(panelOf(reply)!.shadowRoot!.querySelectorAll('button'));
    const fullscreenButton = buttons.at(-1)!;
    expect(fullscreenButton.getAttribute('aria-label')).toBe('Fullscreen');

    chart.click();
    expect(document.querySelector('.gv-echarts-modal')).toBeNull();

    fullscreenButton.click();
    expect(document.querySelector('.gv-echarts-modal-card')?.contains(chart)).toBe(true);

    // Unmounting mid-fullscreen closes the viewer and disposes the live chart.
    await scope.dispose();
    expect(document.querySelector('.gv-echarts-modal')).toBeNull();
    expect(library.instances[0].dispose).toHaveBeenCalled();
  });

  it('diagram toolbar buttons show an icon and a translated label', async () => {
    setCachedLanguage('zh');
    try {
      const reply = chatgptReply(PIE_OPTION);
      activate();
      await vi.waitFor(() => expect(chartOf(reply)).not.toBeNull());
      const [diagramButton, codeButton, fullscreenButton] = Array.from(
        panelOf(reply)!.shadowRoot!.querySelectorAll('button'),
      );

      expect(diagramButton.querySelector('svg.lucide-chart-column')).not.toBeNull();
      expect(diagramButton.textContent).toBe('图表');
      expect(codeButton.querySelector('svg.lucide-code-xml')).not.toBeNull();
      expect(codeButton.textContent).toBe('代码');
      // Icon-only: the label is its accessible name, not visible text.
      expect(fullscreenButton.querySelector('svg.lucide-maximize-2')).not.toBeNull();
      expect(fullscreenButton.textContent).toBe('');
      expect(fullscreenButton.getAttribute('aria-label')).toBe('全屏');
    } finally {
      setCachedLanguage('en');
    }
  });

  it('the fullscreen button is disabled in the code view', async () => {
    const reply = chatgptReply(PIE_OPTION);
    activate();
    await vi.waitFor(() => expect(chartOf(reply)).not.toBeNull());
    const [, codeButton, fullscreenButton] = Array.from(
      panelOf(reply)!.shadowRoot!.querySelectorAll('button'),
    );

    codeButton.click();

    expect(fullscreenButton.disabled).toBe(true);
    expect(blockOf(reply).hasAttribute('data-gv-diagram-hidden')).toBe(false);
  });

  it('draws with the page scheme and redraws when it changes', async () => {
    document.documentElement.setAttribute('data-gv-scheme', 'dark');
    const reply = chatgptReply(PIE_OPTION);
    activate();
    await vi.waitFor(() => expect(library.init).toHaveBeenCalledTimes(1));
    expect(library.init).toHaveBeenLastCalledWith(expect.anything(), 'dark', expect.anything());
    expect(chartOf(reply)!.style.getPropertyValue('--gv-echarts-panel-bg')).toBe(PANEL_BG.dark);

    document.documentElement.setAttribute('data-gv-scheme', 'light');

    await vi.waitFor(() => expect(library.init).toHaveBeenCalledTimes(2));
    expect(library.init).toHaveBeenLastCalledWith(expect.anything(), undefined, expect.anything());
    expect(library.instances[0].dispose).toHaveBeenCalledTimes(1);
    expect(reply.querySelectorAll('.gv-diagram-panel')).toHaveLength(1);
  });

  it('a rendered reply keeps its timeline summary and exports its code', async () => {
    const reply = chatgptReply(PIE_OPTION);
    const summary = turnSummary(reply);
    activate();
    await vi.waitFor(() => expect(chartOf(reply)).not.toBeNull());

    expect(turnSummary(reply)).toBe(summary);
    const extractor = createContentExtractor(buildChatGptAdapter(chatgpt));
    const exported = extractor.extractAssistantContent(reply);
    expect(exported.text).toContain('series: [{ type: "pie"');
    expect(exported.text).not.toContain('Diagram');
  });
});
