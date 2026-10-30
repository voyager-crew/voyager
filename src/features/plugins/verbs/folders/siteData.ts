/**
 * A site's folders put together from data: where things are comes from the
 * `folders` section of its `site.json`, and everything that decides what is
 * written (bucket, keys, policy, file format, guide id, texts) from its row in
 * the core folder table (`features/folder/sites/folderSiteTable.ts`). A site
 * with no row, one not keyed by its route alone, or a page the bundled
 * extension does not give that site, gets no folders here.
 */
import type { ConversationReference } from '@/core/types/folder';
import { folderSiteForPage } from '@/features/folder/sites/folderSiteTable';
import { routeFolderSiteOf } from '@/features/folder/sites/routeFolderSites';
import {
  openSiteConversation,
  pageTitle,
  readSiteConversation,
} from '@/features/folder/sites/sitePage';
import { PluginSiteFolderStore, createPluginSiteCommands } from '@/features/folder/sites/siteStore';
import { isEphemeralChat } from '@/features/plugins/sends/trackUserSends';
import type {
  FoldersPlaceholderTitles,
  FoldersSection,
} from '@/features/plugins/sites/sections/foldersData';
import type { SiteAdapter } from '@/features/plugins/types';

import { createRowMenu } from './rowMenu';
import { createRowRename } from './rowRename';
import { siteSectionCss } from './sectionCss';
import { createSectionDom } from './sectionDom';
import type { HideFiledDom, SiteFoldersAdapter } from './types';

/** Ids a hidden row may carry; anything else is never trusted. */
const ROW_ID = /^[A-Za-z0-9_-]+$/;

function hideFiledDom(section: FoldersSection, site: string): HideFiledDom {
  const attribute = `data-gv-${site}-filed`;
  const rows = section.hideFiled?.rows ?? section.rows.row;
  // A row holding focus (the site's own rename field) and the rows the site keeps shown stay.
  const kept = (section.hideFiled?.keepShown ?? []).map((selector) => `:not(${selector})`).join('');
  return {
    rowSelector: rows,
    filedAttribute: attribute,
    styleAttribute: `data-gv-${site}-hide-filed`,
    // `:is()` keeps a selector list's every branch under the conditions, not only its last.
    css: `:is(${rows})[${attribute}]${kept}:not(:focus-within) { display: none !important; }`,
    idPattern: ROW_ID,
  };
}

/**
 * Whether `title` is one the site shows before it names a conversation: any of
 * `any`, or one of the page's UI language (its full tag, then its primary
 * subtag, else `fallbackLanguage`). Only the page's own language counts: a chat
 * on an English page may really be titled "新聊天", and keeps that title.
 */
function placeholderCheck(
  titles: FoldersPlaceholderTitles,
  doc: Document,
): (title: string) => boolean {
  const any = new Set(titles.any ?? []);
  const byLanguage = new Map(
    Object.entries(titles.byLanguage ?? {}).map(([tag, list]) => [tag.toLowerCase(), list]),
  );
  const fallback = titles.fallbackLanguage?.toLowerCase();
  const ofPage = (): readonly string[] => {
    const tag = doc.documentElement.lang.trim().toLowerCase().replace(/_/g, '-');
    return (
      byLanguage.get(tag) ??
      byLanguage.get(tag.split('-')[0]) ??
      (fallback ? byLanguage.get(fallback) : undefined) ??
      []
    );
  };
  return (title) => any.has(title) || (byLanguage.size > 0 && ofPage().includes(title));
}

/**
 * The site's folders from its `site.json` and the core table on the page at
 * `pageUrl`, or `null` where the site has none or the bundled data does not
 * give that page the site's bucket.
 */
export function siteFoldersFromData(
  adapter: SiteAdapter | null,
  pageUrl: string = location.href,
): SiteFoldersAdapter | null {
  const section = adapter?.folders;
  const row = adapter ? folderSiteForPage(adapter.id, pageUrl) : null;
  const route = row ? routeFolderSiteOf(row.site) : null;
  const panel = row?.prefs.keys.panel;
  const sectionPrefs = row?.prefs.keys.section;
  const page = section?.page;
  if (!section || !page || !row?.messages || !route || !panel || !sectionPrefs) {
    return null;
  }
  const { identity, transfer, overrides } = route;
  const { site, policy, config, messages } = row;
  const dom = createSectionDom(section, identity);
  const suffix = page.titleSuffix ? new RegExp(page.titleSuffix) : null;
  const isPlaceholderTitle = placeholderCheck(page.placeholderTitles, document);
  /** The open conversation's title from the tab, which without the site's suffix is the site's own page. */
  const tabTitle = (): string | null => {
    if (!suffix) return pageTitle(document, /$^/, isPlaceholderTitle);
    return suffix.test(document.title) ? pageTitle(document, suffix, isPlaceholderTitle) : null;
  };
  const hideFiled = hideFiledDom(section, site);
  const { rowMenu } = section;
  const entryAttribute = `data-gv-${site}-move-to-folder`;
  const className = `gv-${site}-folder-section`;
  const conversationHref = (conversation: ConversationReference): string =>
    identity.read(conversation.url)?.url ?? '';
  /** The title the site shows for open conversation `id`: its sidebar row, else the tab title. */
  const shownTitle = (id: string): string | null => {
    const link = dom.link(id);
    const shown = link ? dom.title({ id, path: '', link }) : '';
    if (shown && !isPlaceholderTitle(shown)) return shown;
    return tabTitle();
  };

  return {
    key: `${site}-folders`,
    platform: site,
    policy,
    rootBucketId: config.rootBucketId,
    createFolders: (notify) => {
      const store = new PluginSiteFolderStore(config, identity.bareId, undefined, notify);
      const commands = createPluginSiteCommands({
        store,
        policy,
        importInto: transfer.importInto,
        overrides,
        readConversation: identity.read,
      });
      return { store, commands };
    },
    prefsKeys: { panel, section: sectionPrefs },
    identity: {
      storedId: (id) => `${identity.prefix}${id}`,
      bareId: identity.bareId,
      conversationIdOf: (href) => identity.read(href)?.conversationId ?? null,
      href: conversationHref,
    },
    page: {
      // A chat the site keeps nowhere (ChatGPT's temporary chats) is never filed.
      current: (untitled) =>
        isEphemeralChat(site) ? null : readSiteConversation(identity, shownTitle, untitled),
      open: (conversation) =>
        void openSiteConversation(identity, (id) => dom.link(id), conversation),
      isPlaceholderTitle,
    },
    sidebar: {
      find: dom.find,
      list: dom.list,
      title: dom.title,
      // Rows and their text are watched anyway; the section names any attribute that matters too.
      observedAttributes: ['href', hideFiled.filedAttribute, ...(section.rows.observe ?? [])],
    },
    section: {
      className,
      css: siteSectionCss(className, adapter?.folderSkin),
      anchor: dom.anchor,
      conversationHref,
      policy,
      tree: row.tree,
    },
    hideFiled,
    guide: row.guideId
      ? {
          id: row.guideId,
          debugEvent: `gv:debug:${site}FoldersCoachmark`,
          titleKey: messages.guideTitle,
          bodyKey: messages.guideBody,
          ...(section.transientSidebar ? { transientSidebar: section.transientSidebar } : {}),
        }
      : null,
    messages,
    transfer: { export: transfer.export, filename: () => transfer.filename() },
    native: {
      rowAt: (target) => dom.rowAt(target),
      ...(rowMenu
        ? {
            createMoveMenu: (options) =>
              createRowMenu(
                rowMenu,
                { dom, entryAttribute, storedId: (id) => `${identity.prefix}${id}` },
                options,
              ),
          }
        : {}),
      ...(rowMenu?.rename
        ? { rename: createRowRename(rowMenu, rowMenu.rename.plainItem, { dom, entryAttribute }) }
        : {}),
    },
  };
}
