import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { type CollapseEngine, createCollapseEngine } from '@/core/ui/collapse/engine';

import { LONG_CODE_BLOCK_MIN_LINES, createCodeBlockCollapse } from '../engine';
import { createGeminiCodeBlockSite } from '../geminiSite';

let engine: CollapseEngine;
let mutations: MutationCallback;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'MutationObserver',
    class {
      constructor(callback: MutationCallback) {
        mutations = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  engine?.stop();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function deliver(target: Node, addedNodes: Node[] = []): void {
  mutations([{ target, addedNodes } as unknown as MutationRecord], {} as MutationObserver);
}

function codeBlock(): HTMLElement {
  const host = document.createElement('code-block');
  host.className = 'native-code';
  host.innerHTML =
    '<div class="code-block-decoration"><div class="buttons"></div></div><pre><code>short</code></pre>';
  return host;
}

it('OFF streaming discovers new Gemini blocks without rescanning the conversation', async () => {
  engine = createCodeBlockCollapse(createGeminiCodeBlockSite(document, 'code-block'));
  const queries = vi.spyOn(document.body, 'querySelectorAll');
  engine.start();
  expect(queries).toHaveBeenCalledTimes(1);

  const wrapper = document.createElement('section');
  const host = codeBlock();
  wrapper.append(host);
  document.body.append(wrapper);
  deliver(document.body, [wrapper]);
  const code = host.querySelector('code')!;
  for (let i = 0; i < LONG_CODE_BLOCK_MIN_LINES; i++) {
    const line = document.createTextNode(`\nline ${i}`);
    code.append(line);
    deliver(code, [line]);
    await vi.advanceTimersByTimeAsync(40);
  }
  await vi.advanceTimersByTimeAsync(120);

  expect(host.querySelector('.gv-code-block-toggle')).not.toBeNull();
  expect(engine.blocks()).toEqual([host]);
  expect(queries).toHaveBeenCalledTimes(1);
});

it('OFF streaming keeps a collapsed Gemini block when its selector class changes', async () => {
  const host = codeBlock();
  host.querySelector('code')!.textContent = 'line\n'.repeat(LONG_CODE_BLOCK_MIN_LINES);
  document.body.append(host);
  engine = createCodeBlockCollapse(createGeminiCodeBlockSite(document, '.native-code'));
  engine.start();
  const toggle = host.querySelector<HTMLButtonElement>('.gv-code-block-toggle')!;
  toggle.click();
  expect(host.classList.contains('gv-code-block-collapsed')).toBe(true);

  host.classList.remove('native-code');
  const response = document.createElement('p');
  document.body.append(response);
  deliver(document.body, [response]);
  await vi.advanceTimersByTimeAsync(120);

  expect(host.querySelector('.gv-code-block-toggle')).toBe(toggle);
  expect(host.classList.contains('gv-code-block-collapsed')).toBe(true);
  expect(engine.blocks()).toEqual([host]);
});

function genericEngine(selector: string): CollapseEngine {
  return createCollapseEngine(
    {
      root: () => document.body,
      hostSelector: selector,
      accepts: () => true,
      content: (host) => host,
      isLong: () => true,
      actions: (host) => host,
    },
    {
      collapsibleClass: 'gv-test-long',
      collapsedClass: 'gv-test-collapsed',
      clipClass: 'gv-test-clip',
      createToggle: (doc) => doc.createElement('button'),
      updateToggle: () => {},
    },
  );
}

it('bundled collapse scans added subtrees without scanning the whole page again', async () => {
  engine = genericEngine('article');
  const queries = vi.spyOn(document.body, 'querySelectorAll');
  engine.start();
  expect(queries).toHaveBeenCalledTimes(1);
  const wrapper = document.createElement('section');
  const block = document.createElement('article');
  wrapper.append(block);
  document.body.append(wrapper);
  const subtreeQueries = vi.spyOn(wrapper, 'querySelectorAll');
  deliver(document.body, [wrapper]);
  await vi.advanceTimersByTimeAsync(120);

  expect(engine.blocks()).toEqual([block]);
  expect(block.querySelector('button')).not.toBeNull();
  expect(subtreeQueries).toHaveBeenCalledWith('article');
  expect(queries).toHaveBeenCalledTimes(1);
});

it('bundled collapse enhances an added SVG Element just like an initial scan', async () => {
  engine = genericEngine('svg');
  engine.start();
  const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.append(host);
  deliver(document.body, [host]);
  await vi.advanceTimersByTimeAsync(120);

  expect(engine.blocks()).toEqual([host]);
  expect(host.querySelector('button')).not.toBeNull();
});
