// @vitest-environment-options { "url": "https://gemini.google.com/app/canvas" }
import { afterEach, expect, it } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { extractAllCanvasDocs } from '../../export/canvasDocExtractor';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  document.body.replaceChildren();
});
function page(native = true): void {
  const tag = native ? 'immersive-editor' : 'document-editor';
  document.body.innerHTML = `<immersive-panel><${tag} class="document"><div class="ProseMirror" contenteditable="true" aria-label="Document"><h1>Heading</h1><p>Complete document</p></div></${tag}></immersive-panel>`;
}
async function online(selector = '.document') {
  stop = await installGeminiSelectorPatch({ 'canvas.documentEditors': [selector] });
}
const expected = [{ title: 'Heading', content: '# Heading\n\nComplete document' }];
it('the same Canvas document exports identical title and Markdown through both data sources', async () => {
  page();
  const before = extractAllCanvasDocs();
  await online();
  expect(extractAllCanvasDocs()).toEqual(before);
  expect(before).toEqual(expected);
});
it('a renamed document shell exports the complete native ProseMirror source without a separate header', async () => {
  page(false);
  await online();
  expect(extractAllCanvasDocs()).toEqual(expected);
});
it('a partial document list cannot omit a second open Canvas', async () => {
  page(false);
  document
    .querySelector('immersive-panel')!
    .insertAdjacentHTML(
      'beforeend',
      '<document-editor class="second"><div class="ProseMirror" contenteditable="true"><h1>Second</h1><p>Other body</p></div></document-editor>',
    );
  await online();
  const partial = extractAllCanvasDocs();
  document.querySelector('.second')!.classList.add('document');
  expect([partial, extractAllCanvasDocs()]).toEqual([
    [],
    [...expected, { title: 'Second', content: '# Second\n\nOther body' }],
  ]);
});
it('a broad Canvas owner cannot substitute the document shell and its stored title', async () => {
  page(false);
  await online('immersive-panel');
  const broad = extractAllCanvasDocs();
  stop?.();
  await online();
  expect([broad, extractAllCanvasDocs()]).toEqual([[], expected]);
});
it('a copied ProseMirror outside a Canvas owner cannot replace the exported document', async () => {
  page(false);
  const editor = document.querySelector('.document')!;
  document.body.append(editor);
  await online();
  const foreign = extractAllCanvasDocs();
  document.querySelector('immersive-panel')!.append(editor);
  expect([foreign, extractAllCanvasDocs()]).toEqual([[], expected]);
});
it('a preview of an editable source cannot become the document being exported', async () => {
  page(false);
  const source = document.querySelector('.ProseMirror')!;
  source.setAttribute('contenteditable', 'false');
  await online();
  const preview = extractAllCanvasDocs();
  source.setAttribute('contenteditable', 'true');
  expect([preview, extractAllCanvasDocs()]).toEqual([[], expected]);
});

it('a larger wrapper cannot replace the document title with surrounding interface text', async () => {
  page(false);
  const editor = document.querySelector('.document')!;
  const wrapper = document.createElement('div');
  wrapper.className = 'wrapper';
  wrapper.innerHTML = '<h1>Unrelated toolbar title</h1>';
  editor.before(wrapper);
  wrapper.append(editor);
  await online('.wrapper');
  const broad = extractAllCanvasDocs();
  stop?.();
  await online();
  expect([broad, extractAllCanvasDocs()]).toEqual([[], expected]);
});
