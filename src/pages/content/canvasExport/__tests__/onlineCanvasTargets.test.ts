import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { extractAllCanvasDocs, isAnyCanvasOpen } from '../../export/canvasDocExtractor';
import { resolveCanvasCodeRoots } from '../canvasTargets';
import { canvasFixture } from './fixtures';

let retire: (() => void) | undefined;
const originalLocation = Object.getOwnPropertyDescriptor(window, 'location')!;

function codeCanvas(tag = 'code-immersive-panel', id = 'code'): HTMLElement {
  const owner = document.createElement('immersive-panel');
  owner.innerHTML = `<${tag} id="${id}" class="code-root" _nghost-ng-c9="" jslog="42" aria-label="Code" dir="ltr" style="display:flex">
    <toolbar _ngcontent-ng-c9=""><h2 class="title-text">${id} title</h2></toolbar>
    <xap-code-editor _ngcontent-ng-c9=""><div class="xap-monaco-container" data-mode-id="typescript"><div class="view-lines"><div class="view-line">const ${id} = 1;</div><div class="view-line">  // preserved</div></div></div></xap-code-editor>
    </${tag}>`;
  document.body.append(owner);
  return owner.querySelector<HTMLElement>(tag)!;
}

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { hostname: 'gemini.google.com' },
  });
});

afterEach(() => {
  retire?.();
  retire = undefined;
  document.body.replaceChildren();
  Object.defineProperty(window, 'location', originalLocation);
  vi.restoreAllMocks();
});

it('bundled and remote code profiles preserve inline and panel documents and the first code panel byte for byte', async () => {
  document.body.innerHTML =
    canvasFixture() +
    `<immersive-panel _nghost-ng-c1="">
    <toolbar _ngcontent-ng-c1=""><div class="toolbar-title"><h2 class="title-text" jslog="1">My Doc</h2></div></toolbar>
    <immersive-editor _ngcontent-ng-c1="" _nghost-ng-c2="" dir="ltr" style="display:block">
      <div _ngcontent-ng-c2="" class="ProseMirror" contenteditable="true" aria-label="Document"><h1>Heading</h1><p>Body</p></div>
    </immersive-editor></immersive-panel>`;
  const code = codeCanvas();
  codeCanvas('code-immersive-panel', 'secondCode');
  const expected = extractAllCanvasDocs();
  retire = await installGeminiSelectorPatch({ 'canvas.codePanels': ['.code-root'] });
  expect(extractAllCanvasDocs()).toEqual(expected);
  expect(expected).toEqual([
    { title: 'Document', content: '# Document\n\nHello **world**' },
    { title: 'Heading', content: '# Heading\n\nBody' },
    { title: 'code title', content: '// TYPESCRIPT\nconst code = 1;\n  // preserved' },
  ]);
  expect(resolveCanvasCodeRoots(document).value[0]).toBe(code);
});

it('a partial code list keeps the first exported code panel', async () => {
  codeCanvas();
  codeCanvas('code-immersive-panel', 'secondCode');
  const expected = extractAllCanvasDocs();
  retire = await installGeminiSelectorPatch({ 'canvas.codePanels': ['#secondCode'] });
  expect(extractAllCanvasDocs()).toEqual(expected);
});

it('equally sized wrong roots cannot substitute another code source', async () => {
  const code = codeCanvas();
  const expected = extractAllCanvasDocs();
  const foreign = document.createElement('section');
  foreign.innerHTML = `<div id="wrong-code">${code.innerHTML.replaceAll('code', 'foreign')}</div>`;
  document.body.append(foreign);
  retire = await installGeminiSelectorPatch({ 'canvas.codePanels': ['#wrong-code'] });
  expect(extractAllCanvasDocs()).toEqual(expected);
});

it('renamed Angular code panels export their native title language and source', async () => {
  const code = codeCanvas('canvas-code-v2');
  expect(extractAllCanvasDocs()).toEqual([]);
  retire = await installGeminiSelectorPatch({ 'canvas.codePanels': ['canvas-code-v2'] });
  expect(isAnyCanvasOpen()).toBe(true);
  expect(resolveCanvasCodeRoots(document).value).toEqual([code]);
  expect(extractAllCanvasDocs()).toEqual([
    { title: 'code title', content: '// TYPESCRIPT\nconst code = 1;\n  // preserved' },
  ]);
});

it('a parent joining two renamed code panels cannot collapse them into one export source', async () => {
  const first = codeCanvas('canvas-code-v2');
  const second = codeCanvas('canvas-code-v2', 'secondCode');
  const group = document.createElement('canvas-group');
  first.before(group);
  group.append(first, second);
  retire = await installGeminiSelectorPatch({ 'canvas.codePanels': ['canvas-group'] });
  expect(extractAllCanvasDocs()).toEqual([]);
  retire();
  retire = await installGeminiSelectorPatch({ 'canvas.codePanels': ['canvas-code-v2'] });
  expect(resolveCanvasCodeRoots(document).value).toEqual([first, second]);
  expect(extractAllCanvasDocs()[0]?.title).toBe('code title');
});

it('a repaired code panel inside a control does not become an export owner', async () => {
  const code = codeCanvas('canvas-code-v2');
  const button = document.createElement('button');
  code.before(button);
  button.append(code);
  retire = await installGeminiSelectorPatch({ 'canvas.codePanels': ['canvas-code-v2'] });
  expect(extractAllCanvasDocs()).toEqual([]);
  button.before(code);
  expect(extractAllCanvasDocs()[0]?.title).toBe('code title');
});

it('a renamed code panel outside a Canvas owner is ignored while a real Canvas still repairs', async () => {
  const code = codeCanvas('canvas-code-v2');
  document.body.append(code);
  retire = await installGeminiSelectorPatch({ 'canvas.codePanels': ['canvas-code-v2'] });
  expect(extractAllCanvasDocs()).toEqual([]);
  document.querySelector('immersive-panel')!.append(code);
  expect(extractAllCanvasDocs()[0]?.content).toContain('const code = 1;');
});

it('a page section cannot impersonate the native code shell even with copied editor markup', async () => {
  const section = codeCanvas('section');
  retire = await installGeminiSelectorPatch({ 'canvas.codePanels': ['.code-root'] });
  expect(extractAllCanvasDocs()).toEqual([]);
  const editor = document.createElement('canvas-code-v2');
  editor.className = 'code-root';
  editor.innerHTML = section.innerHTML;
  section.replaceWith(editor);
  expect(extractAllCanvasDocs()[0]?.title).toBe('code title');
});

it('Voyager-owned copied markup cannot become the native code source', async () => {
  const editor = codeCanvas('canvas-code-v2');
  editor.classList.add('gv-preview');
  retire = await installGeminiSelectorPatch({ 'canvas.codePanels': ['canvas-code-v2'] });
  expect(extractAllCanvasDocs()).toEqual([]);
  editor.classList.remove('gv-preview');
  expect(extractAllCanvasDocs()[0]?.content).toContain('const code = 1;');
});

it('a non-Gemini page keeps bundled Canvas reads despite an installed profile', async () => {
  document.body.innerHTML = canvasFixture();
  codeCanvas('canvas-code-v2');
  const expected = extractAllCanvasDocs();
  retire = await installGeminiSelectorPatch({ 'canvas.codePanels': ['canvas-code-v2'] });
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { hostname: 'aistudio.google.com' },
  });
  expect(extractAllCanvasDocs()).toEqual(expected);
});

it.each(['lines', 'language'] as const)(
  'a sibling preview cannot lend its %s to a repaired code editor',
  async (field) => {
    const editor = codeCanvas('canvas-code-v2');
    const foreign = document.createElement('canvas-preview');
    foreign.innerHTML =
      field === 'lines'
        ? '<div class="view-lines"><div class="view-line">foreign bytes</div></div>'
        : '<div class="xap-monaco-container" data-mode-id="foreign"></div>';
    editor.prepend(foreign);
    retire = await installGeminiSelectorPatch({ 'canvas.codePanels': ['canvas-code-v2'] });
    expect(extractAllCanvasDocs()).toEqual([]);
    foreign.remove();
    expect(extractAllCanvasDocs()).toEqual([
      { title: 'code title', content: '// TYPESCRIPT\nconst code = 1;\n  // preserved' },
    ]);
  },
);

it('bundled code panels retain their existing document-wide source read without an xap wrapper', async () => {
  document.body.innerHTML = `
    <code-immersive-panel class="native-code"><h2 class="title-text">First title</h2></code-immersive-panel>
    <code-immersive-panel class="native-code"><div class="xap-monaco-container" data-mode-id="python"><div class="view-lines"><div class="view-line">print('existing source')</div></div></div></code-immersive-panel>`;
  const bundled = extractAllCanvasDocs();
  expect(bundled).toEqual([
    { title: 'First title', content: "// PYTHON\nprint('existing source')" },
  ]);
  retire = await installGeminiSelectorPatch({ 'canvas.codePanels': ['.native-code'] });
  expect(extractAllCanvasDocs()).toEqual(bundled);
});

it('a code content heading cannot replace the native title of a repaired code panel', async () => {
  const editor = codeCanvas('canvas-code-v2');
  const toolbar = editor.querySelector('toolbar')!;
  editor.append(toolbar);
  const candidate = document.createElement('h2');
  candidate.className = 'title-text';
  candidate.textContent = 'Code content title';
  editor.querySelector('xap-code-editor')!.prepend(candidate);
  retire = await installGeminiSelectorPatch({ 'canvas.codePanels': ['canvas-code-v2'] });
  expect(extractAllCanvasDocs()).toEqual([]);
  candidate.remove();
  expect(extractAllCanvasDocs()[0]?.title).toBe('code title');
});

it.each(['detect', 'export'] as const)(
  'with online fixes off, Canvas %s stops at the first code panel instead of collecting every panel',
  (operation) => {
    codeCanvas();
    codeCanvas('code-immersive-panel', 'later');
    const queryAll = document.querySelectorAll.bind(document);
    vi.spyOn(document, 'querySelectorAll').mockImplementation((selector) => {
      if (selector === 'code-immersive-panel') {
        throw new Error('Collecting every code panel exceeds the first-match lookup budget');
      }
      return queryAll(selector);
    });
    if (operation === 'detect') {
      expect(isAnyCanvasOpen()).toBe(true);
    } else {
      expect(extractAllCanvasDocs()).toEqual([
        { title: 'code title', content: '// TYPESCRIPT\nconst code = 1;\n  // preserved' },
      ]);
    }
  },
);
