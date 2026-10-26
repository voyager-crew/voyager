// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/" }
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  catalogConsumerContext,
  catalogConsumerPage,
  catalogConsumerPatch,
  moveToDialog,
  PluginScope,
} from './catalogConsumerFixture';
import { activateCodeBlockDiagram, type CodeBlockDiagram } from './codeBlockDiagram';
import { readDiagramExport } from './diagramExportRegistry';

let scope: PluginScope;
let retire: (() => void) | undefined;
const writes = vi.fn().mockResolvedValue(undefined);
const diagram: CodeBlockDiagram = {
  name: 'mermaid',
  kind: 'mermaid',
  matches: (language) => language === 'mermaid',
  prepare: async () => true,
  render: async (target, source) => {
    target.textContent = source;
  },
  exportHtml: (target) => `<svg><text>${target.textContent}</text></svg>`,
};
function start(custom = diagram): void {
  activateCodeBlockDiagram(
    scope,
    { copyButton: true, exportImage: true },
    catalogConsumerContext(),
    custom,
  );
}
beforeEach(() => {
  scope = new PluginScope();
  catalogConsumerPage();
  writes.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: writes },
  });
});
afterEach(async () => {
  await scope.dispose();
  retire?.();
  retire = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('a catalog diagram cannot draw a response moved into a dialog while its library loads', async () => {
  retire = await catalogConsumerPatch();
  let release!: () => void;
  const ready = new Promise<boolean>((resolve) => {
    release = () => resolve(true);
  });
  const render = vi.fn(diagram.render);
  start({ ...diagram, prepare: () => ready, render });
  moveToDialog(document.querySelector('.answer')!);
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(render).not.toHaveBeenCalled();
  document.querySelector('main')!.append(document.querySelector('.answer')!);
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1), { timeout: 1500 });
});

it('catalog diagram copy and export refuse a once-valid block in a dialog', async () => {
  retire = await catalogConsumerPatch();
  start();
  const block = document.querySelector('.block')!;
  await vi.waitFor(() => expect(readDiagramExport(block)?.text).toContain('flowchart TD'));
  const button =
    block.previousElementSibling!.shadowRoot!.querySelector<HTMLButtonElement>('button')!;
  button.click();
  expect(writes).toHaveBeenCalledWith('flowchart TD\nA-->B');
  moveToDialog(document.querySelector('.answer')!);
  button.click();
  expect(writes).toHaveBeenCalledTimes(1);
  expect(readDiagramExport(block)).toBeNull();
  document.querySelector('main')!.append(document.querySelector('.answer')!);
  expect(readDiagramExport(block)?.text).toContain('flowchart TD');
});

it('catalog diagrams preserve source and export bytes on the same DOM through bundled and remote data', async () => {
  catalogConsumerPage(true);
  start();
  const block = document.querySelector('.block')!;
  await vi.waitFor(() => expect(readDiagramExport(block)).not.toBeNull());
  const baseline = readDiagramExport(block);
  await scope.dispose();
  scope = new PluginScope();
  retire = await catalogConsumerPatch();
  start();
  await vi.waitFor(() => expect(readDiagramExport(block)).toEqual(baseline));
  expect(block.previousElementSibling?.shadowRoot?.textContent).toContain('flowchart TD');
});

it('retired diagram ownership cannot certify a hidden block in the next activation', async () => {
  retire = await catalogConsumerPatch();
  start();
  const block = document.querySelector<HTMLElement>('.block')!;
  await vi.waitFor(() => expect(readDiagramExport(block)).not.toBeNull());
  await scope.dispose();
  scope = new PluginScope();
  block.setAttribute('data-gv-diagram-hidden', '');
  block.style.display = 'none';
  const render = vi.fn(diagram.render);
  start({ ...diagram, render });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(render).not.toHaveBeenCalled();
  block.removeAttribute('data-gv-diagram-hidden');
  block.style.removeProperty('display');
  block.append(document.createTextNode(''));
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1), { timeout: 1500 });
});
