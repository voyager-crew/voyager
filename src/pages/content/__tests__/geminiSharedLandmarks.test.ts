// @vitest-environment-options { "url": "https://gemini.google.com/app/landmarks" }
import { afterEach, expect, it } from 'vitest';

import { resolveGeminiCodeHosts } from '@/core/gemini/code/hosts';
import { findGeminiDraftInput } from '@/core/gemini/composer/draft';
import { findGeminiChatInput } from '@/core/gemini/composer/inputs';
import { findOwnedGeminiMainInputs } from '@/core/gemini/composer/ownedInput';
import { findGeminiSendButton } from '@/core/gemini/composer/send';
import { mountRealGeminiSidebar } from '@/core/gemini/sidebar/__tests__/realSidebarFixture';
import { isOriginalGeminiTranscriptElement } from '@/core/gemini/turnOwnership';

import { fillMenu } from '../canvasExport/__tests__/fixtures';
import { findCanvasProseMirrorRoot } from '../canvasExport/menuInjection';
import { isSafePickerPanel, isSafePickerTrigger } from '../defaultModel/modelPickerSafety';
import { findModelFocusInput } from '../defaultModel/modelPickerSelectors';
import { extractAllCanvasDocs } from '../export/canvasDocExtractor';
import { readGemsList } from '../gemsSidebar/selectorQueries';
import { getSidebarWidthActionButtons } from '../sidebarWidth/buttonTargets';
import { resolveGeminiUsageRoot } from '../usageStatus/usageDom';
import { findGeneratedPreviewForButton } from '../watermarkRemover/generatedImageTargets';
import { installGeminiSelectorPatch } from './geminiOnlineSelectorFixture';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.replaceChildren();
  history.replaceState(null, '', '/app/landmarks');
});

function sharedApp(tag = 'dialog') {
  const page = mountRealGeminiSidebar();
  const shell = document.createElement(tag);
  shell.setAttribute('open', '');
  if (tag === 'div') shell.setAttribute('role', 'dialog');
  page.main.before(shell);
  shell.append(page.main);
  return { ...page, shell };
}

function composer(root: Element): HTMLElement {
  root.insertAdjacentHTML(
    'beforeend',
    '<input-area-v2 class="repaired-composer"><section id="repaired-draft" contenteditable="true">Kept draft</section><button aria-label="Send">Send</button></input-area-v2>',
  );
  const field = document.getElementById('repaired-draft')!;
  field.getBoundingClientRect = () => new DOMRect(0, 0, 200, 20);
  Object.defineProperty(field.nextElementSibling!, 'offsetParent', {
    configurable: true,
    value: document.body,
  });
  return field;
}

it.each(['dialog', 'div'])(
  'a remote Gemini composer is rejected because an outer %s wraps the whole app',
  async (tag) => {
    const page = sharedApp(tag);
    const field = composer(page.chatWindow);
    stop = await installGeminiSelectorPatch({
      'composer.candidates': ['#repaired-draft'],
      'composer.draftCandidates': ['#repaired-draft'],
      'composer.sendContainers': ['.repaired-composer'],
    });
    expect(findGeminiChatInput()).toBe(field);
    expect(findGeminiDraftInput(document)).toBe(field);
    expect(findOwnedGeminiMainInputs(document)).toEqual([field]);
    expect(findGeminiSendButton(field)).toBe(field.nextElementSibling);

    const preview = document.createElement('dialog');
    preview.setAttribute('open', '');
    field.before(preview);
    preview.append(field);
    expect(findGeminiChatInput()).toBeNull();
    expect(findGeminiDraftInput(document)).toBeNull();
    expect(findOwnedGeminiMainInputs(document)).toEqual([]);
    preview.before(field);
    expect(findGeminiChatInput()).toBe(field);
  },
);

it.each(['form', 'dialog'])(
  'a remote Gemini transcript is rejected because a shared %s surrounds sidebar and chat',
  (tag) => {
    const page = sharedApp(tag);
    const reply = page.chatWindow.querySelector('model-response')!;
    expect(isOriginalGeminiTranscriptElement(reply)).toBe(true);
    const preview = document.createElement(tag);
    reply.before(preview);
    preview.append(reply);
    expect(isOriginalGeminiTranscriptElement(reply)).toBe(false);
    preview.before(reply);
    expect(isOriginalGeminiTranscriptElement(reply)).toBe(true);
  },
);

function canvas(root: Element, native = false): HTMLElement {
  const tag = native ? 'immersive-editor' : 'document-editor';
  root.insertAdjacentHTML(
    'beforeend',
    `<immersive-panel><${tag} class="repaired-document"><div class="ProseMirror" contenteditable="true"><h1>Document</h1><p>Complete body</p></div></${tag}></immersive-panel>`,
  );
  return root.querySelector<HTMLElement>('.repaired-document')!;
}

it.each(['form', 'dialog'])(
  'a repaired Canvas document disappears because a shared %s owns the app',
  async (tag) => {
    const page = sharedApp(tag);
    const editor = canvas(page.main);
    stop = await installGeminiSelectorPatch({ 'canvas.documentEditors': ['.repaired-document'] });
    const expected = [{ title: 'Document', content: '# Document\n\nComplete body' }];
    expect(extractAllCanvasDocs()).toEqual(expected);
    const preview = document.createElement(tag);
    editor.before(preview);
    preview.append(editor);
    expect(extractAllCanvasDocs()).toEqual([]);
    preview.before(editor);
    expect(extractAllCanvasDocs()).toEqual(expected);
  },
);

it('Canvas document parity survives the same app DOM under a shared form', async () => {
  const page = sharedApp('form');
  canvas(page.main, true);
  const bundled = extractAllCanvasDocs();
  stop = await installGeminiSelectorPatch({ 'canvas.documentEditors': ['.repaired-document'] });
  expect(extractAllCanvasDocs()).toEqual(bundled);
  expect(bundled).toEqual([{ title: 'Document', content: '# Document\n\nComplete body' }]);
});

it('a repaired Canvas code panel disappears because a dialog wraps the whole app', async () => {
  const page = sharedApp();
  page.main.insertAdjacentHTML(
    'beforeend',
    '<immersive-panel><canvas-code-v2><toolbar><h2 class="title-text">Kept code</h2></toolbar><xap-code-editor><div class="xap-monaco-container" data-mode-id="typescript"><div class="view-lines"><div class="view-line">const kept = 1;</div></div></div></xap-code-editor></canvas-code-v2></immersive-panel>',
  );
  const editor = page.main.querySelector('canvas-code-v2')!;
  stop = await installGeminiSelectorPatch({ 'canvas.codePanels': ['canvas-code-v2'] });
  const expected = [{ title: 'Kept code', content: '// TYPESCRIPT\nconst kept = 1;' }];
  expect(extractAllCanvasDocs()).toEqual(expected);
  const preview = document.createElement('dialog');
  editor.before(preview);
  preview.append(editor);
  expect(extractAllCanvasDocs()).toEqual([]);
  preview.before(editor);
  expect(extractAllCanvasDocs()).toEqual(expected);
});

it('a repaired code block is lost because the native reply has an outer shared dialog', async () => {
  const page = sharedApp();
  const reply = page.chatWindow.querySelector('model-response')!;
  reply.insertAdjacentHTML(
    'beforeend',
    '<code-v2><div class="code-block"><div class="code-block-decoration">typescript</div><pre><code data-test-id="code-content">const kept = 1;</code></pre></div></code-v2>',
  );
  const block = reply.querySelector('code-v2')!;
  stop = await installGeminiSelectorPatch({ 'code.host': ['code-v2'] });
  expect(resolveGeminiCodeHosts(document).value).toEqual([block]);
  const preview = document.createElement('dialog');
  block.before(preview);
  preview.append(block);
  expect(resolveGeminiCodeHosts(document).value).toEqual([]);
  preview.before(block);
  expect(resolveGeminiCodeHosts(document).value).toEqual([block]);
});

it.each(['form', 'dialog'])(
  'a renamed Canvas menu loses its document because a shared %s surrounds the app',
  async (tag) => {
    const page = sharedApp(tag);
    const editor = canvas(page.main, true);
    editor.parentElement!.insertAdjacentHTML(
      'afterbegin',
      '<button aria-controls="kept-canvas-menu" aria-expanded="true"></button>',
    );
    page.main.insertAdjacentHTML(
      'beforeend',
      '<canvas-menu id="kept-canvas-menu" role="menu"></canvas-menu>',
    );
    const panel = document.getElementById('kept-canvas-menu')!;
    const source = editor.querySelector('.ProseMirror');
    fillMenu(panel);
    stop = await installGeminiSelectorPatch({ 'canvasEntry.menus': ['canvas-menu'] });
    expect(findCanvasProseMirrorRoot(panel)).toBe(source);
    const preview = document.createElement(tag);
    panel.before(preview);
    preview.append(panel);
    expect(findCanvasProseMirrorRoot(panel)).toBeNull();
    preview.before(panel);
    expect(findCanvasProseMirrorRoot(panel)).toBe(source);
    const trigger = editor.parentElement!.querySelector('button')!;
    trigger.before(preview);
    preview.append(trigger);
    expect(findCanvasProseMirrorRoot(panel)).toBeNull();
    preview.before(trigger);
    expect(findCanvasProseMirrorRoot(panel)).toBe(source);
  },
);

it('a generated image loses its native download because a form wraps the whole app', async () => {
  const page = sharedApp('form');
  const reply = page.chatWindow.querySelector('model-response')!;
  reply.insertAdjacentHTML(
    'beforeend',
    '<generated-media class="repaired-card"><single-image><button aria-label="Open image"><img src="https://lh3.googleusercontent.com/gg/kept=s1024"></button><download-generated-image-button><button id="kept-download" data-test-id="download-generated-image-button"></button></download-generated-image-button></single-image></generated-media>',
  );
  const card = reply.querySelector('.repaired-card')!;
  const button = reply.querySelector<HTMLButtonElement>('#kept-download')!;
  const image = reply.querySelector('img');
  stop = await installGeminiSelectorPatch({ 'generatedImage.container': ['.repaired-card'] });
  expect(findGeneratedPreviewForButton(button)).toBe(image);
  const preview = document.createElement('form');
  card.before(preview);
  preview.append(card);
  expect(findGeneratedPreviewForButton(button)).toBeNull();
  preview.before(card);
  expect(findGeneratedPreviewForButton(button)).toBe(image);
});

it('a repaired Gems list empties because a dialog wraps sidebar and chat', async () => {
  const page = sharedApp();
  page.main.insertAdjacentHTML(
    'beforeend',
    '<section class="repaired-gems"><bot-list-row><a class="bot-row" href="/gem/writer"><div class="bot-title"><span class="title-container">Writer</span></div></a></bot-list-row></section>',
  );
  const list = page.main.querySelector('.repaired-gems')!;
  stop = await installGeminiSelectorPatch({ 'gems.list': ['.repaired-gems'] });
  expect(readGemsList().rows.map(({ metadata }) => metadata?.name)).toEqual(['Writer']);
  const preview = document.createElement('div');
  preview.setAttribute('role', 'dialog');
  list.before(preview);
  preview.append(list);
  expect(readGemsList().rows).toEqual([]);
  preview.before(list);
  expect(readGemsList().rows.map(({ metadata }) => metadata?.name)).toEqual(['Writer']);
});

it.each(['dialog', 'div'])(
  'a nested %s cannot certify copied Gems by adding its own sidebar and composer peers',
  async (tag) => {
    const page = sharedApp();
    page.main.insertAdjacentHTML(
      'beforeend',
      `<${tag} role="dialog"><bard-sidenav></bard-sidenav><input-area></input-area><section class="copied-gems"><bot-list-row><a class="bot-row" href="/gem/writer"><div class="bot-title"><span class="title-container">Writer</span></div></a></bot-list-row></section></${tag}>`,
    );
    const list = page.main.querySelector('.copied-gems')!;
    stop = await installGeminiSelectorPatch({ 'gems.list': ['.copied-gems'] });
    expect(readGemsList().rows).toEqual([]);
    page.main.append(list);
    expect(readGemsList().rows.map(({ metadata }) => metadata?.name)).toEqual(['Writer']);
  },
);

it.each([
  ['dialog', 'none'],
  ['alertdialog', 'none'],
  ['menu', 'none'],
  ['dialog', 'chat-app'],
  ['dialog', 'interposed-dialog'],
])(
  'a sole %s preview with %s cannot certify copied Gems by inventing the complete app peers',
  async (role, host) => {
    const tag = role === 'dialog' ? 'dialog' : 'div';
    const before =
      host === 'chat-app'
        ? '<chat-app>'
        : host === 'interposed-dialog'
          ? '<chat-app-orchestrator id="app-root"><dialog><chat-app>'
          : '';
    const after =
      host === 'chat-app'
        ? '</chat-app>'
        : host === 'interposed-dialog'
          ? '</chat-app></dialog></chat-app-orchestrator>'
          : '';
    document.body.innerHTML = `<${tag} open ${role === 'dialog' ? '' : `role="${role}"`}>${before}<main><bard-sidenav></bard-sidenav><chat-window></chat-window><section class="copied-gems"><bot-list-row><a class="bot-row" href="/gem/writer"><div class="bot-title"><span class="title-container">Writer</span></div></a></bot-list-row></section></main>${after}</${tag}>`;
    const list = document.querySelector('.copied-gems')!;
    stop = await installGeminiSelectorPatch({ 'gems.list': ['.copied-gems'] });
    expect(readGemsList().rows).toEqual([]);
    const page = mountRealGeminiSidebar();
    page.main.append(list);
    expect(readGemsList().rows.map(({ metadata }) => metadata?.name)).toEqual(['Writer']);
  },
);

it.each(['Voyager', 'dialog'])(
  '%s preview peers cannot certify a shared app landmark',
  async (kind) => {
    const page = sharedApp();
    const preview = document.createElement(kind === 'dialog' ? 'dialog' : 'div');
    if (kind === 'Voyager') preview.className = 'gv-preview';
    page.container.before(preview);
    preview.append(page.sidebarHost);
    page.main.insertAdjacentHTML(
      'beforeend',
      '<section class="copied-gems"><bot-list-row><a class="bot-row" href="/gem/writer"><div class="bot-title"><span class="title-container">Writer</span></div></a></bot-list-row></section>',
    );
    stop = await installGeminiSelectorPatch({ 'gems.list': ['.copied-gems'] });
    expect(readGemsList().rows).toEqual([]);
    page.container.prepend(page.sidebarHost);
    expect(readGemsList().rows.map(({ metadata }) => metadata?.name)).toEqual(['Writer']);
  },
);

it.each(['model-response', 'user-query', 'bot-editor'])(
  'a %s frame cannot become a shared app landmark even with all native regions',
  async (tag) => {
    const page = sharedApp(tag);
    page.main.insertAdjacentHTML(
      'beforeend',
      '<section class="copied-gems"><bot-list-row><a class="bot-row" href="/gem/writer"><div class="bot-title"><span class="title-container">Writer</span></div></a></bot-list-row></section>',
    );
    stop = await installGeminiSelectorPatch({ 'gems.list': ['.copied-gems'] });
    expect(readGemsList().rows).toEqual([]);
    page.shell.before(page.main);
    expect(readGemsList().rows.map(({ metadata }) => metadata?.name)).toEqual(['Writer']);
  },
);

it('a composer copied inside the sidebar cannot prove a separate app region', async () => {
  const page = sharedApp();
  const parkedChat = document.createDocumentFragment();
  parkedChat.append(page.chatContent);
  page.sidebar.append(document.createElement('input-area'));
  page.main.insertAdjacentHTML(
    'beforeend',
    '<section class="copied-gems"><bot-list-row><a class="bot-row" href="/gem/writer"><div class="bot-title"><span class="title-container">Writer</span></div></a></bot-list-row></section>',
  );
  stop = await installGeminiSelectorPatch({ 'gems.list': ['.copied-gems'] });
  expect(readGemsList().rows).toEqual([]);
  page.container.append(parkedChat);
  expect(readGemsList().rows.map(({ metadata }) => metadata?.name)).toEqual(['Writer']);
});

it('a repaired usage panel is lost because a shared dialog wraps the app', async () => {
  history.replaceState(null, '', '/u/0/usage');
  const page = sharedApp();
  page.main.insertAdjacentHTML(
    'beforeend',
    '<section class="repaired-usage"><div class="usage-metrics-header">Usage limits</div><div class="gxu-currently">12%</div></section>',
  );
  const root = page.main.querySelector('.repaired-usage');
  stop = await installGeminiSelectorPatch({ 'usage.root': ['.repaired-usage'] });
  expect(resolveGeminiUsageRoot(document)).toBe(root);
  const preview = document.createElement('div');
  preview.setAttribute('role', 'dialog');
  root!.before(preview);
  preview.append(root!);
  expect(resolveGeminiUsageRoot(document)).toBeNull();
  preview.before(root!);
  expect(resolveGeminiUsageRoot(document)).toBe(root);
});

it('native model controls lose their association beneath a shared dialog', () => {
  const page = sharedApp();
  const field = composer(page.chatWindow);
  field.parentElement!.insertAdjacentHTML(
    'beforeend',
    '<button data-test-id="bard-mode-menu-button" aria-controls="kept-picker"></button>',
  );
  page.main.insertAdjacentHTML(
    'beforeend',
    '<div id="kept-picker" class="bard-mode-menu"><button role="menuitemradio" data-mode-id="0123456789abcdef"><span class="mode-title">Model</span></button></div>',
  );
  const trigger = field.parentElement!.querySelector<HTMLButtonElement>('[aria-controls]')!;
  const panel = document.getElementById('kept-picker')!;
  expect(isSafePickerTrigger(trigger)).toBe(true);
  expect(isSafePickerPanel(panel, trigger)).toBe(true);
  const preview = document.createElement('dialog');
  panel.before(preview);
  preview.append(panel);
  expect(isSafePickerPanel(panel, trigger)).toBe(false);
  preview.before(panel);
  expect(isSafePickerPanel(panel, trigger)).toBe(true);
});

it.each(['menu', 'alertdialog'])(
  'a repaired main composer loses model-switch focus because the whole app has role %s',
  async (role) => {
    const page = sharedApp('div');
    page.shell.setAttribute('role', role);
    const main = document.createElement('div');
    main.setAttribute('role', 'main');
    main.append(...page.main.childNodes);
    page.main.replaceWith(main);
    const field = composer(page.chatWindow);
    stop = await installGeminiSelectorPatch({ 'modelPicker.focusInput': ['#repaired-draft'] });
    expect(findModelFocusInput()).toBe(field);
    const preview = document.createElement('div');
    preview.setAttribute('role', role);
    field.before(preview);
    preview.append(field);
    expect(findModelFocusInput()).toBeNull();
    preview.before(field);
    expect(findModelFocusInput()).toBe(field);
  },
);

it('a repaired sidebar toggle is rejected because a shared menu wraps the whole app', async () => {
  const page = sharedApp('div');
  page.shell.setAttribute('role', 'menu');
  page.sidebar.insertAdjacentHTML(
    'beforeend',
    '<button id="repaired-sidebar-toggle"><span fonticon="side_nav"></span></button>',
  );
  const button = document.getElementById('repaired-sidebar-toggle')!;
  button.getBoundingClientRect = () => new DOMRect(0, 0, 32, 32);
  stop = await installGeminiSelectorPatch({ 'sidebarWidth.buttons': ['#repaired-sidebar-toggle'] });
  expect(getSidebarWidthActionButtons()).toEqual([button]);
  const preview = document.createElement('div');
  preview.setAttribute('role', 'menu');
  button.before(preview);
  preview.append(button);
  expect(getSidebarWidthActionButtons()).toEqual([]);
  preview.before(button);
  expect(getSidebarWidthActionButtons()).toEqual([button]);
});
