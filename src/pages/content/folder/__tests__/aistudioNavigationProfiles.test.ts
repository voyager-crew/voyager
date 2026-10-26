// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://aistudio.google.com/library" }
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initializeSiteSelectors } from '@/core/selectors';
import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import {
  insertFolderPanel,
  waitForPanelAnchor,
} from '@/features/plugins/verbs/folders/aistudio/panel';
import { openPromptInApp } from '@/features/plugins/verbs/folders/aistudio/routes';
import { activateAIStudioSidebarWidth } from '@/pages/content/aistudioSidebarWidth/pluginHandler';

import { applyHideArchivedRows, getLibraryPromptRows } from '../aistudioLibraryTable';
import { readAIStudioLibraryRows, isAIStudioLibraryRowDrag } from '../aistudioLocatorReads';
import {
  readAIStudioHistoryRoot,
  readAIStudioNavChild,
  readAIStudioSidebar,
} from '../aistudioNavigationReads';
import { bindPromptDragSources, watchPromptHistory } from '../aistudioPromptHistory';

const stops: Array<() => void | Promise<void>> = [];
async function patch(locators: Record<string, readonly string[]>) {
  const lifetime = new AbortController();
  const run = initializeSiteSelectors('aistudio', {
    host: 'aistudio.google.com',
    doc: document,
    lifetime: lifetime.signal,
    bundledRevision: 0,
    read: async () => ({ id: 'aistudio', catalogRevision: 1, locators }),
  });
  stops.push(run.stop);
  await run.ready;
}
const node = (id: string) => document.getElementById(id)!;
afterEach(async () => {
  for (const stop of stops.splice(0).reverse()) await stop();
  document.body.replaceChildren();
  history.replaceState(null, '', '/library');
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('AI Studio navigation catalog repairs', () => {
  it('bundled panel startup keeps one document query and the first anchor in document order', async () => {
    document.body.innerHTML =
      '<div class="nav-content v3-left-nav"><nav><div class="empty-space" id="first"></div></nav><ms-prompt-history-v3 id="later"></ms-prompt-history-v3></div>';
    const expected = node('first');
    const query = vi.spyOn(document, 'querySelector');
    expect(await waitForPanelAnchor('.nav-content.v3-left-nav', new AbortController().signal)).toBe(
      expected,
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('bundled and remote navigation profiles mount the same folder panel on the same DOM', async () => {
    document.body.innerHTML =
      '<div class="nav-content v3-left-nav" id="sidebar"><nav id="nav"><div class="empty-space" id="space"></div></nav><section id="wrapper"><ms-prompt-history-v3 id="history"><a href="/prompts/a">Alpha</a></ms-prompt-history-v3></section></div>';
    const before = [
      readAIStudioSidebar(),
      readAIStudioHistoryRoot(),
      readAIStudioNavChild(node('sidebar')),
    ];
    await patch({
      'navigation.sidebar': ['#sidebar'],
      'navigation.historyRoot': ['#history'],
      'navigation.navChild': [':scope > #nav'],
    });
    expect([
      readAIStudioSidebar(),
      readAIStudioHistoryRoot(),
      readAIStudioNavChild(node('sidebar')),
    ]).toEqual(before);
    const panel = document.createElement('section');
    expect(insertFolderPanel(panel, readAIStudioHistoryRoot(), '.nav-content.v3-left-nav')).toBe(
      true,
    );
    expect(panel.nextElementSibling).toBe(node('wrapper'));
  });

  it('a renamed sidebar is shared by the folder mount and the width handle', async () => {
    document.body.innerHTML =
      '<aside class="expanded" id="sidebar"><nav><a href="/library">Library</a><div class="empty-space" id="space"></div></nav></aside>';
    await patch({ 'navigation.sidebar': ['#sidebar'] });
    const panel = document.createElement('section');
    expect(insertFolderPanel(panel, null, '.nav-content.v3-left-nav')).toBe(true);
    expect(panel.nextElementSibling).toBe(node('space'));
    panel.classList.add('gv-folder-container');
    const scope = new PluginScope();
    stops.push(() => scope.dispose());
    activateAIStudioSidebarWidth(scope, { widthPx: 420 });
    expect(node('sidebar').style.width).toBe('420px');
    expect(node('sidebar').querySelectorAll('.gv-sidebar-resize-handle')).toHaveLength(1);
    expect(readAIStudioSidebar()).toBe(node('sidebar'));
  });

  it('a remote sidebar cannot absorb an unrelated panel or borrow another account’s Library link', async () => {
    document.body.innerHTML =
      '<aside id="sidebar"><nav><a href="/u/0/library">Library</a></nav></aside>';
    history.replaceState(null, '', '/u/1/library');
    await patch({ 'navigation.sidebar': ['#sidebar'] });
    const panel = document.createElement('section');
    expect(insertFolderPanel(panel, null, '.nav-content.v3-left-nav')).toBe(false);
    document.querySelector('a')!.href = '/u/1/library';
    node('sidebar').insertAdjacentHTML('beforeend', '<section id="foreign">Unrelated</section>');
    expect(insertFolderPanel(panel, null, '.nav-content.v3-left-nav')).toBe(false);
    node('foreign').remove();
    expect(insertFolderPanel(panel, null, '.nav-content.v3-left-nav')).toBe(true);
  });

  it('a second navigation landmark prevents an ambiguous sidebar repair', async () => {
    document.body.innerHTML =
      '<nav id="one"><a href="/library">Library</a></nav><nav id="two"><a href="/library">Library</a></nav>';
    await patch({ 'navigation.sidebar': ['#one'] });
    expect(readAIStudioSidebar()).toBeNull();
    node('two').remove();
    expect(readAIStudioSidebar()).toBe(node('one'));
  });

  it('reply and Voyager navigation cannot receive a remotely mounted width handle', async () => {
    document.body.innerHTML =
      '<main><nav id="reply"><a href="/library">Library</a></nav></main><section class="gv-folder-container"><nav id="own"><a href="/library">Library</a></nav></section><nav id="native"><a href="/library">Library</a></nav>';
    await patch({ 'navigation.sidebar': ['#reply'] });
    expect(readAIStudioSidebar()).toBeNull();
    await patch({ 'navigation.sidebar': ['#own'] });
    expect(readAIStudioSidebar()).toBeNull();
    await patch({ 'navigation.sidebar': ['#native'] });
    expect(readAIStudioSidebar()).toBe(node('native'));
  });

  it('a renamed navigation child keeps folder insertion inside its direct landmark', async () => {
    document.body.innerHTML =
      '<div class="nav-content v3-left-nav" id="sidebar"><section role="navigation" id="nav"><div class="empty-space" id="space"></div><div><section id="wrong"></section></div></section></div>';
    await patch({ 'navigation.navChild': [':scope > #nav'] });
    const panel = document.createElement('section');
    expect(insertFolderPanel(panel, null, '.nav-content.v3-left-nav')).toBe(true);
    expect(panel.nextElementSibling).toBe(node('space'));
    await patch({ 'navigation.navChild': ['#wrong'] });
    expect(readAIStudioNavChild(node('sidebar'))).toBeNull();
  });

  it('a renamed history list repairs the mount only when its complete prompt list owns the wrapper', async () => {
    document.body.innerHTML =
      '<aside class="nav-content v3-left-nav" id="sidebar"><section id="wrapper"><history-new role="list" id="history"><a href="/prompts/a">Alpha</a><a href="/prompts/b">Beta</a></history-new></section></aside>';
    await patch({ 'navigation.historyRoot': ['#history'] });
    expect(readAIStudioHistoryRoot()).toBe(node('history'));
    const panel = document.createElement('section');
    panel.className = 'gv-folder-container';
    expect(insertFolderPanel(panel, readAIStudioHistoryRoot(), '.nav-content.v3-left-nav')).toBe(
      true,
    );
    expect(panel.nextElementSibling).toBe(node('wrapper'));
    node('wrapper').insertAdjacentHTML('beforeend', '<button id="extra">Unrelated action</button>');
    expect(readAIStudioHistoryRoot()).toBeNull();
    node('extra').remove();
    node('sidebar').insertAdjacentHTML('beforeend', '<a id="missing" href="/prompts/c">Gamma</a>');
    expect(readAIStudioHistoryRoot()).toBeNull();
    node('missing').remove();
    node('history').removeAttribute('role');
    expect(readAIStudioHistoryRoot()).toBeNull();
  });

  it('a prompt-link repair clicks the exact prompt ID and account instead of a matching prefix', async () => {
    history.replaceState(null, '', '/u/1/library');
    document.body.innerHTML =
      '<aside class="nav-content v3-left-nav"><a id="prefix" class="repaired" href="/u/1/prompts/a-suffix">Other</a><a id="target" href="/u/1/prompts/a">Alpha</a></aside>';
    const wrong = vi.spyOn(node('prefix'), 'click').mockImplementation(() => {});
    const right = vi.spyOn(node('target'), 'click').mockImplementation(() => {});
    await patch({ 'navigation.promptLink': ['a.repaired'] });
    openPromptInApp('a', '/u/1/prompts/a');
    expect(wrong).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/u/1/prompts/a');
    await patch({ 'navigation.promptLink': ['#target'] });
    openPromptInApp('a', '/u/1/prompts/a');
    expect(right).toHaveBeenCalledTimes(1);
    (node('target') as HTMLAnchorElement).href = '/u/0/prompts/a';
    openPromptInApp('a', '/u/1/prompts/a');
    expect(right).toHaveBeenCalledTimes(1);
  });

  it('renamed history click controls notify only for original same-account prompt anchors', async () => {
    vi.useFakeTimers();
    document.body.innerHTML =
      '<section id="history"><a class="repaired" id="link" href="/prompts/a"><span>Alpha</span></a><a class="repaired" id="foreign" href="https://example.com/prompts/b">Foreign</a></section>';
    await patch({ 'history.click': ['a.repaired'] });
    const onPromptClick = vi.fn();
    node('history').addEventListener('click', (event) => event.preventDefault());
    stops.push(
      watchPromptHistory(node('history'), {
        hasStoredPrompts: () => false,
        syncTitles: async () => {},
        onPromptClick,
      }),
    );
    node('link')
      .querySelector('span')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    vi.runOnlyPendingTimers();
    expect(onPromptClick).toHaveBeenCalledTimes(1);
    node('foreign').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    vi.runOnlyPendingTimers();
    expect(onPromptClick).toHaveBeenCalledTimes(1);
  });

  it('a history row repair drags one prompt and cannot make the entire list draggable', async () => {
    document.body.innerHTML =
      '<section id="history"><article class="row" id="a"><span><a href="/prompts/a">Alpha</a></span></article><article class="row" id="b"><span><a href="/prompts/b">Beta</a></span></article></section>';
    await patch({ 'history.dragHosts': ['#history'] });
    bindPromptDragSources(node('history'));
    expect(node('history').draggable).toBe(false);
    expect(node('a').querySelector('span')!.draggable).toBe(true);
    document
      .querySelectorAll('a')
      .forEach((anchor) => anchor.removeAttribute('data-gv-drag-bound'));
    await patch({ 'history.dragHosts': ['.row'] });
    bindPromptDragSources(node('history'));
    expect(node('a').draggable).toBe(true);
    expect(node('b').draggable).toBe(true);
  });

  it('one row-name repair restores the library list and drop source together', async () => {
    document.body.innerHTML =
      '<table><tr class="mat-mdc-row repaired" id="a"><td><a href="/prompts/a">Alpha</a></td></tr><tr class="mat-mdc-row repaired" id="b"><td><a href="/prompts/b">Beta</a></td></tr></table>';
    const bundled = getLibraryPromptRows();
    expect(isAIStudioLibraryRowDrag(node('a').querySelector('a')!)).toBe(true);
    await patch({
      'library.rows': ['table .repaired'],
      'library.archivableRows': ['table .repaired'],
    });
    expect(getLibraryPromptRows()).toEqual(bundled);
    document.querySelectorAll('tr').forEach((row) => row.classList.remove('mat-mdc-row'));
    expect(getLibraryPromptRows()).toEqual(bundled);
    expect(isAIStudioLibraryRowDrag(node('a').querySelector('a')!)).toBe(true);
    await patch({ 'library.archivableRows': ['#a'] });
    expect(isAIStudioLibraryRowDrag(node('a'))).toBe(false);
  });

  it('a renamed account-prefixed archive link hides the same prompt and rejects a different account', async () => {
    history.replaceState(null, '', '/u/1/library');
    document.body.innerHTML =
      '<table><tr class="mat-mdc-row" id="row"><td><a id="link" href="/u/1/prompts/a">Alpha</a></td></tr></table>';
    await patch({ 'library.archivableLink': ['a'] });
    const data = {
      folders: [],
      folderContents: {
        work: [{ conversationId: 'a', title: 'Alpha', url: '/u/1/prompts/a', addedAt: 1 }],
      },
    };
    applyHideArchivedRows(data, true);
    expect(node('row').classList.contains('gv-conversation-archived')).toBe(true);
    expect(readAIStudioLibraryRows(true)[0].anchor).toBe(node('link'));
    (node('link') as HTMLAnchorElement).href = '/u/0/prompts/a';
    expect(readAIStudioLibraryRows(true)[0].anchor).toBeNull();
    (node('link') as HTMLAnchorElement).href = '/u/1/prompts/a';
    node('row').insertAdjacentHTML('beforeend', '<td><a href="/u/1/prompts/b">Other</a></td>');
    expect(readAIStudioLibraryRows(true)[0].anchor).toBeNull();
  });
});

it('remote navigation aliases preserve an existing sidebar, history owner, nav child and prompt click', async () => {
  document.body.innerHTML =
    '<aside class="nav-content v3-left-nav" id="sidebar"><nav id="nav"></nav><section><ms-prompt-history-v3 id="history"><a class="prompt-link" id="prompt" href="/prompts/a">Alpha</a></ms-prompt-history-v3></section></aside><aside id="wrong"><nav id="wrong-nav"></nav><section id="wrong-history"><a id="wrong-prompt" href="/prompts/a">Other</a></section></aside>';
  const click = vi.spyOn(node('prompt'), 'click').mockImplementation(() => {});
  const wrongClick = vi.spyOn(node('wrong-prompt'), 'click').mockImplementation(() => {});
  await patch({
    'navigation.sidebar': ['#wrong'],
    'navigation.navChild': ['#wrong-nav'],
    'navigation.historyRoot': ['#wrong-history'],
    'navigation.promptLink': ['#wrong-prompt'],
  });
  expect(readAIStudioSidebar()).toBe(node('sidebar'));
  expect(readAIStudioHistoryRoot()).toBe(node('history'));
  expect(readAIStudioNavChild(node('sidebar'))).toBe(node('nav'));
  openPromptInApp('a', '/prompts/a');
  expect(click).toHaveBeenCalledTimes(1);
  expect(wrongClick).not.toHaveBeenCalled();
});

it('a remote drag alias cannot replace an existing native prompt row', async () => {
  document.body.innerHTML =
    '<section id="history"><li id="row"><div id="inner"><a href="/prompts/a">Alpha</a></div></li></section></aside>';
  await patch({ 'history.dragHosts': ['#inner'] });
  bindPromptDragSources(node('history'));
  expect(node('row').draggable).toBe(true);
  expect(node('inner').draggable).toBe(false);
});

it('a rejected sidebar repair still notices a later native sidebar mount', async () => {
  await patch({ 'navigation.sidebar': ['.unrelated'] });
  const scope = new PluginScope();
  stops.push(() => scope.dispose());
  activateAIStudioSidebarWidth(scope, { widthPx: 420 });
  document.body.innerHTML = '<div class="nav-content v3-left-nav expanded" id="later"></div>';
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
  expect(node('later').style.width).toBe('420px');
  expect(node('later').querySelector('.gv-sidebar-resize-handle')).not.toBeNull();
});

it.each([
  'role="dialog"',
  'data-gv-layer="preview"',
  'data-gv-component="preview"',
  'data-gv-plugin="preview"',
])('a %s preview cannot supply the Library navigation control', async (owner) => {
  document.body.innerHTML = `<section ${owner}><nav><a class="library" href="/library">Preview</a></nav></section>`;
  await patch({ 'navigation.libraryLink': ['a.library'] });
  const { openLibraryInApp } = await import('@/features/plugins/verbs/folders/aistudio/routes');
  const link = document.querySelector<HTMLAnchorElement>('a')!;
  const click = vi.spyOn(link, 'click').mockImplementation(() => {});
  openLibraryInApp();
  expect(click).not.toHaveBeenCalled();
  document.querySelector('section')!.replaceWith(document.querySelector('nav')!);
  openLibraryInApp();
  expect(click).toHaveBeenCalledTimes(1);
});

it.each(['data-gv-layer', 'data-gv-component', 'data-gv-plugin'])(
  'a %s preview table cannot become an archivable native library',
  async (marker) => {
    document.body.innerHTML = `<section ${marker}="preview"><table><tr class="row" id="row"><td><a href="/prompts/a">Alpha</a></td></tr></table></section>`;
    await patch({ 'library.rows': ['.row'], 'library.archivableRows': ['.row'] });
    expect(getLibraryPromptRows()).toEqual([]);
    expect(isAIStudioLibraryRowDrag(node('row'))).toBe(false);
    document.querySelector('section')!.replaceWith(document.querySelector('table')!);
    expect(getLibraryPromptRows()).toEqual([node('row')]);
    expect(isAIStudioLibraryRowDrag(node('row'))).toBe(true);
  },
);
