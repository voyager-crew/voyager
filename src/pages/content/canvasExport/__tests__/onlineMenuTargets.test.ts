// @vitest-environment-options { "url": "https://gemini.google.com/app/canvas" }
import { afterEach, expect, it } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { injectCanvasCopyMarkdownButton, findCanvasProseMirrorRoot } from '../menuInjection';
import { setup } from './fixtures';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  document.body.replaceChildren();
});
const labels = { label: 'Copy Markdown', tooltip: 'Copy document as Markdown' };
function page(native = true): HTMLElement {
  const panel = setup();
  panel.classList.add('menu');
  if (native) return panel;
  const renamed = document.createElement('canvas-menu');
  for (const attribute of panel.attributes) renamed.setAttribute(attribute.name, attribute.value);
  renamed.innerHTML = panel.innerHTML;
  panel.replaceWith(renamed);
  return renamed;
}
async function online() {
  stop = await installGeminiSelectorPatch({ 'canvasEntry.menus': ['.menu'] });
}
it('the same Canvas menu retains its copy item and document through bundled and remote data', async () => {
  const panel = page();
  const native = injectCanvasCopyMarkdownButton(panel, labels)!;
  const source = findCanvasProseMirrorRoot(panel);
  native.remove();
  await online();
  expect(injectCanvasCopyMarkdownButton(panel, labels)?.textContent).toBe(native.textContent);
  expect(findCanvasProseMirrorRoot(panel)).toBe(source);
  expect(source?.textContent).toBe('DocumentHello world');
});
it('a renamed Canvas menu keeps Copy tied to the document owned by its expanded controller', async () => {
  const panel = page(false);
  await online();
  expect(injectCanvasCopyMarkdownButton(panel, labels)?.parentElement).toBe(panel);
  expect(findCanvasProseMirrorRoot(panel)?.textContent).toBe('DocumentHello world');
});
it('a menu alias cannot borrow another control’s Canvas document', async () => {
  const panel = page(false);
  const trigger = document.querySelector('[aria-controls]')!;
  trigger.setAttribute('aria-controls', 'another-menu');
  await online();
  const rejected = injectCanvasCopyMarkdownButton(panel, labels);
  trigger.setAttribute('aria-controls', panel.id);
  expect([rejected, injectCanvasCopyMarkdownButton(panel, labels)?.parentElement]).toEqual([
    null,
    panel,
  ]);
});
it('closing the controller invalidates the previously injected Copy target', async () => {
  const panel = page(false);
  await online();
  expect(injectCanvasCopyMarkdownButton(panel, labels)?.parentElement).toBe(panel);
  document.querySelector('[aria-controls]')!.setAttribute('aria-expanded', 'false');
  expect(findCanvasProseMirrorRoot(panel)).toBeNull();
});
it('a matching panel without native menu semantics cannot receive a copy action', async () => {
  const panel = page(false);
  panel.removeAttribute('role');
  await online();
  const rejected = injectCanvasCopyMarkdownButton(panel, labels);
  panel.setAttribute('role', 'menu');
  expect([rejected, injectCanvasCopyMarkdownButton(panel, labels)?.parentElement]).toEqual([
    null,
    panel,
  ]);
});

it('two expanded controllers cannot assign the same menu to different Canvas documents', async () => {
  const panel = page(false);
  const trigger = document.querySelector('[aria-controls]')!;
  const duplicate = trigger.cloneNode(true) as HTMLElement;
  trigger.after(duplicate);
  await online();
  const rejected = injectCanvasCopyMarkdownButton(panel, labels);
  duplicate.remove();
  expect([rejected, injectCanvasCopyMarkdownButton(panel, labels)?.parentElement]).toEqual([
    null,
    panel,
  ]);
});
