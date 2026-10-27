// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://aistudio.google.com/library" }
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initializeSiteSelectors } from '@/core/selectors';

import { readAIStudioLibraryLink, readAIStudioLibraryRows } from '../aistudioLocatorReads';
import { readAIStudioDragHost, readAIStudioPromptLink } from '../aistudioNavigationReads';

const stops: Array<() => void> = [];
async function patch(locators: Record<string, readonly string[]>) {
  const run = initializeSiteSelectors('aistudio', {
    host: location.hostname,
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 0,
    read: async () => ({ id: 'aistudio', catalogRevision: 1, locators }),
  });
  stops.push(run.stop);
  await run.ready;
}

function anchor(id: string): HTMLAnchorElement {
  const result = document.getElementById(id);
  if (!(result instanceof HTMLAnchorElement)) throw new Error(`Missing anchor ${id}`);
  return result;
}

function navigation() {
  document.body.innerHTML = `<div id="app"><form><main>
    <aside class="nav-content v3-left-nav" id="sidebar">
      <nav><a id="library" href="/library">Library</a></nav>
      <ms-prompt-history-v3><article id="row-a"><span><a class="prompt-link" id="a" href="/prompts/a">Alpha</a></span></article><article id="row-b"><span><a class="prompt-link" id="b" href="/prompts/b">Beta</a></span></article></ms-prompt-history-v3>
    </aside>
    <section><ms-chat-turn data-turn-role="Model"><a href="/prompts/other">Quoted prompt</a></ms-chat-turn></section>
  </main></form></div>`;
}

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('AI Studio native navigation landmarks', () => {
  it('a remote AI Studio navigation locator is rejected because the app sits inside main', async () => {
    navigation();
    const library = anchor('library');
    const prompt = anchor('a');
    const sidebar = document.getElementById('sidebar')!;
    sidebar.className = '';
    prompt.className = '';
    await patch({
      'navigation.libraryLink': ['#library'],
      'navigation.promptLink': ['#a'],
      'history.dragHosts': ['article'],
    });
    expect(readAIStudioLibraryLink()).toBe(library);
    expect(readAIStudioPromptLink('a', 'a')).toBe(prompt);
    expect(readAIStudioDragHost(prompt)).toBe(document.getElementById('row-a'));
  });

  it('bundled and remote navigation read the same nodes beneath shared app landmarks', async () => {
    navigation();
    const library = readAIStudioLibraryLink();
    const prompt = readAIStudioPromptLink('a', 'a');
    const row = readAIStudioDragHost(anchor('a'));
    expect(library).toBe(anchor('library'));
    expect(prompt).toBe(anchor('a'));
    await patch({
      'navigation.libraryLink': ['#library'],
      'navigation.promptLink': ['#a'],
      'history.dragHosts': ['span'],
    });
    expect(readAIStudioLibraryLink()).toBe(library);
    expect(readAIStudioPromptLink('a', 'a')).toBe(prompt);
    expect(readAIStudioDragHost(anchor('a'))).toBe(row);
  });

  it.each(['dialog', 'section role="dialog"', 'section role="alertdialog"', 'section role="menu"'])(
    'a %s with copied app-shaped navigation cannot certify the original app',
    async (wrapper) => {
      navigation();
      const tag = wrapper.split(' ')[0];
      const app = document.getElementById('app')!;
      app.outerHTML = `<${wrapper}>${app.innerHTML}</${tag}>`;
      document.getElementById('sidebar')!.className = '';
      anchor('a').className = '';
      await patch({ 'navigation.libraryLink': ['#library'], 'navigation.promptLink': ['#a'] });
      expect(readAIStudioLibraryLink()).toBeNull();
      expect(readAIStudioPromptLink('a', 'a')).toBeNull();
      const overlay = document.body.firstElementChild!;
      overlay.replaceWith(...overlay.childNodes);
      expect(readAIStudioLibraryLink()).toBe(anchor('library'));
      expect(readAIStudioPromptLink('a', 'a')).toBe(anchor('a'));
    },
  );

  it.each(['dialog', 'section role="dialog"', 'section role="alertdialog"', 'section role="menu"'])(
    'a %s with copied navigation cannot appoint its table as the library',
    async (wrapper) => {
      const tag = wrapper.split(' ')[0];
      document.body.innerHTML = `<${wrapper}><aside><nav><a href="/library">Library</a></nav></aside><main><table><tr class="row" id="row"><td><a id="a" href="/prompts/a">Alpha</a></td></tr></table></main></${tag}>`;
      await patch({ 'library.rows': ['.row'] });
      expect(readAIStudioLibraryRows()).toEqual([]);
      document.body.firstElementChild!.replaceWith(document.querySelector('main')!);
      expect(readAIStudioLibraryRows()).toEqual([
        { row: document.getElementById('row'), anchor: anchor('a') },
      ]);
    },
  );

  it('a reply table cannot become a native library beneath a shared shell', async () => {
    document.body.innerHTML =
      '<main><aside></aside><ms-chat-turn><table><tr class="row" id="row"><td><a id="a" href="/prompts/a">Alpha</a></td></tr></table></ms-chat-turn></main>';
    await patch({ 'library.rows': ['.row'] });
    expect(readAIStudioLibraryRows()).toEqual([]);
    document.querySelector('main')!.append(document.querySelector('table')!);
    expect(readAIStudioLibraryRows()).toEqual([
      { row: document.getElementById('row'), anchor: anchor('a') },
    ]);
  });

  it.each([
    '<main><dialog><aside><a id="a" href="/prompts/a">Alpha</a></aside><ms-prompt-box></ms-prompt-box></dialog></main>',
    '<main>Live app</main><dialog><main><aside><a id="a" href="/prompts/a">Alpha</a></aside><ms-prompt-box></ms-prompt-box></main></dialog>',
    '<dialog><aside><a id="a" href="/prompts/a">Alpha</a></aside><ms-prompt-box></ms-prompt-box></dialog>',
  ])(
    'a copied navigation and composer cannot appoint their preview as the app shell (%#)',
    async (markup) => {
      document.body.innerHTML = markup;
      await patch({ 'navigation.promptLink': ['#a'] });
      expect(readAIStudioPromptLink('a', 'a')).toBeNull();
      const preview = document.querySelector('dialog')!;
      preview.replaceWith(...preview.childNodes);
      expect(readAIStudioPromptLink('a', 'a')).toBe(anchor('a'));
    },
  );

  it.each(['main', 'section role="main"', 'main role="navigation"'])(
    'a %s inside the navigation cannot donate a repaired Library control',
    async (wrapper) => {
      const tag = wrapper.split(' ')[0];
      document.body.innerHTML = `<nav id="navigation"><${wrapper}><a id="library" href="/library">Preview</a></${tag}></nav>`;
      const library = anchor('library');
      await patch({ 'navigation.libraryLink': ['#library'] });
      expect(readAIStudioLibraryLink()).toBeNull();
      document.getElementById('navigation')!.append(library);
      expect(readAIStudioLibraryLink()).toBe(library);
    },
  );

  it.each(['nav', 'aside', 'section role="navigation"', 'div class="nav-content v3-left-nav"'])(
    'a repaired prompt uses its independent %s owner beneath main',
    async (wrapper) => {
      const tag = wrapper.split(' ')[0];
      document.body.innerHTML = `<main><${wrapper}><a id="a" href="/prompts/a">Alpha</a></${tag}><section>Conversation</section></main>`;
      await patch({ 'navigation.promptLink': ['#a'] });
      expect(readAIStudioPromptLink('a', 'a')).toBe(anchor('a'));
    },
  );

  it('a repaired prompt in app content needs its own navigation owner', async () => {
    document.body.innerHTML =
      '<main><section><a id="a" href="/prompts/a">Quoted prompt</a></section></main>';
    const prompt = anchor('a');
    await patch({ 'navigation.promptLink': ['#a'] });
    expect(readAIStudioPromptLink('a', 'a')).toBeNull();
    const sidebar = document.createElement('aside');
    document.querySelector('main')!.prepend(sidebar);
    sidebar.append(prompt);
    expect(readAIStudioPromptLink('a', 'a')).toBe(prompt);
  });

  it.each([
    'role="dialog"',
    'role="alertdialog"',
    'contenteditable="true"',
    'data-turn-role="Model"',
    'data-gv-component="preview"',
  ])('a %s preview cannot borrow a shared main navigation owner', async (marker) => {
    document.body.innerHTML = `<main><aside><section ${marker}><a id="a" href="/prompts/a">Preview</a></section></aside></main>`;
    const prompt = anchor('a');
    await patch({ 'navigation.promptLink': ['#a'] });
    expect(readAIStudioPromptLink('a', 'a')).toBeNull();
    document.querySelector('aside')!.append(prompt);
    expect(readAIStudioPromptLink('a', 'a')).toBe(prompt);
  });
});
