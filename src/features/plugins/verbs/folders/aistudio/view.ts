/**
 * AI Studio's folders on screen while the folders plugin runs: the panel in
 * the left nav, the prompt history and its popovers as drag and title sources,
 * /library (its drop zone, archived rows and batch-delete host), and the cloud
 * menu. The data is AI Studio's folder session in core
 * (`AIStudioFolderSession`), which outlives this view: the view attaches to it
 * on start and detaches on `destroy`, which removes all it added.
 */
import browser, { type Storage } from 'webextension-polyfill';

import { createToaster } from '@/core/ui/toast/toaster';
import type { ToastTone } from '@/core/ui/toast/types';
import type { FoldersSection } from '@/features/plugins/sites/sections/foldersData';
import { HideArchivedSetting } from '@/pages/content/folder/aistudioHideArchived';
import { LibraryPage } from '@/pages/content/folder/aistudioLibraryPage';
import { clearArchivedRows, isLibraryPath } from '@/pages/content/folder/aistudioLibraryTable';
import { readAIStudioHistoryRoot } from '@/pages/content/folder/aistudioLocatorReads';
import {
  bindPromptDragSources,
  hasStoredPrompts,
  watchBodyPromptPopovers,
  watchPromptHistory,
} from '@/pages/content/folder/aistudioPromptHistory';
import { currentPromptId, readPromptDragData } from '@/pages/content/folder/aistudioPromptLinks';
import type { TreeActions } from '@/pages/content/folder/floatingTree/shared';
import { createFolderDialogs } from '@/pages/content/folder/folderDialogs';
import { setFolderHeaderDisabled } from '@/pages/content/folder/folderHeader/folderHeader';
import {
  AISTUDIO_NOTICE_MS,
  type AIStudioFolderSession,
  type AIStudioFolderView,
} from '@/pages/content/folder/session/aistudioFolderSession';
import { readCloudTooltip } from '@/pages/content/folder/syncTooltip';
import { watchRouteChanges } from '@/pages/content/utils/routeWatcher';

import { createAccountNoticeDelay, setAccountUnknownNotice } from '../accountNotice';
import type { PanelSection } from '../panelSection';
import { AIStudioTransfer } from './cloud';
import {
  buildFolderPanel,
  insertFolderPanel,
  updateLibraryShortcut,
  waitForPanelAnchor,
  watchPanelMount,
} from './panel';
import { openPromptInApp } from './routes';
import { AISTUDIO_TREE_HOST_CLASS, aistudioTreeActions } from './tree';

/** Where AI Studio's folders read the page, from its site.json `folders` section. */
export interface AIStudioPageDom {
  /** The left nav the panel lives in. */
  readonly nav: string;
  /** Prompt links in the history list and its popovers. */
  readonly links: string;
  /** The body-level popovers the V2 nav lists history in. */
  readonly popovers: string;
}

export function aistudioPageDom(section: FoldersSection): AIStudioPageDom | null {
  if (!section.rows.portaled) return null;
  return { nav: section.sidebar, links: section.rows.row, popovers: section.rows.portaled };
}

export class AIStudioFoldersView implements AIStudioFolderView {
  private readonly toaster = createToaster();
  private readonly notifyTone = (message: string, tone: ToastTone, channel?: string): void => {
    this.toaster.show({ message, tone, durationMs: AISTUDIO_NOTICE_MS[tone], channel });
  };
  readonly transfer: AIStudioTransfer;
  readonly library: LibraryPage;
  private readonly hideArchived: HideArchivedSetting;
  private readonly dialogs = createFolderDialogs();
  /** Aborted by `destroy`: a start-up still waiting for the nav stops there. */
  private readonly lifetime = new AbortController();
  /** The grace before the panel says the account switcher is unreadable. */
  private readonly accountNotice = createAccountNoticeDelay(() => this.render());
  private panel: PanelSection | null = null;
  private historyRoot: HTMLElement | null = null;
  /** Stops for what `initializeFolderUI` started once per mount. */
  private cleanupFns: Array<() => void> = [];
  private stopMountWatch: (() => void) | null = null;
  private stopBodyPopovers: (() => void) | null = null;
  private stopRouteWatcher: (() => void) | null = null;
  private readonly onStorage = (
    changes: Record<string, Storage.StorageChange>,
    areaName: string,
  ): void => {
    if (areaName === 'sync' && this.hideArchived.applyStorageChanges(changes)) {
      this.applyHideArchived();
      this.syncNudge();
    }
  };

  constructor(
    readonly session: AIStudioFolderSession,
    private readonly dom: AIStudioPageDom,
    hideArchived: boolean,
  ) {
    const t = session.translate;
    this.hideArchived = new HideArchivedSetting(hideArchived);
    this.transfer = new AIStudioTransfer({
      t,
      session: () => session.session,
      activation: () => session.activation,
      canEdit: () => session.canEdit,
      data: () => session.data,
      replaceData: (data, prompts, beforeWrite) => session.replaceData(data, prompts, beforeWrite),
      notify: this.notifyTone,
    });
    this.library = new LibraryPage({
      commands: session.commands,
      t,
      canEdit: () => session.canEdit,
      data: () => session.data,
      activation: () => session.activation,
      save: () => session.save(),
      placeDrop: (event, folderId) => this.placeDroppedPrompt(event, folderId),
      applyHideArchived: () => this.applyHideArchived(),
      notify: this.notifyTone,
    });
  }

  /** The panel's container while it is in the nav. */
  get container(): HTMLElement | null {
    return this.panel?.container ?? null;
  }

  /** Attaches to the session and shows the folders. */
  async start(): Promise<void> {
    await this.hideArchived.load();
    if (this.lifetime.signal.aborted) return;
    browser.storage.onChanged.addListener(this.onStorage);
    await this.session.attach(this);
    if (this.lifetime.signal.aborted) return;
    await this.initializeFolderUI();
  }

  /** The plugin's `hideFiledChats` setting changed. */
  setHideArchived(enabled: boolean): void {
    if (!this.hideArchived.setEnabled(enabled)) return;
    this.applyHideArchived();
    this.syncNudge();
  }

  notify(message: string, tone: ToastTone): void {
    this.notifyTone(message, tone);
  }

  /** The previous account's data is gone from view; close everything that held it. */
  releaseAccount(): void {
    this.library.releaseAccount();
    this.dialogs.closeAll();
    this.panel?.reset(this.session.data);
    this.render();
    this.applyHideArchived();
  }

  private async initializeFolderUI(): Promise<void> {
    const isLibraryPage = isLibraryPath();
    const mountSignal = await waitForPanelAnchor(this.dom.nav, this.lifetime.signal);
    if (this.lifetime.signal.aborted) return;
    this.historyRoot = readAIStudioHistoryRoot();
    if (!mountSignal) return;
    document.documentElement.classList.add('gv-aistudio-root');
    await this.session.load();
    if (this.lifetime.signal.aborted) return;
    // The V2 nav has an anchor on every page, /library included.
    this.injectUI();
    this.watchContainerMount();
    if (this.historyRoot) {
      this.cleanupFns.push(
        watchPromptHistory(
          this.historyRoot,
          {
            hasStoredPrompts: () => hasStoredPrompts(this.session.data),
            syncTitles: () => this.syncConversationTitlesFromPromptList(),
            onPromptClick: () => this.highlightActiveConversation(),
          },
          this.dom.links,
        ),
      );
      bindPromptDragSources(this.historyRoot, this.dom.links);
      await this.syncConversationTitlesFromPromptList();
      if (this.lifetime.signal.aborted) return;
    }
    this.stopBodyPopovers ??= watchBodyPromptPopovers(this.dom.popovers, this.dom.links);
    this.highlightActiveConversation();
    this.installRouteChangeListener();
    if (isLibraryPage) this.library.attach();
  }

  /** Re-injects the panel when an Angular rebuild of the nav drops it. */
  private watchContainerMount(): void {
    this.stopMountWatch?.();
    this.stopMountWatch = watchPanelMount(
      this.dom.nav,
      () => !this.container || document.body.contains(this.container),
      () => {
        this.dropPanel();
        try {
          this.injectUI();
        } catch (error) {
          console.error('[AIStudioFolderManager] Failed to re-inject folder panel:', error);
        }
      },
    );
  }

  private injectUI(): void {
    if (this.container && document.body.contains(this.container)) return;
    // A re-inject builds a new panel; the old one, and its tree, go.
    this.dropPanel();
    const panel = buildFolderPanel(
      {
        cloud: {
          upload: () => void this.transfer.upload(),
          sync: () => void this.transfer.sync(),
          tooltip: () => readCloudTooltip('aistudio'),
        },
        onCreateFolder: () => {
          if (this.session.canEdit) this.panel?.startCreateFolder();
        },
      },
      this.historyRoot !== null,
      {
        data: this.session.data,
        actions: this.treeActions(),
        activeConversationId: currentPromptId(),
      },
    );
    if (!insertFolderPanel(panel.container, this.historyRoot, this.dom.nav)) {
      panel.destroy();
      return;
    }
    this.panel = panel;
    this.render();
  }

  private treeActions(): TreeActions {
    return aistudioTreeActions({
      commands: this.session.commands,
      canEdit: () => this.session.canEdit,
      data: () => this.session.data,
      commit: () => void this.session.save().then(() => this.render()),
      onNavigate: ({ conversationId, url }) => {
        if (openPromptInApp(conversationId, url)) {
          setTimeout(() => this.highlightActiveConversation(), 0);
        }
      },
      placeDrop: (event, folderId) => this.placeDroppedPrompt(event, folderId),
      confirmFolderRemoval: this.dialogs.confirmFolderRemoval,
      confirmConversationRemoval: this.dialogs.confirmConversationRemoval,
    });
  }

  /** Removes the panel and its tree; a dropped panel is already out of the page. */
  private dropPanel(): void {
    this.panel?.destroy();
    this.panel = null;
  }

  render(): void {
    const container = this.container;
    if (!container) return;
    const { canEdit } = this.session;
    // An unreadable account switcher is no load in progress: once it stays so, say why the
    // folders are hidden.
    const accountUnknown = this.accountNotice.shown(this.session.accountUnknown);
    container.inert = !canEdit && !accountUnknown;
    container.setAttribute('aria-busy', String(!canEdit && !accountUnknown));
    setFolderHeaderDisabled(container, !canEdit);
    setAccountUnknownNotice(
      container,
      AISTUDIO_TREE_HOST_CLASS,
      accountUnknown ? this.session.translate('folder_account_unknown') : null,
    );
    this.panel?.update(this.session.data);
    this.highlightActiveConversation();
    this.syncNudge();
  }

  private highlightActiveConversation(): void {
    this.panel?.setActiveConversation(currentPromptId());
  }

  /** Moves a dropped prompt into `folderId` (null: Uncategorized); false when it carries none. */
  private placeDroppedPrompt(event: DragEvent, folderId: string | null): boolean {
    const prompt = readPromptDragData(event);
    if (!prompt || prompt.type !== 'conversation' || !prompt.conversationId) return false;
    void this.session.commands.run({
      kind: 'placeAIStudioPrompt',
      prompt: { ...prompt, conversationId: prompt.conversationId },
      target: folderId,
      untitledTitle: this.session.translate('conversation_untitled'),
      at: Date.now(),
    });
    return true;
  }

  /** Native titles reach folders that hold the prompt, unless the user renamed it. */
  async syncConversationTitlesFromPromptList(): Promise<void> {
    if (!this.session.canEdit || !hasStoredPrompts(this.session.data)) return;
    await this.session.commands.run({ kind: 'syncNativeSidebarTitles' });
  }

  /** Re-attaches a panel Angular tore down, and re-arms the watch on a rebuilt nav. */
  private ensureContainerMounted(): void {
    if (this.container && document.body.contains(this.container)) return;
    this.dropPanel();
    try {
      this.injectUI();
    } catch (error) {
      console.error('[AIStudioFolderManager] Failed to ensure folder panel mounted:', error);
    }
    this.watchContainerMount();
  }

  private installRouteChangeListener(): void {
    this.stopRouteWatcher?.();
    this.stopRouteWatcher = watchRouteChanges(
      () => void setTimeout(() => this.handleRouteChange(), 0),
    );
  }

  private handleRouteChange(): void {
    if (this.lifetime.signal.aborted) return;
    this.ensureContainerMounted();
    updateLibraryShortcut(this.container);
    if (isLibraryPath()) this.library.attach();
    else this.library.detach();
    this.highlightActiveConversation();
  }

  applyHideArchived(): void {
    this.hideArchived.applyToLibrary(this.session.data);
  }

  syncNudge(): void {
    if (this.container) this.hideArchived.syncNudge(this.container, this.session.data);
  }

  /** Removes everything this view attached to the page and detaches it from the session. */
  destroy(): void {
    this.accountNotice.stop();
    this.lifetime.abort();
    this.session.detach(this);
    browser.storage.onChanged.removeListener(this.onStorage);
    for (const cleanup of this.cleanupFns.splice(0)) {
      try {
        cleanup();
      } catch {}
    }
    for (const stop of [this.stopMountWatch, this.stopBodyPopovers, this.stopRouteWatcher]) {
      stop?.();
    }
    this.stopMountWatch = this.stopBodyPopovers = this.stopRouteWatcher = null;
    this.library.destroy();
    this.dialogs.closeAll();
    this.toaster.destroy();
    // With the folders off nothing would show the /library rows it hid.
    clearArchivedRows();
    this.dropPanel();
    this.historyRoot = null;
    document.documentElement.classList.remove('gv-aistudio-root');
  }
}
