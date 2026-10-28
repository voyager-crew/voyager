/* Prompt Manager content module
 * - Injects a floating trigger button using the extension icon
 * - Opens a small anchored panel above the trigger (default)
 * - Panel supports: i18n language switch, add prompt, tag chips, search, copy
 * - Optional lock to pin panel position; when locked, panel is draggable and persisted
 *
 * This file assembles the panel and switches between its two views; each part
 * lives in its own module:
 * - promptTrigger.ts: the ball, its position and visibility, the release-notes announcement
 * - promptPanelChrome.ts: header, search bar, tag strip and footer elements
 * - promptPanelPlacement.ts: anchoring, lock, drag
 * - promptListView.ts: tag filter and prompt rows
 * - savedLibraryView.ts: starred messages and highlights
 * - promptEditForm.ts: add and edit a prompt
 * - promptPreview.ts: the hover card with the rendered prompt (via promptMarkdownLoader.ts)
 * - promptVersionBadge.ts, promptThemeToggle.ts, promptViewModeToggle.ts: header controls
 * - promptPrefs.ts: how panel and trigger preferences are read and written
 * - promptStartup.ts: settings read before mounting, legacy preference migration
 * - promptI18n.ts, promptSettingsButton.ts, promptSupportLink.ts: language, footer links
 */
import browser from 'webextension-polyfill';

import { createStarIcon } from '@/core/icons/folderIcons';
import { logger } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';
import { isVoyagerLayerEvent } from '@/core/ui/layer';
import { createToaster } from '@/core/ui/toast/toaster';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';
import type { PromptSiteAdapter } from '@/features/prompt/PromptSiteAdapter';
import { createRuntimePromptLibraryClient } from '@/features/prompt/library/promptLibraryMessages';
import { initI18n, onCachedLanguageChange } from '@/utils/i18n';

import { onOtherSurfaceOpened } from '../floatingSurfaces';
import { createPromptEditForm } from './promptEditForm';
import { createLanguageSelect, createPromptI18n } from './promptI18n';
import { createPromptLibraryState, readPromptLibrary } from './promptLibraryState';
import { createPromptListView } from './promptListView';
import { installKatexWarningFilter } from './promptMarkdownLoader';
import {
  createPanelFooter,
  createPanelHeader,
  createSearchBar,
  createTagsBar,
} from './promptPanelChrome';
import { createPanelPlacement } from './promptPanelPlacement';
import { readPromptPref, readSyncedChoice, writeSyncedChoice } from './promptPrefs';
import { createPromptPreview } from './promptPreview';
import { createSettingsButton } from './promptSettingsButton';
import { migratePromptPanelPrefs, readPromptStartupSettings } from './promptStartup';
import { createSupportLink } from './promptSupportLink';
import { createThemeToggle } from './promptThemeToggle';
import { mountPromptTrigger } from './promptTrigger';
import { createVersionBadge } from './promptVersionBadge';
import { createViewModeToggle } from './promptViewModeToggle';
import { createSavedLibraryView } from './savedLibraryView';
import { PROMPT_TRIGGER_ELEMENT_ID } from './triggerClearance';

type PMPanelView = 'prompts' | 'starred';

function isPMPanelView(value: unknown): value is PMPanelView {
  return value === 'prompts' || value === 'starred';
}

const STORAGE_KEYS = {
  items: StorageKeys.PROMPT_ITEMS,
  selectedTags: StorageKeys.PROMPT_SELECTED_TAGS,
} as const;

const ID = {
  trigger: PROMPT_TRIGGER_ELEMENT_ID,
  panel: 'gv-pm-panel',
} as const;

const pmLogger = logger.createChild('PromptManager');

function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}

export async function startPromptManager(
  site: PromptSiteAdapter,
): Promise<{ destroy: () => void }> {
  try {
    const startup = await readPromptStartupSettings();
    // Read by the prompt list on every render; the view mode comes from its toggle.
    const listSettings = {
      get viewMode() {
        return viewMode.mode;
      },
      insertOnClick: startup.insertOnClick,
      // Experiment: when on, the row itself takes the drag and its primary action
      // moves to pointerup. Flip it to compare against the handle before choosing.
      rowDrag: startup.rowDrag,
    };

    installKatexWarningFilter();

    await migratePromptPanelPrefs();

    // marked + KaTeX load lazily on the first Markdown render (promptMarkdownLoader.ts).

    // Initialize centralized i18n system
    await initI18n();
    const i18n = createPromptI18n();

    // Prevent duplicate injection
    if (document.getElementById(ID.trigger)) {
      return { destroy: () => {} };
    }

    const trigger = await mountPromptTrigger({
      label: i18n.t('promptManagerOptions'),
      mascotLogo: startup.mascotLogo,
      hiddenByUser: startup.hiddenByUser,
      attention: startup.changelogBadgeActive,
      onAttentionChange: (active) => versionBadge.setAttention(active),
      defaultSpot: (ballHeight) => site.defaultTriggerSpot(ballHeight),
    });

    // Panel root
    const panel = createEl('div', 'gv-pm-panel gv-hidden');
    panel.id = ID.panel;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    document.body.appendChild(panel);

    // Version badge always opens changelog modal
    const versionBadge = createVersionBadge({ t: i18n.t, trigger, beforeOpen: closePanel });
    const themeToggle = createThemeToggle({ panel, t: i18n.t, pageScheme: () => site.scheme() });
    const langSel = createLanguageSelect(i18n, () => refreshUITexts());
    const {
      element: header,
      titleText,
      lockBtn,
      addBtn,
    } = createPanelHeader({
      t: i18n.t,
      titleControls: [themeToggle.element, versionBadge.element],
      langSelect: langSel,
    });
    const { element: searchWrap, input: searchInput, viewModeBtn } = createSearchBar({ t: i18n.t });

    const list = createEl('div', 'gv-pm-list');

    const saved = createSavedLibraryView({
      list,
      t: i18n.t,
      getQuery: () => searchInput.value || '',
      isActive: () => panelView === 'starred',
      setNotice,
      beforeRender: () => preview.hide(),
      highlightPlatform: site.highlightPlatform,
      onBack: () => switchPanelView('prompts'),
      rememberView: () => persistPanelView('starred'),
      onNavigated: closePanel,
    });

    const { outer: tagsWrapOuter, tags: tagsWrap } = createTagsBar();

    const settings = createSettingsButton({ t: i18n.t, setNotice });
    const supportLink = createSupportLink({ t: i18n.t, getLanguage: i18n.get });
    const {
      element: footer,
      backupBtn,
      primaryActions,
      secondaryActions,
    } = createPanelFooter({
      savedFooterActions: saved.footerActions,
      secondary: [settings.element, supportLink.element],
    });

    const toaster = createToaster();

    // State
    let libraryShown = false; // Library changes render once the panel is built.
    const library = createPromptLibraryState({
      read: () => readPromptLibrary(browser.storage.local),
      apply: createRuntimePromptLibraryClient().apply,
      readLegacy: () => localStorage.getItem(STORAGE_KEYS.items),
      changes: browser.storage.onChanged,
      onChanged: () => libraryShown && showLibrary(true),
      onReconcile: () => showLibrary(false),
      onNotLoaded: () => setNotice(i18n.t('pm_library_load_failed'), 'err'),
      onWriteFailed: () => setNotice(i18n.t('pm_save_failed') || "Couldn't save", 'err'),
      onUnavailable: (down) => down && setNotice(i18n.t('pm_library_unavailable'), 'err'),
      onReadFailed: (error) =>
        isExtensionContextInvalidatedError(error) || pmLogger.warn('Prompt read failed', { error }),
    });

    const form = createPromptEditForm({
      t: i18n.t,
      library,
      setNotice,
      onSaved: () => {
        listView.renderTags();
        renderActiveList();
      },
    });

    panel.appendChild(header);
    panel.appendChild(searchWrap);
    panel.appendChild(saved.toolbar);
    panel.appendChild(tagsWrapOuter);
    panel.appendChild(form.element);
    panel.appendChild(list);
    panel.appendChild(footer);

    await library.load();
    let open = false;
    // Restore the tag filter saved in a previous session (#729).
    const savedTags = await readPromptPref<string[]>(STORAGE_KEYS.selectedTags, []);
    const preview = createPromptPreview({ panel, scrollRoot: list });
    const listView = createPromptListView({
      list,
      tagsWrap,
      tagsWrapOuter,
      library,
      preview,
      settings: listSettings,
      savedTags,
      t: i18n.t,
      setNotice,
      insert: site.insert,
      getQuery: () => searchInput.value || '',
      getTheme: () => panel.getAttribute('data-gv-theme') || '',
      onEdit: form.startEdit,
      rerender: renderActiveList,
    });
    const placement = await createPanelPlacement({
      panel,
      anchor: trigger.element,
      lockButton: lockBtn,
      isOpen: () => open,
      t: i18n.t,
    });
    let panelView: PMPanelView = 'prompts';
    let promptSearchValue = '';
    let starredSearchValue = '';

    function setNotice(text: string, kind: 'ok' | 'err' = 'ok') {
      if (!text) {
        toaster.dismiss('notice');
        return;
      }
      toaster.show({
        message: text,
        tone: kind === 'ok' ? 'success' : 'error',
        durationMs: 1800,
        channel: 'notice',
      });
    }

    const viewMode = createViewModeToggle({
      button: viewModeBtn,
      panel,
      t: i18n.t,
      isEnabled: () => panelView === 'prompts',
      onChange: renderActiveList,
    });

    function applyPanelViewUI(): void {
      const isStarredView = panelView === 'starred';
      panel.setAttribute('data-gv-panel-view', panelView);
      titleText.textContent = isStarredView ? i18n.t('pm_starred_library') : 'Voyager';
      backupBtn.replaceChildren(
        createStarIcon(15),
        document.createTextNode(i18n.t('pm_starred_library')),
      );
      backupBtn.title = i18n.t('pm_starred_library');
      backupBtn.setAttribute('aria-label', backupBtn.title);
      searchInput.placeholder = isStarredView
        ? i18n.t('savedLibrarySearchPlaceholder')
        : i18n.t('pm_search_placeholder');
      addBtn.classList.toggle('gv-hidden', isStarredView);
      viewModeBtn.classList.toggle('gv-hidden', isStarredView);
      tagsWrapOuter.classList.toggle('gv-hidden', isStarredView);
      primaryActions.classList.toggle('gv-hidden', isStarredView);
      secondaryActions.classList.toggle('gv-hidden', isStarredView);
      if (isStarredView) {
        listView.closeTransient();
        form.hide();
        preview.hide();
      }
      saved.setActive(isStarredView);
    }

    function renderActiveList(): void {
      if (panelView === 'starred') saved.render();
      else listView.render();
    }

    function persistPanelView(nextView: PMPanelView): Promise<void> {
      return writeSyncedChoice(StorageKeys.PROMPT_PANEL_VIEW, nextView);
    }

    /** Swaps the search text kept per view and shows `nextView`'s chrome; no rendering. */
    function enterPanelView(nextView: PMPanelView): void {
      if (panelView === 'starred') starredSearchValue = searchInput.value || '';
      else promptSearchValue = searchInput.value || '';
      panelView = nextView;
      searchInput.value = panelView === 'starred' ? starredSearchValue : promptSearchValue;
      applyPanelViewUI();
    }

    /** The user switched views: remembered, and always loaded. */
    function switchPanelView(nextView: PMPanelView): void {
      if (panelView === nextView) return;
      enterPanelView(nextView);
      void persistPanelView(nextView);
      if (panelView === 'starred') {
        void saved.load();
      } else {
        listView.renderTags();
        listView.render();
        listView.scheduleTagScrollHint();
      }
    }

    /** The view changed elsewhere (restore, another tab): loads only into an open panel. */
    function followPanelView(nextView: PMPanelView): void {
      enterPanelView(nextView);
      if (panelView === 'starred' && open) void saved.load();
      else renderActiveList();
    }

    // Restore the last Prompt Manager sub-view. This mirrors the compact /
    // comfortable preference so a starred-message navigation does not drop the
    // user back into the prompt list after the Gemini route changes.
    void readSyncedChoice(StorageKeys.PROMPT_PANEL_VIEW, isPMPanelView).then((savedView) => {
      if (savedView && savedView !== panelView) followPanelView(savedView);
    });

    function openPanel(): void {
      open = true;
      void library.retry();
      panel.classList.remove('gv-hidden');
      placement.place();
      listView.scheduleTagScrollHint();
    }

    function closePanel(): void {
      open = false;
      panel.classList.add('gv-hidden');
      saved.closeExportMenu();
      preview.hide();
      listView.closeTransient();
    }

    function refreshUITexts(): void {
      // Keep custom icon + label
      addBtn.textContent = i18n.t('pm_add');
      trigger.element.setAttribute('aria-label', i18n.t('promptManagerOptions'));
      supportLink.applyTexts();
      settings.applyTexts();
      form.applyTexts();
      placement.applyTexts();
      viewMode.applyTexts();
      applyPanelViewUI();
      listView.renderTags();
      renderActiveList();
    }

    // Events
    trigger.enable(() => {
      if (open) closePanel();
      else {
        openPanel();
        if (panelView === 'starred') void saved.load();
        else {
          listView.renderTags();
          listView.render();
        }
      }
    });

    // Handle window resize - constrain trigger and reposition panel. The trigger
    // moves first: an unlocked panel is anchored to where it ends up.
    const onWindowResize = () => {
      trigger.constrain();
      placement.reposition();
      listView.syncTagScrollHint();
    };
    window.addEventListener('resize', onWindowResize, { passive: true });

    // Close when clicking outside of the manager (panel/trigger/confirm are exceptions)
    const onWindowPointerDown = (ev: PointerEvent) => {
      if (!open || isVoyagerLayerEvent(ev)) return;
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      saved.handlePointerDown(target);
      if (target.closest(`#${ID.panel}`)) return;
      if (target.closest(`#${ID.trigger}`)) return;
      // The hover-preview tooltip lives on document.body so users can
      // interact with it (scroll long prompts, select text). Without this
      // exclusion, clicking its scrollbar would be treated as an outside
      // click and close the whole panel.
      if (target.closest('.gv-pm-tooltip')) return;
      // The fill surface also lives on document.body and owns its own dismissal.
      if (target.closest('.gv-pm-fill')) return;
      closePanel();
    };
    window.addEventListener('pointerdown', onWindowPointerDown, { capture: true });
    // A Research Pack opened from the keyboard sends no pointerdown, so it says so itself.
    const stopSurfaceWatch = onOtherSurfaceOpened('prompt-manager', () => {
      if (open) closePanel();
    });

    // Close on Escape
    const onWindowKeyDown = (ev: KeyboardEvent) => {
      if (!open) return;
      if (ev.key !== 'Escape') return;
      if (saved.handleEscape()) return;
      closePanel();
    };
    window.addEventListener('keydown', onWindowKeyDown, { passive: true });

    // The shared i18n system loads a changed language (from this panel, the popup or
    // another tab) before notifying; relabeling on the storage change would read the old one.
    const stopFollowingLanguage = onCachedLanguageChange((language) => {
      langSel.value = language;
      refreshUITexts();
    });
    const storageChangeHandler = (
      changes: Record<string, browser.Storage.StorageChange>,
      area: string,
    ) => {
      // Handle hide prompt manager setting changes
      if (area === 'sync' && changes?.gvHidePromptManager) {
        const shouldHide = changes.gvHidePromptManager.newValue === true;
        pmLogger.info('Hide prompt manager setting changed', { shouldHide });
        if (trigger.setHiddenByUser(shouldHide)) {
          // The trigger is gone, so the panel goes with it
          closePanel();
        }
      }
      if (area === 'sync' && changes[StorageKeys.PROMPT_INSERT_ON_CLICK]) {
        listSettings.insertOnClick = changes[StorageKeys.PROMPT_INSERT_ON_CLICK].newValue === true;
      }
      // Trigger logo and release-notes announcement
      trigger.applyStorageChange(area, changes);
      if (area === 'sync' && changes[StorageKeys.PROMPT_ROW_DRAG]) {
        listSettings.rowDrag = changes[StorageKeys.PROMPT_ROW_DRAG].newValue === true;
        renderActiveList();
      }
      viewMode.applyStorageChange(area, changes);
      if ((area === 'sync' || area === 'local') && changes[StorageKeys.PROMPT_PANEL_VIEW]) {
        const nextView = changes[StorageKeys.PROMPT_PANEL_VIEW].newValue;
        if (isPMPanelView(nextView) && nextView !== panelView) {
          followPanelView(nextView);
        }
      }
      // Stars and highlights shown in the Saved Library
      saved.applyStorageChange(area, changes);
    };

    function showLibrary(changedElsewhere: boolean): void {
      listView.renderTags();
      renderActiveList();
      if (changedElsewhere) setNotice(i18n.t('syncSuccess') || 'Synced', 'ok');
    }

    libraryShown = true;
    try {
      browser.storage.onChanged.addListener(storageChangeHandler);
    } catch {}

    addBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      form.startAdd();
    });

    searchInput.addEventListener('input', () => {
      if (panelView === 'starred') starredSearchValue = searchInput.value || '';
      else promptSearchValue = searchInput.value || '';
      renderActiveList();
    });

    backupBtn.addEventListener('click', () => {
      switchPanelView('starred');
    });

    // Initialize
    refreshUITexts();

    // Return destroy function
    return {
      destroy: () => {
        try {
          window.removeEventListener('resize', onWindowResize);
          window.removeEventListener('pointerdown', onWindowPointerDown, { capture: true });
          stopSurfaceWatch();
          window.removeEventListener('keydown', onWindowKeyDown);
          placement.destroy();
          listView.destroy();
          saved.destroy();
          toaster.destroy();
          themeToggle.destroy();

          chrome.storage?.onChanged?.removeListener(storageChangeHandler);
          stopFollowingLanguage();
          library.dispose();

          // Removes the hover card and its scroll listeners on `list` and `window`.
          // Without this, every re-init (SPA nav / extension reload) would leak
          // an orphan card + listener.
          preview.destroy();

          trigger.destroy();
          panel.remove();
        } catch (e) {
          console.error('[PromptManager] Destroy error:', e);
        }
      },
    };
  } catch (err) {
    try {
      if (isExtensionContextInvalidatedError(err)) {
        return { destroy: () => {} };
      }
      console.error('Prompt Manager init failed', err);
    } catch {}
    return { destroy: () => {} };
  }
}

export default { startPromptManager };
