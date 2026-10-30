/**
 * The three Gemini diagram plugins (`catalog/sites/gemini/plugins/{wavedrom,
 * echarts,mermaid}`) on Gemini's code block shape, with the params their
 * manifests pass: what the native renderers did on a live reply — streaming,
 * theme changes, turning off, handing a block over — the primitives must do.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LONG_CODE_BLOCK_MIN_LINES } from '@/pages/content/codeBlockCollapse/engine';
import { CODE_BLOCK_TOGGLE_CLASS } from '@/pages/content/codeBlockCollapse/toggle';

import { requireBundledSiteAdapter } from '../catalog/sites';
import codeCollapseManifest from '../catalog/sites/gemini/plugins/code-collapse/plugin.json';
import echartsManifest from '../catalog/sites/gemini/plugins/echarts/plugin.json';
import mermaidManifest from '../catalog/sites/gemini/plugins/mermaid/plugin.json';
import waveDromManifest from '../catalog/sites/gemini/plugins/wavedrom/plugin.json';
import { PluginScope } from '../runtime/pluginScope';
import type { SiteAdapter } from '../types';
import type { CodeBlockDiagramParams } from './codeBlockDiagram';
import { type CodeCollapseParams, codeCollapsePrimitive } from './codeCollapse/index';
import { echartsPrimitive } from './echarts/index';
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

const echartsLibrary = vi.hoisted(() => {
  const instances: Array<Record<'setOption' | 'resize' | 'dispose', ReturnType<typeof vi.fn>>> = [];
  return {
    instances,
    init: vi.fn(() => {
      const instance = {
        setOption: vi.fn(),
        resize: vi.fn(),
        dispose: vi.fn(),
        getDataURL: vi.fn(() => null),
      };
      instances.push(instance);
      return instance;
    }),
  };
});
vi.mock('@/pages/content/echarts/runtime', () => ({ init: echartsLibrary.init }));

const FLOWCHART = 'flowchart TD\n  Start --> Middle\n  Middle --> Finish';
const WAVEJSON =
  '{ signal: [\n  { name: "clk", wave: "p...." },\n  { name: "d", wave: "x.34.x" }\n] }';
const BAR_OPTION = `{
  "xAxis": { "type": "category", "data": ["A", "B"] },
  "yAxis": { "type": "value" },
  "series": [{ "type": "bar", "data": [1, 2] }]
}`;

const geminiSite = requireBundledSiteAdapter('gemini');
/** Gemini as the official plugins see it once its site.json names `code-block` (stage 3D). */
const gemini: SiteAdapter = {
  ...geminiSite,
  selectors: { ...geminiSite.selectors, codeBlock: 'code-block' },
};

type Manifest = { contributes: { domOps: ReadonlyArray<{ handler: string; params: object }> } };
const paramsOf = (manifest: Manifest, handler: string): CodeBlockDiagramParams =>
  manifest.contributes.domOps.find((op) => op.handler === handler)!
    .params as CodeBlockDiagramParams;

interface Kind {
  readonly kind: string;
  readonly label: string;
  readonly source: string;
  readonly primitive: Primitive<CodeBlockDiagramParams>;
  readonly params: CodeBlockDiagramParams;
  /** Whether the block shows its drawing, as the renderer leaves it. */
  readonly isDrawn: (target: Element) => boolean;
}

const KINDS: readonly Kind[] = [
  {
    kind: 'wavedrom',
    label: 'WaveDrom',
    source: WAVEJSON,
    primitive: wavedromPrimitive,
    params: paramsOf(waveDromManifest, 'wavedrom'),
    isDrawn: (target) => target.querySelector('svg') !== null,
  },
  {
    kind: 'echarts',
    label: 'ECharts',
    source: BAR_OPTION,
    primitive: echartsPrimitive,
    params: paramsOf(echartsManifest, 'echarts'),
    isDrawn: (target) => target.querySelector('.gv-echarts-diagram') !== null,
  },
  {
    kind: 'mermaid',
    label: 'Mermaid',
    source: FLOWCHART,
    primitive: mermaidPrimitive,
    params: paramsOf(mermaidManifest, 'mermaid'),
    isDrawn: (target) => target.querySelector('svg') !== null,
  },
];

/** Gemini's reply with one code block: label and copy button in the decoration. */
function geminiReply(source: string, label: string): HTMLElement {
  const reply = document.createElement('model-response');
  reply.innerHTML =
    '<message-content><div class="markdown"><p>Here:</p><code-block><div class="code-block">' +
    `<div class="code-block-decoration"><span>${label}</span>` +
    '<div class="buttons"><button class="copy-button" aria-label="Copy code">copy</button></div></div>' +
    '<pre><code data-test-id="code-content"></code></pre></div></code-block></div></message-content>';
  reply.querySelector('code')!.textContent = source;
  document.querySelector('main')!.append(reply);
  return reply;
}

const scopes: PluginScope[] = [];
function activate(kind: Kind): PluginScope {
  const scope = new PluginScope();
  scopes.push(scope);
  const context: PrimitiveContext = {
    doc: document,
    adapter: gemini,
    pluginId: `voyager.gemini-${kind.kind}`,
    settings: {},
    setTargetCounter: () => {},
  };
  void kind.primitive.activate(scope, kind.params, context);
  return scope;
}

const panelOf = (reply: Element) => reply.querySelector<HTMLElement>('.gv-diagram-panel');
const targetOf = (reply: Element) =>
  panelOf(reply)?.shadowRoot?.querySelector<HTMLElement>('.diagram') ?? null;

beforeEach(() => {
  mermaidLibrary.initialize.mockReset();
  mermaidLibrary.render.mockReset();
  mermaidLibrary.render.mockImplementation(async (_id: string, code: string) => ({
    svg: `<svg><text>${code.split('\n').length} lines</text></svg>`,
  }));
  echartsLibrary.init.mockClear();
  echartsLibrary.instances.length = 0;
  document.head.replaceChildren();
  document.body.innerHTML = '<main></main>';
});

afterEach(async () => {
  await Promise.all(scopes.splice(0).map((scope) => scope.dispose()));
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-gv-scheme');
  vi.unstubAllGlobals();
});

describe.each(KINDS)('Gemini $kind plugin', (kind) => {
  it(`restores the native code block and copy button when the ${kind.kind} plugin turns off`, async () => {
    const reply = geminiReply(kind.source, kind.label);
    const before = reply.innerHTML;
    const copy = reply.querySelector('.copy-button');
    const scope = activate(kind);
    await vi.waitFor(() => expect(targetOf(reply) && kind.isDrawn(targetOf(reply)!)).toBe(true), {
      timeout: 5000,
    });
    expect(reply.querySelector('code-block')!.hasAttribute('data-gv-diagram-hidden')).toBe(true);

    await scope.dispose();

    expect(reply.innerHTML).toBe(before);
    expect(reply.querySelector('.code-block-decoration .buttons .copy-button')).toBe(copy);
  });

  it(`hands a block to another ${kind.kind} plugin after its owner released it`, async () => {
    const reply = geminiReply(kind.source, kind.label);
    const first = activate(kind);
    await vi.waitFor(() => expect(targetOf(reply) && kind.isDrawn(targetOf(reply)!)).toBe(true), {
      timeout: 5000,
    });
    activate(kind);

    await first.dispose();

    await vi.waitFor(() => expect(targetOf(reply) && kind.isDrawn(targetOf(reply)!)).toBe(true), {
      timeout: 5000,
    });
    expect(reply.querySelectorAll('.gv-diagram-panel')).toHaveLength(1);
  });
});

describe('Gemini diagram plugins while a reply streams', () => {
  it('retries a streaming wavedrom block whose source is still changing and settles on the final source', async () => {
    const reply = geminiReply('{ signal: [\n  { name: "clk", wave: "p..', 'WaveDrom');
    activate(KINDS[0]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(panelOf(reply)).toBeNull();

    reply.querySelector('code')!.textContent = WAVEJSON;

    await vi.waitFor(() => expect(targetOf(reply)?.querySelector('svg')).toBeTruthy(), {
      timeout: 5000,
    });
    expect(targetOf(reply)!.textContent).toContain('clk');
  });

  it('retries a streaming echarts block whose source is still changing and settles on the final source', async () => {
    const reply = geminiReply('{\n  "xAxis": { "type": "cat', 'ECharts');
    activate(KINDS[1]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(echartsLibrary.init).not.toHaveBeenCalled();

    reply.querySelector('code')!.textContent = BAR_OPTION;

    await vi.waitFor(() => expect(echartsLibrary.init).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(echartsLibrary.instances[0].setOption).toHaveBeenCalledWith(
      expect.objectContaining({ series: [expect.objectContaining({ data: [1, 2] })] }),
      true,
    );
  });

  it('retries a streaming mermaid block whose source is still changing and settles on the final source', async () => {
    const reply = geminiReply('flowchart TD\n  Start -->', 'Mermaid');
    activate(KINDS[2]);
    await vi.waitFor(() => expect(targetOf(reply)?.textContent).toBe('2 lines'));

    reply.querySelector('code')!.textContent = FLOWCHART;

    await vi.waitFor(() => expect(targetOf(reply)?.textContent).toBe('3 lines'), {
      timeout: 3000,
    });
    expect(mermaidLibrary.render).toHaveBeenLastCalledWith(expect.any(String), FLOWCHART);
  });

  it('redraws a rendered mermaid diagram when the page scheme flips mid-render', async () => {
    document.documentElement.setAttribute('data-gv-scheme', 'light');
    let finish!: () => void;
    mermaidLibrary.render.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ svg: '<svg><text>Light</text></svg>' });
        }),
    );
    const reply = geminiReply(FLOWCHART, 'Mermaid');
    activate(KINDS[2]);
    await vi.waitFor(() => expect(mermaidLibrary.render).toHaveBeenCalledTimes(1));

    mermaidLibrary.render.mockResolvedValue({ svg: '<svg><text>Dark</text></svg>' });
    document.documentElement.setAttribute('data-gv-scheme', 'dark');
    // Past the rescan the panel's insertion scheduled, so only the finished draw can ask again.
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    finish();

    await vi.waitFor(() => expect(targetOf(reply)?.textContent).toBe('Dark'), { timeout: 3000 });
    expect(mermaidLibrary.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: 'dark' }),
    );
  }, 10_000);

  it('redraws a rendered echarts chart in the new theme when the page scheme flips', async () => {
    document.documentElement.setAttribute('data-gv-scheme', 'light');
    const reply = geminiReply(BAR_OPTION, 'ECharts');
    activate(KINDS[1]);
    await vi.waitFor(() => expect(echartsLibrary.init).toHaveBeenCalledTimes(1));
    expect(echartsLibrary.init).toHaveBeenLastCalledWith(expect.anything(), undefined, {
      renderer: 'canvas',
    });

    document.documentElement.setAttribute('data-gv-scheme', 'dark');

    await vi.waitFor(() => expect(echartsLibrary.init).toHaveBeenCalledTimes(2));
    expect(echartsLibrary.init).toHaveBeenLastCalledWith(expect.anything(), 'dark', {
      renderer: 'canvas',
    });
    expect(panelOf(reply)!.shadowRoot!.querySelectorAll('.gv-echarts-diagram')).toHaveLength(1);
  });

  it('resizes an ECharts chart drawn while hidden once it is shown', async () => {
    const observed: Array<{ callback: ResizeObserverCallback; targets: Element[] }> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private readonly entry: { callback: ResizeObserverCallback; targets: Element[] };
        constructor(callback: ResizeObserverCallback) {
          this.entry = { callback, targets: [] };
          observed.push(this.entry);
        }
        observe(target: Element) {
          this.entry.targets.push(target);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    const reply = geminiReply(BAR_OPTION, 'ECharts');
    activate(KINDS[1]);
    await vi.waitFor(() => expect(echartsLibrary.init).toHaveBeenCalledTimes(1));
    const [, , codeButton] = Array.from(panelOf(reply)!.shadowRoot!.querySelectorAll('button'));
    codeButton.click();
    // A new source while the code is shown draws the chart at zero size.
    reply.querySelector('code')!.textContent = BAR_OPTION.replace('[1, 2]', '[3, 4]');
    await vi.waitFor(() => expect(echartsLibrary.init).toHaveBeenCalledTimes(2), {
      timeout: 3000,
    });
    const chart = panelOf(reply)!.shadowRoot!.querySelector<HTMLElement>('.gv-echarts-diagram')!;
    const watcher = observed.find((entry) => entry.targets.includes(chart));
    expect(watcher).toBeDefined();

    // Back to the diagram: the chart gets a size, and the observer reports it.
    Array.from(panelOf(reply)!.shadowRoot!.querySelectorAll('button'))[1].click();
    watcher!.callback(
      [
        {
          target: chart,
          contentRect: { width: 600, height: 360 },
        } as unknown as ResizeObserverEntry,
      ],
      {} as ResizeObserver,
    );

    expect(echartsLibrary.instances[1].resize).toHaveBeenCalled();
  });
});

describe('Gemini Mermaid plugin beside the code block collapse plugin', () => {
  /** A Mermaid flowchart long enough to collapse, under a label that names no language. */
  const LONG_FLOWCHART = [
    'flowchart TD',
    ...Array.from({ length: LONG_CODE_BLOCK_MIN_LINES }, (_, i) => `  N${i} --> N${i + 1}`),
  ].join('\n');
  const mermaid = KINDS[2];

  function activateCollapse(): PluginScope {
    const scope = new PluginScope();
    scopes.push(scope);
    void codeCollapsePrimitive.activate(
      scope,
      codeCollapseManifest.contributes.domOps[0].params as CodeCollapseParams,
      {
        doc: document,
        adapter: gemini,
        pluginId: 'voyager.gemini-code-collapse',
        settings: {},
        setTargetCounter: () => {},
      },
    );
    return scope;
  }

  const toggleIn = (reply: Element) => reply.querySelector(`.${CODE_BLOCK_TOGGLE_CLASS}`);
  const drawn = (reply: Element) => targetOf(reply)?.querySelector('svg') != null;

  it('never collapses a Mermaid block drawn by the plugin', async () => {
    // Collapse first: it took the long block before Mermaid recognised it by its content.
    const first = geminiReply(LONG_FLOWCHART, 'Plain Text');
    activateCollapse();
    activate(mermaid);
    await vi.waitFor(() => expect(drawn(first)).toBe(true), { timeout: 5000 });
    await vi.waitFor(() => expect(toggleIn(first)).toBeNull(), { timeout: 2000 });

    // Mermaid first: the collapse never takes a block the diagram already holds.
    const second = geminiReply(LONG_FLOWCHART, 'Plain Text');
    await vi.waitFor(() => expect(drawn(second)).toBe(true), { timeout: 5000 });
    activateCollapse();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(toggleIn(first)).toBeNull();
    expect(toggleIn(second)).toBeNull();
  });
});
