import { afterEach, describe, expect, it } from 'vitest';

import { DEEPSEEK_IDENTITY } from '@/features/folder/sites/deepseekIdentity';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import {
  normalizeHostCatalogCacheEntry,
  siteAdapterFromEntry,
} from '../../remote/hostCatalogCache';
import { isSameSiteAdapter } from '../../remote/siteOverride';
import { createSectionDom } from '../../verbs/folders/sectionDom';
import { validateSiteAdapterData as readAsV2_0_0 } from '../__fixtures__/v2_0_0SiteAdapterData';
import {
  readSiteAdapterData,
  siteAdapterToData,
  validateSiteAdapterData,
} from '../siteAdapterData';

const SITE = {
  id: 'deepseek',
  label: 'DeepSeek',
  matches: ['https://chat.deepseek.com/*'],
  selectors: { userTurn: '.ds-message.user', composer: 'textarea.ds-scroll-area' },
  theme: { hostSelector: 'body', lightSelector: 'body.light', darkSelector: 'body.dark' },
  brandColor: '#4d6bfe',
  capabilities: ['chat', 'composer', 'darkMode'],
  conversationIdPattern: '^/a/chat/s/([^/?#]+)',
};

const FOLDERS = {
  format: 1,
  sidebar: 'nav[aria-label="Chats"]',
  rows: {
    row: 'a[href^="/a/chat/s/"]',
    title: ['.title', 'span'],
    idSources: [{ attribute: 'data-id', pattern: '^conv-([a-z0-9]+)$', descendants: true }],
    observe: ['aria-current'],
    drag: 'link',
  },
  mount: {
    anchors: [
      { id: 'above-recents', steps: [{ find: 'h3.recents', closest: 'section' }] },
      { id: 'top', steps: [{ find: 'nav[aria-label="Chats"] > div' }] },
    ],
    default: 'above-recents',
    open: 'nav[aria-label="Chats"]:not([hidden])',
  },
  hideFiled: { rows: 'a[href^="/a/chat/s/"]', keepShown: ['[aria-current="page"]'] },
  rowMenu: {
    trigger: 'button[aria-haspopup="menu"]',
    menu: '[role="menu"]',
    item: '[role="menuitem"]',
    open: 'press',
    after: 'end',
    strip: ['id', 'data-state'],
    iconHolder: 'svg',
    rename: { plainItem: 0 },
  },
  page: {
    placeholderTitles: { any: ['DeepSeek'], byLanguage: { 'zh-CN': ['新对话'] } },
    titleSuffix: '\\s+-\\s+DeepSeek$',
    newChat: 'a[href="/"]',
  },
};

function adapterWith(folders: unknown) {
  const result = validateSiteAdapterData({ ...SITE, folders });
  if (!result.success) throw new Error(result.error.map((issue) => issue.path).join(', '));
  return result.data;
}

afterEach(() => document.body.replaceChildren());

describe('site.json folders section', () => {
  it('keeps folder location repairs through publication while using packaged row identity', () => {
    const published = JSON.parse(JSON.stringify(siteAdapterToData(adapterWith(FOLDERS))));
    expect(published.folders).toEqual(FOLDERS);

    const entry = normalizeHostCatalogCacheEntry(
      {
        host: 'chat.deepseek.com',
        status: 'ok',
        manifests: [],
        fetchedAt: 1,
        lastAttemptAt: 1,
        failureCount: 0,
        extensionVersion: '9.9.9',
        site: published,
      },
      'chat.deepseek.com',
    );
    const accepted = siteAdapterFromEntry(entry, '9.9.9')!;
    const bundled = requireBundledSiteAdapter('deepseek');
    document.body.innerHTML =
      '<nav aria-label="Chats"><a href="/a/chat/s/kept" data-id="conv-forged"><span class="title">Kept chat</span></a></nav>';
    const dom = createSectionDom(accepted.folders!, DEEPSEEK_IDENTITY);
    const rows = dom.list(dom.find()!);
    expect(rows.map((row) => ({ id: row.id, title: dom.title(row) }))).toEqual([
      { id: 'kept', title: 'Kept chat' },
    ]);
    expect(accepted.folders?.rows.idSources).toEqual(bundled.folders?.rows.idSources);
    expect(accepted.folders?.rowMenu).toEqual(bundled.folders?.rowMenu);
  });

  it('keeps a section without page rules, as AI Studio, which titles prompts itself, has', () => {
    const { page: _page, ...withoutPage } = FOLDERS;
    const read = readSiteAdapterData({ ...SITE, folders: withoutPage });
    expect(read.sectionIssues).toEqual([]);
    expect(read.result.success && read.result.data.folders).toEqual(withoutPage);
  });

  it.each([
    ['a format this build does not read', { ...FOLDERS, format: 2 }, 'folders.format'],
    ['an unknown key', { ...FOLDERS, storageKey: 'gvFolderData' }, 'folders.storageKey'],
    ['a selector that does not parse', { ...FOLDERS, sidebar: 'nav[' }, 'folders.sidebar'],
    [
      'an unknown drag mode',
      { ...FOLDERS, rows: { ...FOLDERS.rows, drag: 'touch' } },
      'folders.rows.drag',
    ],
    [
      'an id pattern without its one group',
      {
        ...FOLDERS,
        rows: { ...FOLDERS.rows, idSources: [{ attribute: 'data-id', pattern: '^conv-.+$' }] },
      },
      'folders.rows.idSources[0].pattern',
    ],
    [
      'an id pattern that can backtrack',
      {
        ...FOLDERS,
        rows: { ...FOLDERS.rows, idSources: [{ attribute: 'data-id', pattern: '^((a+)+)$' }] },
      },
      'folders.rows.idSources[0].pattern',
    ],
    [
      'a default anchor no anchor names',
      { ...FOLDERS, mount: { ...FOLDERS.mount, default: 'below-gems' } },
      'folders.mount.default',
    ],
    [
      'a menu without its open mode',
      { ...FOLDERS, rowMenu: { ...FOLDERS.rowMenu, open: undefined } },
      'folders.rowMenu.open',
    ],
    ['page rules that are not an object', { ...FOLDERS, page: 'none' }, 'folders.page'],
  ])('drops a section with %s and still applies the site', (_label, folders, path) => {
    const read = readSiteAdapterData({ ...SITE, folders });
    expect(read.result.success).toBe(true);
    if (!read.result.success) return;
    expect(read.result.data.folders).toBeUndefined();
    expect(read.result.data.selectors).toEqual(SITE.selectors);
    expect(read.sectionIssues.map((issue) => issue.path)).toContain(path);
  });

  it('remounts plugins when only the folders section changed', () => {
    const before = adapterWith(FOLDERS);
    const after = adapterWith({ ...FOLDERS, sidebar: 'aside nav' });
    expect(isSameSiteAdapter(before, adapterWith(FOLDERS))).toBe(true);
    expect(isSameSiteAdapter(before, after)).toBe(false);
  });

  it('a v2.0.0 client still applies a published site that carries the section', () => {
    const published = JSON.parse(JSON.stringify(siteAdapterToData(adapterWith(FOLDERS))));
    const old = readAsV2_0_0(published);
    expect(old.success ? [] : old.error).toEqual([]);
    if (!old.success) return;
    expect(old.data.selectors).toEqual(SITE.selectors);
    expect(old.data.conversationIdPattern).toBe(SITE.conversationIdPattern);
  });
});
