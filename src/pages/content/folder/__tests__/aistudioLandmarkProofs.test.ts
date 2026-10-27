// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://aistudio.google.com/library" }
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initializeSiteSelectors } from '@/core/selectors';

import { readAIStudioLibraryLink, readAIStudioLibraryRows } from '../aistudioLocatorReads';
import { readAIStudioDragHost, readAIStudioPromptLink } from '../aistudioNavigationReads';
import { mountRealAIStudioNavigation } from './realAIStudioNavigationFixture';

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

function renamedNavigation() {
  const shape = mountRealAIStudioNavigation();
  history.replaceState(null, '', '/u/1/library');
  shape.library.href = '/u/1/library';
  shape.prompt.href = '/u/1/prompts/a';
  anchor('b').href = '/u/1/prompts/b';
  shape.prompt.className = '';
  shape.row.removeAttribute('role');
  return shape;
}

const repairedNavigation = {
  'navigation.libraryLink': ['#library'],
  'navigation.promptLink': ['#a'],
  'history.dragHosts': ['article'],
};

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  document.body.replaceChildren();
  history.replaceState(null, '', '/library');
  vi.restoreAllMocks();
});

describe('AI Studio native navigation landmarks', () => {
  it('a repaired sidebar prompt remains usable beside the AI Studio main content', async () => {
    const { library, prompt, row } = renamedNavigation();
    await patch(repairedNavigation);
    expect(readAIStudioLibraryLink()).toBe(library);
    expect(readAIStudioPromptLink('a', 'a')).toBe(prompt);
    expect(readAIStudioDragHost(prompt)).toBe(row);
  });

  it('bundled and remote navigation read the same nodes on the captured AI Studio DOM', async () => {
    const { library, prompt, row } = mountRealAIStudioNavigation();
    const before = [
      readAIStudioLibraryLink(),
      readAIStudioPromptLink('a', 'a'),
      readAIStudioDragHost(prompt),
    ];
    expect(before).toEqual([library, prompt, row]);
    await patch(repairedNavigation);
    expect([
      readAIStudioLibraryLink(),
      readAIStudioPromptLink('a', 'a'),
      readAIStudioDragHost(prompt),
    ]).toEqual(before);
  });

  it.each([
    { name: 'content tabs', markup: '<nav mat-tab-nav-bar></nav>', inMain: true },
    { name: 'content breadcrumbs', markup: '<nav aria-label="Breadcrumb"></nav>', inMain: true },
    {
      name: 'content ARIA navigation',
      markup: '<section role="navigation"></section>',
      inMain: true,
    },
    { name: 'a closed dialog', markup: '<dialog><nav></nav></dialog>', inMain: false },
    { name: 'a dialog', markup: '<section role="dialog"><nav></nav></section>', inMain: false },
    {
      name: 'an alert dialog',
      markup: '<section role="alertdialog"><nav></nav></section>',
      inMain: false,
    },
    { name: 'a menu', markup: '<section role="menu"><nav></nav></section>', inMain: false },
    {
      name: 'Voyager UI',
      markup: '<section data-gv-component="preview"><nav></nav></section>',
      inMain: false,
    },
  ])(
    '$name beside the AI Studio sidebar does not disable its repaired prompt or Library link',
    async ({ markup, inMain }) => {
      const { content, layout, navigation, library, prompt } = renamedNavigation();
      const parent = inMain ? content : layout;
      parent.insertAdjacentHTML('beforeend', markup);
      const copy = parent.lastElementChild!;
      await patch(repairedNavigation);
      expect(readAIStudioLibraryLink()).toBe(library);
      expect(readAIStudioPromptLink('a', 'a')).toBe(prompt);

      // The same frozen remote values must fail when their links move into the excluded owner.
      copy.append(library, prompt);
      expect(readAIStudioLibraryLink()).toBeNull();
      expect(readAIStudioPromptLink('a', 'a')).toBeNull();
      navigation.append(library, prompt);
      expect(readAIStudioLibraryLink()).toBe(library);
      expect(readAIStudioPromptLink('a', 'a')).toBe(prompt);
    },
  );

  it.each(['main', 'section role="main"', 'main role="navigation"'])(
    'a %s nested inside the sidebar nav cannot donate a repaired prompt or Library link',
    async (wrapper) => {
      const { navigation, library, prompt } = renamedNavigation();
      const tag = wrapper.split(' ')[0];
      navigation.insertAdjacentHTML('beforeend', `<${wrapper} id="nested-main"></${tag}>`);
      document.getElementById('nested-main')!.append(library, prompt);
      await patch(repairedNavigation);
      expect(readAIStudioLibraryLink()).toBeNull();
      expect(readAIStudioPromptLink('a', 'a')).toBeNull();
      navigation.append(library, prompt);
      expect(readAIStudioLibraryLink()).toBe(library);
      expect(readAIStudioPromptLink('a', 'a')).toBe(prompt);
    },
  );

  it.each(['nav', 'section role="navigation"'])(
    'an in-content %s cannot donate a repaired sidebar prompt or Library control',
    async (wrapper) => {
      const { content, library, prompt, navigation } = renamedNavigation();
      const tag = wrapper.split(' ')[0];
      content.insertAdjacentHTML('beforeend', `<${wrapper} id="tabs"></${tag}>`);
      const tabs = document.getElementById('tabs')!;
      tabs.append(library, prompt);
      await patch(repairedNavigation);
      expect(readAIStudioLibraryLink()).toBeNull();
      expect(readAIStudioPromptLink('a', 'a')).toBeNull();
      navigation.append(library, prompt);
      expect(readAIStudioLibraryLink()).toBe(library);
      expect(readAIStudioPromptLink('a', 'a')).toBe(prompt);
    },
  );

  it('a sidebar-shaped navigation inside main cannot become the native sidebar', async () => {
    const { navbar, content, layout, library, prompt } = renamedNavigation();
    content.append(navbar);
    await patch(repairedNavigation);
    expect(readAIStudioLibraryLink()).toBeNull();
    expect(readAIStudioPromptLink('a', 'a')).toBeNull();
    layout.prepend(navbar);
    expect(readAIStudioLibraryLink()).toBe(library);
    expect(readAIStudioPromptLink('a', 'a')).toBe(prompt);
  });

  it('a second navigation owner cannot silently choose a repaired sidebar prompt', async () => {
    const { layout, prompt } = renamedNavigation();
    const other = document.createElement('nav');
    layout.append(other);
    await patch(repairedNavigation);
    expect(readAIStudioPromptLink('a', 'a')).toBeNull();
    other.remove();
    expect(readAIStudioPromptLink('a', 'a')).toBe(prompt);
  });

  it('a copied navigation beside the app cannot borrow the native sidebar identity', async () => {
    const { sidebar, navigation, prompt } = renamedNavigation();
    sidebar.className = '';
    await patch(repairedNavigation);
    expect(readAIStudioPromptLink('a', 'a')).toBeNull();
    sidebar.className = 'nav-content v3-left-nav';
    expect(readAIStudioPromptLink('a', 'a')).toBe(prompt);
    document.body.append(prompt);
    expect(readAIStudioPromptLink('a', 'a')).toBeNull();
    navigation.append(prompt);
    expect(readAIStudioPromptLink('a', 'a')).toBe(prompt);
  });

  it('a packaged-looking sidebar outside the native navbar cannot certify prompt ownership', async () => {
    const { layout, sidebar, navbar, prompt } = renamedNavigation();
    layout.append(sidebar);
    await patch(repairedNavigation);
    expect(readAIStudioPromptLink('a', 'a')).toBeNull();
    navbar.append(sidebar);
    expect(readAIStudioPromptLink('a', 'a')).toBe(prompt);
  });

  it('a nested navigation cannot borrow the packaged sidebar as its native owner', async () => {
    const { sidebar, navigation, prompt } = renamedNavigation();
    const wrapper = document.createElement('section');
    sidebar.append(wrapper);
    wrapper.append(navigation);
    await patch(repairedNavigation);
    expect(readAIStudioPromptLink('a', 'a')).toBeNull();
    sidebar.append(navigation);
    expect(readAIStudioPromptLink('a', 'a')).toBe(prompt);
  });

  it.each(['dialog', 'section role="dialog"', 'section role="alertdialog"', 'section role="menu"'])(
    'a %s with copied app-shaped navigation cannot certify the original app',
    async (wrapper) => {
      const { app, library, prompt } = renamedNavigation();
      const tag = wrapper.split(' ')[0];
      app.outerHTML = `<${wrapper}>${app.outerHTML}</${tag}>`;
      await patch(repairedNavigation);
      expect(readAIStudioLibraryLink()).toBeNull();
      expect(readAIStudioPromptLink('a', 'a')).toBeNull();
      const overlay = document.body.firstElementChild!;
      overlay.replaceWith(...overlay.childNodes);
      expect(readAIStudioLibraryLink()).toBe(anchor(library.id));
      expect(readAIStudioPromptLink('a', 'a')).toBe(anchor(prompt.id));
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

  it('a reply table cannot become a native library beside the sidebar', async () => {
    const { content } = mountRealAIStudioNavigation();
    content.querySelector('ms-chat-turn')!.innerHTML =
      '<table><tr class="row" id="row"><td><a id="reply-link" href="/prompts/a">Alpha</a></td></tr></table>';
    await patch({ 'library.rows': ['.row'] });
    expect(readAIStudioLibraryRows()).toEqual([]);
    content.append(document.querySelector('table')!);
    expect(readAIStudioLibraryRows()).toEqual([
      { row: document.getElementById('row'), anchor: anchor('reply-link') },
    ]);
  });

  it.each([
    'role="dialog"',
    'role="alertdialog"',
    'role="menu"',
    'contenteditable="true"',
    'data-turn-role="Model"',
    'data-gv-component="preview"',
  ])('a %s preview cannot borrow native sidebar ownership', async (marker) => {
    const { navigation, prompt } = renamedNavigation();
    navigation.insertAdjacentHTML('beforeend', `<section ${marker} id="preview"></section>`);
    document.getElementById('preview')!.append(prompt);
    await patch(repairedNavigation);
    expect(readAIStudioPromptLink('a', 'a')).toBeNull();
    navigation.append(prompt);
    expect(readAIStudioPromptLink('a', 'a')).toBe(prompt);
  });
});
