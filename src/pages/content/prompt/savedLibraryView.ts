/**
 * The Saved Library view of the Prompt Manager: starred messages and the
 * current account's highlights in one list, with a filter toolbar, a footer
 * that leads back to the prompts and exports highlights, and per-row removal.
 *
 * Highlights belong to an account, so every highlight request resolves the
 * account of the current page first and goes through the background.
 */
import browser from 'webextension-polyfill';

import { createChevronDownIcon, createStarIcon } from '@/core/icons/folderIcons';
import {
  createArrowLeftIcon,
  createBracesIcon,
  createDownloadIcon,
  createFileTextIcon,
} from '@/core/icons/promptManagerIcons';
import {
  accountIsolationService,
  detectAccountContextFromDocument,
} from '@/core/services/AccountIsolationService';
import { logger } from '@/core/services/LoggerService';
import {
  type HighlightAccountScope,
  type HighlightPlatform,
  type HighlightRecordV1,
  getHighlightColorHex,
} from '@/core/types/highlight';
import { StarredMessagesService } from '@/features/savedLibrary/StarredMessagesService';
import {
  type SavedLibraryFilter,
  type SavedLibraryItem,
  buildSavedLibraryItemUrl,
  filterSavedLibraryItems,
  toSavedLibraryItems,
} from '@/features/savedLibrary/model';
import { openLibraryPage } from '@/features/savedLibrary/openLibraryPage';
import { savedLibraryEmptyKey } from '@/features/savedLibrary/presentation';
import type { StarredMessage } from '@/features/savedLibrary/starTypes';
import { ALL_FILTER } from '@/features/savedLibrary/viewModel';
import type { TranslationKey } from '@/utils/translations';

import { downloadPromptFile } from './promptDownload';
import { formatStarredMessageTime } from './starredLibrary';

const EXPORT_WRAP_CLASS = 'gv-pm-saved-export-wrap';

export interface SavedLibraryView {
  /** The filter toolbar, shown only while this view is active. */
  readonly toolbar: HTMLElement;
  /** The footer actions (back to prompts, export), shown only while this view is active. */
  readonly footerActions: HTMLElement;
  /** Shows or hides this view's toolbar and footer, and refreshes their labels. */
  setActive: (active: boolean) => void;
  /** Reloads stars and highlights, rendering a loading state meanwhile. */
  load: () => Promise<void>;
  /** Renders what is loaded into the list, filtered by the current query. */
  render: () => void;
  /** Closes the export menu. */
  closeExportMenu: () => void;
  /** A pointer went down somewhere on the page: closes the export menu unless it was inside it. */
  handlePointerDown: (target: HTMLElement) => void;
  /** Escape closes an open export menu first. True when it did, and the key is spent. */
  handleEscape: () => boolean;
  /** Reloads when stars or highlights changed in storage while this view is active. */
  applyStorageChange: (area: string, changes: Record<string, unknown>) => void;
  destroy: () => void;
}

export interface SavedLibraryViewOptions {
  list: HTMLElement;
  t: (key: TranslationKey) => string;
  getQuery: () => string;
  isActive: () => boolean;
  setNotice: (text: string, kind: 'ok' | 'err') => void;
  /** Called before every render, which rebuilds the shared list. */
  beforeRender: () => void;
  /** The back button. */
  onBack: () => void;
  /** Called before following a saved item, so returning reopens this view. */
  rememberView: () => Promise<void>;
  /** Called after following a saved item. */
  onNavigated: () => void;
  /** Whose highlights this page lists, exports and removes. */
  highlightPlatform: HighlightPlatform;
}

export function createSavedLibraryView({
  list,
  t,
  getQuery,
  isActive,
  setNotice,
  beforeRender,
  onBack,
  rememberView,
  onNavigated,
  highlightPlatform,
}: SavedLibraryViewOptions): SavedLibraryView {
  let starredMessages: StarredMessage[] = [];
  let highlightRecords: HighlightRecordV1[] = [];
  let filter: SavedLibraryFilter = ALL_FILTER;
  let loading = false;
  let loadError = false;
  let exportMenuOpen = false;
  const downloadLifetime = new AbortController();

  const toolbar = createEl('div', 'gv-pm-saved-toolbar gv-hidden');
  const filterGroup = createEl('div', 'gv-pm-saved-filters');
  filterGroup.setAttribute('role', 'group');
  const filterButtons = new Map<SavedLibraryFilter, HTMLButtonElement>();
  for (const value of [ALL_FILTER, 'starred', 'highlights'] as const) {
    const button = createEl('button', 'gv-pm-saved-filter');
    button.setAttribute('type', 'button');
    button.addEventListener('click', () => {
      filter = value;
      applyTexts();
      render();
    });
    filterButtons.set(value, button);
    filterGroup.appendChild(button);
  }
  toolbar.appendChild(filterGroup);
  const openFullButton = createEl('button', 'gv-pm-saved-footer-button gv-pm-saved-open-full');
  openFullButton.type = 'button';
  openFullButton.addEventListener('click', () => {
    void openLibraryPage().catch(() => setNotice(t('savedLibraryOpenFailed'), 'err'));
  });
  toolbar.appendChild(openFullButton);

  // The view keeps its two top-level actions in the footer. Export formats
  // are disclosed only after the user asks to export.
  const footerActions = createEl('div', 'gv-pm-saved-footer-actions gv-hidden');
  const backBtn = createEl('button', 'gv-pm-saved-footer-button gv-pm-saved-footer-primary');
  backBtn.setAttribute('type', 'button');
  const backLabel = createEl('span', 'gv-pm-saved-footer-label');
  backBtn.append(createArrowLeftIcon(15), backLabel);

  const exportWrap = createEl('div', EXPORT_WRAP_CLASS);
  const exportTrigger = createEl('button', 'gv-pm-saved-footer-button gv-pm-saved-export-trigger');
  exportTrigger.setAttribute('type', 'button');
  exportTrigger.setAttribute('aria-haspopup', 'menu');
  exportTrigger.setAttribute('aria-expanded', 'false');
  const exportLabel = createEl('span', 'gv-pm-saved-footer-label');
  exportTrigger.append(createDownloadIcon(15), exportLabel, createChevronDownIcon(14));

  const exportMenu = createEl('div', 'gv-pm-saved-export-menu gv-hidden');
  exportMenu.setAttribute('role', 'menu');
  const exportJsonBtn = createEl('button', 'gv-pm-saved-export-option');
  exportJsonBtn.setAttribute('type', 'button');
  exportJsonBtn.setAttribute('role', 'menuitem');
  exportJsonBtn.append(createBracesIcon(15), document.createTextNode('JSON'));
  const exportMarkdownBtn = createEl('button', 'gv-pm-saved-export-option');
  exportMarkdownBtn.setAttribute('type', 'button');
  exportMarkdownBtn.setAttribute('role', 'menuitem');
  exportMarkdownBtn.append(createFileTextIcon(15), document.createTextNode('Markdown'));
  exportMenu.append(exportJsonBtn, exportMarkdownBtn);
  exportWrap.append(exportTrigger, exportMenu);
  footerActions.append(backBtn, exportWrap);

  function applyTexts(): void {
    openFullButton.textContent = t('savedLibraryOpenFull');
    const labels: Record<SavedLibraryFilter, TranslationKey> = {
      all: 'savedLibraryAll',
      starred: 'savedLibraryStars',
      highlights: 'savedLibraryHighlights',
    };
    filterButtons.forEach((button, value) => {
      button.textContent = t(labels[value]);
      button.classList.toggle('active', value === filter);
      button.setAttribute('aria-pressed', value === filter ? 'true' : 'false');
    });
    filterGroup.setAttribute('aria-label', t('savedLibraryTypeFilter'));
    exportJsonBtn.title = `${t('pm_export')} JSON`;
    exportJsonBtn.setAttribute('aria-label', exportJsonBtn.title);
    exportMarkdownBtn.title = `${t('pm_export')} Markdown`;
    exportMarkdownBtn.setAttribute('aria-label', exportMarkdownBtn.title);
    backLabel.textContent = t('pm_open_prompt_manager');
    backBtn.title = t('pm_open_prompt_manager');
    backBtn.setAttribute('aria-label', backBtn.title);
    exportLabel.textContent = t('pm_export_format');
    exportTrigger.title = t('pm_export_format');
    exportTrigger.setAttribute('aria-label', exportTrigger.title);
    exportMenu.setAttribute('aria-label', t('pm_export_format'));
  }

  function setExportMenuOpen(nextOpen: boolean, focusFirst = false): void {
    exportMenuOpen = nextOpen && isActive();
    exportMenu.classList.toggle('gv-hidden', !exportMenuOpen);
    exportTrigger.setAttribute('aria-expanded', exportMenuOpen ? 'true' : 'false');
    exportWrap.classList.toggle('gv-pm-saved-export-open', exportMenuOpen);
    if (exportMenuOpen && focusFirst) {
      exportJsonBtn.focus();
    }
  }

  async function load(): Promise<void> {
    loading = true;
    loadError = false;
    render();
    try {
      [starredMessages, highlightRecords] = await Promise.all([
        StarredMessagesService.getAllStarredMessagesSorted(),
        loadCurrentAccountHighlightRecords(highlightPlatform),
      ]);
    } catch (error) {
      console.warn('[PromptManager] Failed to load saved library:', error);
      loadError = true;
      starredMessages = [];
      highlightRecords = [];
      setNotice(t('pm_starred_load_error'), 'err');
    } finally {
      loading = false;
      render();
    }
  }

  async function exportHighlights(format: 'json' | 'markdown'): Promise<void> {
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'gv.highlight.export',
        payload: { format, scope: await resolveCurrentHighlightScope(highlightPlatform) },
      })) as { ok?: boolean; data?: string; filename?: string; error?: string } | undefined;
      if (!response?.ok || typeof response.data !== 'string') {
        throw new Error(response?.error || 'Highlight export failed');
      }
      downloadPromptFile(
        response.data,
        response.filename || `gemini-voyager-highlights.${format === 'json' ? 'json' : 'md'}`,
        format === 'json' ? 'application/json' : 'text/markdown',
        downloadLifetime.signal,
      );
    } catch (error) {
      logger.warn('[PromptManager] Failed to export highlights', { error: String(error) });
      setNotice(t('promptExportError'), 'err');
    }
  }

  function render(): void {
    beforeRender();
    const savedScrollTop = list.scrollTop;
    const query = getQuery().trim();
    const filtered = filterSavedLibraryItems(
      toSavedLibraryItems(starredMessages, highlightRecords),
      filter,
      query,
    );
    list.innerHTML = '';

    if (loading) {
      const placeholder = createEl('div', 'gv-pm-empty gv-pm-starred-empty');
      placeholder.textContent = t('loading') || 'Loading...';
      list.appendChild(placeholder);
      return;
    }

    if (loadError || filtered.length === 0) {
      const empty = createEl('div', 'gv-pm-empty gv-pm-starred-empty');
      empty.textContent = t(
        loadError ? 'pm_starred_load_error' : savedLibraryEmptyKey(filter, query),
      );
      list.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    for (const item of filtered) {
      frag.appendChild(renderRow(item));
    }
    list.appendChild(frag);
    const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
    list.scrollTop = Math.min(savedScrollTop, maxScroll);
  }

  function renderRow(item: SavedLibraryItem): HTMLElement {
    const row = createEl('button', 'gv-pm-starred-item');
    row.setAttribute('type', 'button');
    row.setAttribute('dir', 'auto');
    row.title = t('pm_starred_open');
    row.addEventListener('click', (event) => {
      event.preventDefault();
      void (async () => {
        await rememberView();
        if (navigateToSavedLibraryItem(item)) onNavigated();
      })();
    });

    const icon = createEl('span', 'gv-pm-starred-icon');
    if (item.kind === 'starred') icon.appendChild(createStarIcon(16, true));
    icon.classList.toggle('gv-pm-highlight-icon', item.kind === 'highlight');
    if (item.kind === 'highlight') {
      icon.setAttribute('data-highlight-color', item.color || 'yellow');
      icon.style.backgroundColor = getHighlightColorHex(item.color || 'yellow');
    }
    icon.setAttribute('aria-hidden', 'true');

    const body = createEl('span', 'gv-pm-starred-body');
    const title = createEl('span', 'gv-pm-starred-title');
    title.textContent =
      (item.conversationTitle && item.conversationTitle.trim()) || t('pm_starred_untitled');
    const content = createEl('span', 'gv-pm-starred-content');
    content.textContent = item.content || '';
    let note: HTMLSpanElement | null = null;
    if (item.note) {
      note = createEl('span', 'gv-pm-highlight-note');
      note.textContent = item.note;
    }
    const meta = createEl('span', 'gv-pm-starred-meta');
    meta.textContent = `${
      item.kind === 'starred' ? t('savedLibraryStars') : t('savedLibraryHighlights')
    } · ${formatStarredMessageTime(item.savedAt)}`;
    body.appendChild(title);
    body.appendChild(content);
    if (note) body.appendChild(note);
    body.appendChild(meta);

    const removeBtn = createEl('button', 'gv-pm-starred-remove');
    removeBtn.setAttribute('type', 'button');
    const removeLabel = item.kind === 'starred' ? t('removeFromStarred') : t('pm_delete');
    removeBtn.title = removeLabel;
    removeBtn.setAttribute('aria-label', removeLabel);
    removeBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      let removed: boolean;
      try {
        removed =
          item.kind === 'starred'
            ? await StarredMessagesService.removeStarredMessage(
                item.conversationId,
                item.turnId,
              ).then(() => true)
            : await removeStoredHighlight(item, highlightPlatform);
      } catch {
        // Keep the saved row until its removal has actually reached storage.
        setNotice(
          t(item.kind === 'starred' ? 'starredDeleteFailed' : 'highlightDeleteFailed'),
          'err',
        );
        return;
      }
      if (!removed) {
        setNotice(t('highlightDeleteFailed'), 'err');
        return;
      }
      if (item.kind === 'starred') {
        starredMessages = starredMessages.filter(
          (message) =>
            message.conversationId !== item.conversationId || message.turnId !== item.turnId,
        );
      } else {
        highlightRecords = highlightRecords.filter((record) => record.id !== item.id);
      }
      render();
      setNotice(t('pm_deleted') || 'Deleted', 'ok');
    });

    row.appendChild(icon);
    row.appendChild(body);
    row.appendChild(removeBtn);
    return row;
  }

  backBtn.addEventListener('click', () => onBack());
  exportTrigger.addEventListener('click', (event) => {
    const nextOpen = !exportMenuOpen;
    setExportMenuOpen(nextOpen, nextOpen && event.detail === 0);
  });
  exportMenu.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const options = [exportJsonBtn, exportMarkdownBtn];
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    options[(currentIndex + direction + options.length) % options.length].focus();
  });
  exportJsonBtn.addEventListener('click', () => {
    setExportMenuOpen(false);
    void exportHighlights('json');
  });
  exportMarkdownBtn.addEventListener('click', () => {
    setExportMenuOpen(false);
    void exportHighlights('markdown');
  });

  return {
    toolbar,
    footerActions,
    setActive: (active) => {
      toolbar.classList.toggle('gv-hidden', !active);
      footerActions.classList.toggle('gv-hidden', !active);
      if (!active) setExportMenuOpen(false);
      applyTexts();
    },
    load,
    render,
    closeExportMenu: () => setExportMenuOpen(false),
    handlePointerDown: (target) => {
      if (exportMenuOpen && !target.closest(`.${EXPORT_WRAP_CLASS}`)) {
        setExportMenuOpen(false);
      }
    },
    handleEscape: () => {
      if (!exportMenuOpen) return false;
      setExportMenuOpen(false);
      exportTrigger.focus();
      return true;
    },
    applyStorageChange: (area, changes) => {
      if (
        area === 'local' &&
        (StarredMessagesService.decodeStorageChange(area, changes) !== undefined ||
          Object.keys(changes).some((key) => key.startsWith('gvAnnotation:'))) &&
        isActive()
      ) {
        void load();
      }
    },
    destroy: () => downloadLifetime.abort(),
  };
}

async function resolveCurrentHighlightScope(
  platform: HighlightPlatform,
): Promise<HighlightAccountScope> {
  const context = detectAccountContextFromDocument(window.location.href, document);
  const resolved = await accountIsolationService.resolveAccountScope({
    pageUrl: window.location.href,
    routeUserId: context.routeUserId,
    email: context.email,
  });
  return {
    platform,
    accountKey: resolved.accountKey,
    accountId: resolved.accountId,
    routeUserId: resolved.routeUserId,
  };
}

async function loadCurrentAccountHighlightRecords(
  platform: HighlightPlatform,
): Promise<HighlightRecordV1[]> {
  try {
    const scope = await resolveCurrentHighlightScope(platform);
    const response = (await browser.runtime.sendMessage({
      type: 'gv.highlight.list',
      payload: { scope, includeDeleted: false },
    })) as { ok?: boolean; records?: HighlightRecordV1[]; error?: string } | undefined;
    if (!response?.ok) throw new Error(response?.error || 'Failed to load highlights');
    return Array.isArray(response.records) ? response.records : [];
  } catch (error) {
    logger.warn('[PromptManager] Failed to load highlights', { error: String(error) });
    throw error;
  }
}

async function removeStoredHighlight(
  item: SavedLibraryItem,
  platform: HighlightPlatform,
): Promise<boolean> {
  if (item.kind !== 'highlight' || !item.accountHash || !item.platform) return false;
  try {
    const scope = await resolveCurrentHighlightScope(platform);
    const response = (await browser.runtime.sendMessage({
      type: 'gv.highlight.delete',
      payload: {
        scope,
        conversationId: item.conversationId,
        id: item.id,
      },
    })) as { ok?: boolean } | undefined;
    return response?.ok === true;
  } catch (error) {
    logger.warn('[PromptManager] Failed to remove highlight', { error: String(error) });
    return false;
  }
}

/**
 * Follows a saved item. A same-origin item is opened through the History API
 * and a popstate the host router listens to, so the live session survives;
 * anything else opens in a new tab.
 */
function navigateToSavedLibraryItem(item: SavedLibraryItem): boolean {
  let target: URL;
  try {
    target = new URL(buildSavedLibraryItemUrl(item), window.location.href);
  } catch (error) {
    logger.warn('[PromptManager] Blocked invalid saved item URL', { error: String(error) });
    return false;
  }
  if (target.origin !== window.location.origin) {
    window.open(target.href, '_blank', 'noopener,noreferrer');
    return true;
  }

  window.history.pushState(
    window.history.state,
    '',
    `${target.pathname}${target.search}${target.hash}`,
  );
  window.dispatchEvent(
    typeof PopStateEvent === 'function'
      ? new PopStateEvent('popstate', { state: window.history.state })
      : new Event('popstate'),
  );
  return true;
}

function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}
