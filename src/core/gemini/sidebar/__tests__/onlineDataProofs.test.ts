import { afterEach, expect, it, vi } from 'vitest';

import { resolveGeminiConversationRoot } from '@/core/gemini/content/conversation';
import { findGeminiNewChat, remoteGeminiActionsContainer } from '@/core/gemini/sidebar/actions';
import { geminiTitleSelectors, type GeminiTitleKey } from '@/core/gemini/sidebar/titleProof';
import { installGeminiSelectorPatch } from '@/pages/content/__tests__/geminiOnlineSelectorFixture';
import { NativeArchivedRows } from '@/pages/content/folder/nativeArchivedRows';
import { findSidebarToggle } from '@/pages/content/sidebarAutoHide/sidebarDom';

let retire = () => {};
afterEach(() => {
  retire();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function url(path = '/app/abcdef1234'): void {
  vi.stubGlobal('location', new URL(`https://gemini.google.com${path}`));
}
function nativeTitle(): void {
  url();
  document.body.innerHTML = `<nav><a href="https://gemini.google.com/app/abcdef1234" aria-label="Saved title">Saved title</a>
    <a href="https://gemini.google.com/app/eeeeeeeeee" aria-label="Other chat">Other chat</a></nav>
    <div id="remote-title">Saved title</div><div id="wrong-title">Other chat</div>`;
}

it.each<GeminiTitleKey>([
  'title.export',
  'title.active',
  'title.activeExport',
  'title.activeResearch',
  'sidebar.pageTitle',
])(
  '%s exports the same native title through both profiles and refuses another chat',
  async (key) => {
    nativeTitle();
    const bundled = geminiTitleSelectors(key);
    const remote = document.getElementById('remote-title')!;
    if (key === 'title.export') remote.className = 'gds-label-l';
    else if (key === 'sidebar.pageTitle') {
      const parent = document.createElement('div');
      parent.className = 'conversation-title-container';
      remote.before(parent);
      parent.append(remote);
      remote.setAttribute('data-test-id', 'conversation-title');
    } else {
      const parent = document.createElement('mat-list-item');
      parent.className = 'mdc-list-item--activated';
      remote.before(parent);
      parent.append(remote);
      remote.setAttribute('mat-line', '');
    }
    const before = document.querySelector(bundled.join(','))?.textContent;
    expect(before).toBe('Saved title');
    retire = await installGeminiSelectorPatch({ [key]: ['#remote-title'] });
    const selected = geminiTitleSelectors(key);
    expect(selected).toEqual(['#remote-title']);
    expect(document.querySelector(selected.join(','))?.textContent).toBe(before);
    remote.id = 'original-title';
    const wrong = document.getElementById('wrong-title')!;
    wrong.id = 'remote-title';
    const readTitle = () =>
      document.querySelector(geminiTitleSelectors(key).join(','))?.textContent;
    expect(readTitle()).toBe('Saved title');
    wrong.id = 'wrong-title';
    remote.id = 'remote-title';
    expect(readTitle()).toBe('Saved title');
  },
);

it('a title from another account cannot replace the current conversation name', async () => {
  nativeTitle();
  url('/u/1/app/abcdef1234');
  const header = document.createElement('div');
  header.className = 'conversation-title-container';
  header.innerHTML = '<span data-test-id="conversation-title">Current account title</span>';
  document.body.append(header);
  retire = await installGeminiSelectorPatch({ 'sidebar.pageTitle': ['#remote-title'] });
  expect(
    document.querySelector(geminiTitleSelectors('sidebar.pageTitle').join(','))?.textContent,
  ).toBe('Current account title');
  document.querySelector('a')!.href = 'https://gemini.google.com/u/1/app/abcdef1234';
  expect(geminiTitleSelectors('sidebar.pageTitle')).toEqual(['#remote-title']);
});

it('a renamed new-chat link still opens the same account app root and rejects a foreign chat', async () => {
  url('/u/1/app/abcdef1234');
  document.body.innerHTML =
    '<a data-test-id="new-chat-button" id="new" href="https://gemini.google.com/u/1/app">New</a><a id="wrong" href="https://gemini.google.com/u/0/app">Wrong account</a>';
  const native = findGeminiNewChat();
  retire = await installGeminiSelectorPatch({ 'sidebar.newChat': ['#new'] });
  expect(findGeminiNewChat()).toBe(native);
  native!.removeAttribute('data-test-id');
  expect(findGeminiNewChat()).toBe(native);
  const clicks = vi.fn();
  native!.addEventListener('click', (event) => {
    event.preventDefault();
    clicks();
  });
  findGeminiNewChat()?.click();
  expect(clicks).toHaveBeenCalledOnce();
  native!.setAttribute('href', 'https://gemini.google.com/u/0/app');
  expect(findGeminiNewChat()).toBeNull();
  native!.setAttribute('href', 'https://gemini.google.com/u/1/app');
  expect(findGeminiNewChat()).toBe(native);
});

it('a renamed toggle only clicks the control associated with the native sidenav', async () => {
  document.body.innerHTML =
    '<bard-sidenav id="nav"></bard-sidenav><button id="toggle" aria-label="Open sidebar" aria-controls="nav" aria-expanded="false"></button><div id="foreign"></div>';
  const native = findSidebarToggle();
  retire = await installGeminiSelectorPatch({ 'sidebar.toggleButton': ['#toggle'] });
  expect(findSidebarToggle()).toBe(native);
  native!.removeAttribute('aria-label');
  expect(findSidebarToggle()).toBe(native);
  native!.setAttribute('aria-controls', 'foreign');
  expect(findSidebarToggle()).toBeNull();
  native!.setAttribute('aria-controls', 'nav');
  expect(findSidebarToggle()).toBe(native);
});

it('a renamed actions container cannot hide a neighbouring conversation actions', async () => {
  document.body.innerHTML =
    '<div><a data-test-id="conversation" id="row" href="/app/abcdef1234"></a><div id="actions" class="conversation-actions-container"><button id="control" data-test-id="actions-menu-button" aria-haspopup="menu" aria-controls="menu"></button></div></div><div id="menu" role="menu" aria-labelledby="control"></div>';
  const row = document.getElementById('row')!;
  const actions = document.getElementById('actions');
  const native = new NativeArchivedRows({
    getSidebar: () => row.parentElement,
    isHidingArchived: () => true,
    isInFolders: () => true,
  });
  native.apply(row, {});
  expect(actions?.classList.contains('gv-conversation-archived-actions')).toBe(true);
  actions!.className = '';
  retire = await installGeminiSelectorPatch({ 'sidebar.actionsContainer': ['#actions'] });
  expect(remoteGeminiActionsContainer(row)).toBe(actions);
  const archived = new NativeArchivedRows({
    getSidebar: () => row.parentElement,
    isHidingArchived: () => true,
    isInFolders: () => true,
  });
  archived.apply(row, {});
  expect(actions?.classList.contains('gv-conversation-archived-actions')).toBe(true);
  actions?.classList.remove('gv-conversation-archived-actions');
  document.getElementById('menu')!.setAttribute('aria-labelledby', 'someone-else');
  expect(remoteGeminiActionsContainer(row)).toBeNull();
  archived.apply(row, {});
  expect(actions?.classList.contains('gv-conversation-archived-actions')).toBe(false);
  document.getElementById('menu')!.setAttribute('aria-labelledby', 'control');
  expect(remoteGeminiActionsContainer(row)).toBe(actions);
  document.getElementById('control')!.setAttribute('data-test-id', 'settings-menu-button');
  archived.apply(row, {});
  expect(actions?.classList.contains('gv-conversation-archived-actions')).toBe(false);
  document.getElementById('control')!.setAttribute('data-test-id', 'actions-menu-button');
  archived.apply(row, {});
  expect(actions?.classList.contains('gv-conversation-archived-actions')).toBe(true);
});

it('a renamed conversation root exports every turn and refuses a partial preview', async () => {
  document.body.innerHTML =
    '<section id="chat-history" style="overflow-y:auto"><div class="conversation-container"><user-query>One</user-query><model-response>Answer one</model-response></div><div class="conversation-container"><user-query>Two</user-query><model-response>Answer two</model-response></div></section>';
  const scrolling = document.getElementById('chat-history')!;
  Object.defineProperties(scrolling, {
    scrollHeight: { value: 1000, configurable: true },
    clientHeight: { value: 500 },
  });
  const native = resolveGeminiConversationRoot(['user-query']);
  retire = await installGeminiSelectorPatch({ 'conversation.roots': ['[data-chat-root]'] });
  native.setAttribute('data-chat-root', '');
  expect(resolveGeminiConversationRoot(['user-query'])).toBe(native);
  native.id = 'renamed';
  expect(resolveGeminiConversationRoot(['user-query'])).toBe(native);
  Object.defineProperty(native, 'scrollHeight', { value: 500, configurable: true });
  expect(resolveGeminiConversationRoot(['user-query'])).toBe(document.body);
  Object.defineProperty(native, 'scrollHeight', { value: 1000, configurable: true });
  native.removeAttribute('data-chat-root');
  const preview = native.firstElementChild!;
  preview.setAttribute('data-chat-root', '');
  expect(resolveGeminiConversationRoot(['user-query'])).toBe(document.body);
  preview.removeAttribute('data-chat-root');
  native.setAttribute('data-chat-root', '');
  expect(resolveGeminiConversationRoot(['user-query'])).toBe(native);
});

it.each(['role="dialog"', 'contenteditable="true"', 'class="gv-preview"'])(
  'a preview with %s cannot become the current conversation when no real turns exist',
  async (attributes) => {
    document.body.innerHTML = `<main></main><section ${attributes}><div id="preview" style="overflow-y:auto"><div class="conversation-container"><user-query>Preview question</user-query><model-response>Preview answer</model-response></div></div></section>`;
    const preview = document.getElementById('preview')!;
    Object.defineProperties(preview, {
      scrollHeight: { value: 1000 },
      clientHeight: { value: 100 },
    });
    retire = await installGeminiSelectorPatch({ 'conversation.roots': ['#preview'] });
    expect(resolveGeminiConversationRoot(['user-query'])).toBe(document.querySelector('main'));
    const wrapper = preview.parentElement!;
    wrapper.removeAttribute('role');
    wrapper.removeAttribute('contenteditable');
    wrapper.removeAttribute('class');
    expect(resolveGeminiConversationRoot(['user-query'])).toBe(preview);
  },
);

it.each(['form', 'gv-preview', 'contenteditable'])(
  'a %s sidenav preview cannot redirect the remote toggle click',
  async (kind) => {
    document.body.innerHTML =
      '<bard-sidenav id="real"></bard-sidenav><button id="native" aria-label="Open sidebar"></button><div id="preview-owner"><bard-sidenav id="fake"></bard-sidenav></div><button id="remote" aria-controls="fake" aria-expanded="false"></button>';
    const owner = document.getElementById('preview-owner')!;
    if (kind === 'form') {
      const form = document.createElement('form');
      owner.before(form);
      form.append(owner);
    }
    if (kind === 'gv-preview') owner.className = 'gv-preview';
    if (kind === 'contenteditable') owner.setAttribute('contenteditable', 'true');
    const clicks: string[] = [];
    for (const button of document.querySelectorAll('button'))
      button.addEventListener('click', () => clicks.push(button.id));
    retire = await installGeminiSelectorPatch({ 'sidebar.toggleButton': ['#remote'] });
    findSidebarToggle()?.click();
    expect(clicks).toEqual(['native']);
    document.getElementById('native')!.remove();
    document.getElementById('real')!.remove();
    owner.className = '';
    owner.removeAttribute('contenteditable');
    document.body.append(owner);
    findSidebarToggle()?.click();
    expect(clicks).toEqual(['native', 'remote']);
  },
);

it('another surviving native sidenav cannot redirect the repaired toggle', async () => {
  document.body.innerHTML =
    '<bard-sidenav id="real"></bard-sidenav><button id="native" aria-label="Open sidebar"></button><bard-sidenav id="second"></bard-sidenav><button id="remote" aria-controls="second" aria-expanded="false"></button>';
  const clicks: string[] = [];
  for (const button of document.querySelectorAll('button'))
    button.addEventListener('click', () => clicks.push(button.id));
  retire = await installGeminiSelectorPatch({ 'sidebar.toggleButton': ['#remote'] });
  findSidebarToggle()?.click();
  expect(clicks).toEqual(['native']);
  document.getElementById('native')!.remove();
  document.getElementById('real')!.remove();
  findSidebarToggle()?.click();
  expect(clicks).toEqual(['native', 'remote']);
});
