// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://aistudio.google.com/library" }
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initializeSiteSelectors } from '@/core/selectors';
import { waitForPanelAnchor } from '@/features/plugins/verbs/folders/aistudio/panel';
import { openLibraryInApp } from '@/features/plugins/verbs/folders/aistudio/routes';

import { getLibraryPromptRows, libraryPromptData } from '../aistudioLibraryTable';
import { readAIStudioLibraryTableSelector } from '../aistudioLocatorReads';
import { mountRealAIStudioNavigation } from './realAIStudioNavigationFixture';

const stops: Array<() => void> = [];
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
function table(classes: string) {
  document.body.innerHTML = `<table class="${classes}"><tbody><tr class="row" id="a"><td><a href="/prompts/a">Alpha</a></td></tr><tr class="row" id="b"><td><a href="/prompts/b">Beta</a></td></tr></tbody></table><aside><div class="row" id="fake"><a href="/prompts/fake">Foreign</a></div></aside>`;
}
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  document.body.replaceChildren();
  history.replaceState(null, '', '/library');
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('AI Studio catalog locator operations', () => {
  it('renamed library rows keep the same ordered prompt IDs and titles', async () => {
    table('mat-mdc-table');
    document.querySelectorAll('tr').forEach((row) => row.classList.add('mat-mdc-row'));
    const bundled = getLibraryPromptRows().map((row) => libraryPromptData(row));
    await patch({ 'library.rows': ['table .row'] });
    expect(getLibraryPromptRows().map((row) => libraryPromptData(row))).toEqual(bundled);
    document.querySelectorAll('tr').forEach((row) => row.classList.remove('mat-mdc-row'));
    expect(getLibraryPromptRows().map((row) => libraryPromptData(row)?.conversationId)).toEqual([
      'a',
      'b',
    ]);
    expect(getLibraryPromptRows().map((row) => libraryPromptData(row)?.title)).toEqual([
      'Alpha',
      'Beta',
    ]);
  });

  it('a partial row patch keeps both bundled prompts rather than hiding a folder’s second chat', async () => {
    table('mat-mdc-table');
    document.querySelectorAll('tr').forEach((row) => row.classList.add('mat-mdc-row'));
    await patch({ 'library.rows': ['#a'] });
    expect(getLibraryPromptRows().map((row) => libraryPromptData(row)?.conversationId)).toEqual([
      'a',
      'b',
    ]);
  });

  it('a foreign row cannot enter a repaired library read', async () => {
    table('renamed-table');
    await patch({ 'library.rows': ['.row'] });
    expect(getLibraryPromptRows()).toEqual([]);
    await patch({ 'library.rows': ['table .row'] });
    expect(getLibraryPromptRows().map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('a repaired table is independently identified and an unrelated table falls back', async () => {
    table('renamed-table');
    document.body.insertAdjacentHTML(
      'beforeend',
      '<table class="unrelated"><tr><td>Other</td></tr></table>',
    );
    await patch({ 'library.table': ['.renamed-table'] });
    expect(document.querySelector(readAIStudioLibraryTableSelector())).toBe(
      document.querySelector('.renamed-table'),
    );
    await patch({ 'library.table': ['.unrelated'] });
    expect(readAIStudioLibraryTableSelector()).toBe('table.mat-mdc-table, mat-table');
  });

  it('a renamed Library control navigates only to the independently verified library URL', async () => {
    history.replaceState(null, '', '/u/1/library');
    const { navigation } = mountRealAIStudioNavigation();
    navigation.innerHTML =
      '<a id="library" href="/u/1/library">Library</a><a id="wrong" href="/u/1/prompts/other">Other</a>';
    const library = document.getElementById('library')!;
    const wrong = document.getElementById('wrong')!;
    const clickLibrary = vi.spyOn(library, 'click').mockImplementation(() => {});
    const clickWrong = vi.spyOn(wrong, 'click').mockImplementation(() => {});
    await patch({ 'navigation.libraryLink': ['#library'] });
    openLibraryInApp();
    expect(clickLibrary).toHaveBeenCalledTimes(1);
    await patch({ 'navigation.libraryLink': ['#wrong'] });
    history.replaceState(null, '', '/u/1/prompts/current');
    openLibraryInApp();
    expect(location.pathname).toBe('/u/1/library');
    expect(clickWrong).not.toHaveBeenCalled();
  });

  it('a remote Library alias cannot navigate from account 1 to account 0', async () => {
    history.replaceState(null, '', '/u/1/prompts/current');
    const { navigation } = mountRealAIStudioNavigation();
    navigation.innerHTML = '<a id="library" href="/u/0/library">Library</a>';
    const link = document.getElementById('library') as HTMLAnchorElement;
    const click = vi.spyOn(link, 'click').mockImplementation(() => {});
    await patch({ 'navigation.libraryLink': ['#library'] });
    openLibraryInApp();
    expect(location.pathname).toBe('/u/1/library');
    expect(click).not.toHaveBeenCalled();
    link.href = '/u/1/library';
    openLibraryInApp();
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('turning folders off retires an anchor wait before the renamed history mounts', async () => {
    const controller = new AbortController();
    const pending = waitForPanelAnchor('.nav-content.v3-left-nav', controller.signal);
    controller.abort();
    document.body.innerHTML =
      '<div class="nav-content v3-left-nav"><ms-prompt-history-v3 id="history"><a href="/prompts/a">Alpha</a></ms-prompt-history-v3></div>';
    expect(await pending).toBeNull();
    expect(await waitForPanelAnchor('.nav-content.v3-left-nav', new AbortController().signal)).toBe(
      document.getElementById('history'),
    );
  });
});
