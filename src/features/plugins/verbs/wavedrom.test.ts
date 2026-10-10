import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requireBundledSiteAdapter } from '../catalog/sites';
import manifest from '../catalog/sites/chatgpt/plugins/diagram-rendering/plugin.json';
import { PluginScope } from '../runtime/pluginScope';
import type { PrimitiveContext } from './types';
import { wavedromPrimitive } from './wavedrom';

const WAVEJSON =
  '{ signal: [\n  { name: "clk", wave: "p...." },\n  { name: "data", wave: "x.34.x" }\n] }';

/** ChatGPT's code block as measured live: no `pre` and no `language-*` class. */
const CODE_BLOCK = '[data-markdown-copy="code-block"]';
/** The params the shipped ChatGPT plugin passes: its header label names the language. */
const chatgptParams =
  manifest.contributes.domOps.find((op) => op.handler === 'wavedrom')?.params ?? {};

function chatgptReply(source: string, label = 'wavedrom'): HTMLElement {
  const reply = document.createElement('div');
  reply.setAttribute(
    'data-chatgpt-selection-message-id',
    `m${document.querySelectorAll('*').length}`,
  );
  reply.innerHTML =
    '<div class="markdown"><p>Here it is:</p>' +
    '<div data-markdown-copy="code-block" class="relative">' +
    `<div data-markdown-copy="exclude" class="flex items-center"><div class="truncate">${label}</div>` +
    '<button aria-label="复制">复制代码</button></div>' +
    '<div class="overflow-y-auto p-4" dir="ltr"><code class="whitespace-pre!"></code></div>' +
    '</div></div>';
  reply.querySelector('code')!.textContent = source;
  document.querySelector('main')!.append(reply);
  return reply;
}

const chatgpt = requireBundledSiteAdapter('chatgpt');
let scope: PluginScope;

function activate(): void {
  const context: PrimitiveContext = {
    doc: document,
    adapter: chatgpt,
    pluginId: 'test.diagram-rendering',
    settings: {},
    setTargetCounter: () => {},
  };
  void wavedromPrimitive.activate(scope, chatgptParams, context);
}

const blockOf = (reply: Element) => reply.querySelector<HTMLElement>(CODE_BLOCK)!;
const panelOf = (reply: Element) => reply.querySelector<HTMLElement>('.gv-diagram-panel');
const diagramOf = (reply: Element) =>
  panelOf(reply)?.shadowRoot?.querySelector<HTMLElement>('.diagram') ?? null;
const timingDiagram = (reply: Element) => diagramOf(reply)?.querySelector('svg') ?? null;

beforeEach(() => {
  document.head.replaceChildren();
  document.body.innerHTML = '<main></main>';
  scope = new PluginScope();
});

afterEach(async () => {
  await scope.dispose();
  document.body.replaceChildren();
});

describe('wavedrom primitive', () => {
  it('a ChatGPT wavedrom code block renders as a timing diagram', async () => {
    const reply = chatgptReply(WAVEJSON);
    activate();

    await vi.waitFor(() => expect(timingDiagram(reply)).not.toBeNull());
    const block = blockOf(reply);
    expect(panelOf(reply)!.dataset.gvDiagram).toBe('wavedrom');
    expect(panelOf(reply)!.nextElementSibling).toBe(block);
    expect(block.hasAttribute('data-gv-diagram-hidden')).toBe(true);
    // Both lanes are drawn, on the light backdrop Gemini uses.
    expect(timingDiagram(reply)!.textContent).toContain('clk');
    expect(timingDiagram(reply)!.textContent).toContain('data');
    expect(diagramOf(reply)!.style.backgroundColor).toBe('rgb(249, 250, 251)');
  });

  it('an untagged ChatGPT block of WaveJSON renders from its content', async () => {
    const reply = chatgptReply(WAVEJSON, '纯文本');
    activate();

    await vi.waitFor(() => expect(timingDiagram(reply)).not.toBeNull());
  });

  it.each(['纯文本', 'Texte brut', 'プレーンテキスト', 'Testo normale', 'Plain text'])(
    'an untagged block in any UI language is detected by its content (%s)',
    async (label) => {
      const reply = chatgptReply(WAVEJSON, label);
      activate();

      await vi.waitFor(() => expect(timingDiagram(reply)).not.toBeNull());
    },
  );

  it('turning the plugin off restores the wavedrom code block', async () => {
    const reply = chatgptReply(WAVEJSON);
    const markdown = reply.querySelector('.markdown')!;
    const before = markdown.innerHTML;
    const block = blockOf(reply);
    const copy = reply.querySelector('button')!;
    activate();
    await vi.waitFor(() => expect(timingDiagram(reply)).not.toBeNull());
    timingDiagram(reply)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.gv-wavedrom-modal')).not.toBeNull();

    await scope.dispose();

    expect(panelOf(reply)).toBeNull();
    expect(markdown.innerHTML).toBe(before);
    expect(blockOf(reply)).toBe(block);
    expect(reply.querySelector('button')).toBe(copy);
    expect(document.getElementById('gv-wavedrom-styles')).toBeNull();
    expect(document.querySelector('style[data-gv-plugin-scope]')).toBeNull();
    await vi.waitFor(() => expect(document.querySelector('.gv-wavedrom-modal')).toBeNull());
  });

  it('WaveJSON under a specific label, and ordinary JSON, stay code', async () => {
    const json = chatgptReply(WAVEJSON, 'json');
    const plain = chatgptReply('{ "name": "voyager", "version": "1.0.0" }', '纯文本');
    const wavedrom = chatgptReply(WAVEJSON);
    activate();

    await vi.waitFor(() => expect(timingDiagram(wavedrom)).not.toBeNull());
    for (const reply of [json, plain]) {
      expect(panelOf(reply)).toBeNull();
      expect(blockOf(reply).hasAttribute('data-gv-diagram-hidden')).toBe(false);
    }
  });

  it('invalid WaveJSON stays code and draws once the source is fixed', async () => {
    const reply = chatgptReply('{ signal: [{ name: "clk", wave: ');
    const block = blockOf(reply);
    const valid = chatgptReply(WAVEJSON);
    activate();
    // Both blocks draw from the same scan; the valid one finishing means the invalid one has too.
    await vi.waitFor(() => expect(timingDiagram(valid)).not.toBeNull());

    expect(panelOf(reply)).toBeNull();
    expect(block.hasAttribute('data-gv-diagram-hidden')).toBe(false);

    reply.querySelector('code')!.textContent = WAVEJSON;
    await vi.waitFor(() => expect(timingDiagram(reply)).not.toBeNull(), { timeout: 3000 });
    expect(block.hasAttribute('data-gv-diagram-hidden')).toBe(true);
  });
});
