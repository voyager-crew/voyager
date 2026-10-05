/**
 * ChatGPT folders on the shared folder core: a folder section in ChatGPT's
 * sidebar (introduced once by a guide), the shared floating panel, and "Move to
 * folder" in a row's menu, or a row dragged onto a folder. The store is the
 * shared FolderRepository with ChatGPT's own bucket. Everything this plugin
 * creates is registered on its PluginScope, so turning it off leaves nothing behind.
 */
import { DOWNLOAD_PATH, UPLOAD_PATH } from '@/core/icons/transferPaths';
import type { ConversationReference } from '@/core/types/folder';
import { createToaster } from '@/core/ui/toast/toaster';
import type { ToastTone } from '@/core/ui/toast/types';
import type { EditOutcome, FolderCommands } from '@/features/folder/commands/folderCommands';
import { type AddVia, FOLDER_SITE_POLICIES } from '@/features/folder/owner/folderOwnerPolicy';
import { FolderImportExportService } from '@/features/folder/services/FolderImportExportService';
import type { PluginScope } from '@/features/plugins/runtime/pluginScope';
import type { PluginSettings, SiteAdapter } from '@/features/plugins/types';
import { FolderSelection } from '@/pages/content/folder/FolderSelection';
import { createCommandTreeActions } from '@/pages/content/folder/commandTreeActions';
import { mountFloatingFab, unmountFloatingFab } from '@/pages/content/folder/floatingModeFab';
import { type FloatingPanelHandle, mountFloatingPanel } from '@/pages/content/folder/floatingPanel';
import {
  DROP_FOLDER_ATTR,
  DROP_TARGET_CLASS,
  type FolderDropTarget,
} from '@/pages/content/folder/floatingTree/dropTargets';
import type { TreeActions } from '@/pages/content/folder/floatingTree/shared';
import { createFolderDialogs } from '@/pages/content/folder/folderDialogs';
import {
  type SidebarDropContext,
  acceptsSidebarDrag,
  bindRootDropZone,
  dropOnSidebar,
} from '@/pages/content/folder/sidebarDrops';
import { readSyncTooltip } from '@/pages/content/folder/syncTooltip';
import { watchRouteChanges } from '@/pages/content/utils/routeWatcher';
import { getTranslationSyncUnsafe as t, initI18n } from '@/utils/i18n';

import { isTemporaryChat } from '../chatgptTemporaryHandoff/handoff';
import { type ChatGptFolderChange, ChatGptFolderStore } from './ChatGptFolderStore';
import {
  type ChatGptCloudSyncHost,
  syncChatGptFolders,
  uploadChatGptFolders,
} from './chatgptCloudSync';
import { ChatGptFolderGuide } from './chatgptFolderGuide';
import { type FolderPickerHandle, openFolderPicker } from './chatgptFolderPicker';
import { ChatGptFolderSection, sectionToolbarIcon } from './chatgptFolderSection';
import { ChatGptHideFiled, HIDE_FILED_SETTING } from './chatgptHideFiled';
import { bareConversationId, readChatGptConversation } from './chatgptIdentity';
import { type ChatGptTurnSelectors, trackChatGptLastTurn } from './chatgptLastTurn';
import { ChatGptMoveMenu, MOVE_ENTRY_ATTR } from './chatgptMoveMenu';
import { openNativeRename } from './chatgptNativeRename';
import { openChatGptConversation, readCurrentConversation } from './chatgptPage';
import { type DroppedConversation, bindChatGptRowDrag } from './chatgptRowDrag';
import { findChatGptSidebar } from './chatgptSidebarDom';
import { ChatGptSidebarWatcher } from './chatgptSidebarWatcher';
import { ChatGptTitleSync } from './chatgptTitleSync';
import { CHATGPT_FOLDER_CONFIG } from './config';
import { createLegacyChatGptCommands } from './legacyChatGptCommands';
import { type ChatGptFolderPanelPrefs, loadPanelPrefs, savePanelPrefs } from './panelPrefs';
import { type ChatGptFolderSectionPrefs, loadSectionPrefs, saveSectionPrefs } from './sectionPrefs';
import { chatgptFolderExportFilename, exportChatGptFolders } from './transfer';

const HINT_KEYS = ['chatgptFoldersHint', 'floatingPanelGestureHint'];
/** As long as the tree's status line these notices replace. */
const NOTICE_MS = 4000;
/** Like that status line, each outcome replaces the one before. */
const NOTICE_CHANNEL = 'chatgpt-folders';
/** Load and save problems, as long as AI Studio's error notices. */
const STORAGE_NOTICE_MS = 5000;

type Notice = { message: string; tone: ToastTone };

/** The notice that confirms a filing, or `null` when the folders were not open for edits. */
function addOutcomeNotice(outcome: EditOutcome): Notice | null {
  if (outcome.kind === 'failed') return null;
  if (outcome.kind === 'unchanged')
    return { message: t('chatgptFoldersAlreadyFiled'), tone: 'info' };
  // A rejection: the folder was deleted elsewhere; trying again shows the current folders.
  if (outcome.kind === 'rejected') return { message: t(outcome.messageKey), tone: 'error' };
  return { message: t('chatgptFoldersAdded'), tone: 'success' };
}

function format(key: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.split(`{${name}}`).join(String(value)),
    t(key),
  );
}

class ChatGptFoldersView {
  private panel: FloatingPanelHandle | null = null;
  private section: ChatGptFolderSection | null = null;
  /** Multi-select in the sidebar section; it lives and ends with the section. */
  private selection: FolderSelection | null = null;
  private picker: FolderPickerHandle | null = null;
  private fabShown = false;
  /** The conversation last recorded as opened, so each open is recorded once. */
  private openedConversationId: string | null = null;
  // Gemini's removal confirm; it closes with the panel.
  private readonly dialogs = createFolderDialogs();
  // One place for every outcome: the section, the panel and a row's menu all
  // report here, and either tree may be hidden.
  private readonly toaster = createToaster();

  constructor(
    private readonly scope: PluginScope,
    private readonly store: ChatGptFolderStore,
    private readonly commands: FolderCommands,
    private readonly prefs: ChatGptFolderPanelPrefs,
    private readonly renameNative: (conversation: ConversationReference) => void,
  ) {}

  /**
   * Mounts the sidebar section, which owns `sectionPrefs` from here on. It
   * offers the Activity view only when the page records send times (`activity`).
   */
  start(sectionPrefs: ChatGptFolderSectionPrefs, activity: boolean): void {
    this.scope.child(this.toaster, 'chatgpt-folders:toasts');
    this.scope.effect(() => () => this.showFloatingEntry(false), 'chatgpt-folders:fab');
    this.scope.effect(
      () => this.store.subscribe((change) => this.refresh(change)),
      'chatgpt-folders:sync',
    );
    this.scope.effect(() => () => this.unmountPanel(), 'chatgpt-folders:panel');
    this.scope.effect(() => {
      const rootBucketId = CHATGPT_FOLDER_CONFIG.rootBucketId;
      const feedback = {
        showNotification: (message: string, tone: ToastTone = 'info') => this.notify(message, tone),
      };
      const selection: FolderSelection = new FolderSelection({
        store: this.store,
        commands: this.commands,
        runtime: {
          get panel(): HTMLElement {
            return section.element;
          },
          // ChatGPT's own rows never join; a press on them ends the selection.
          sidebar: null,
        },
        // The section marks the open chat as it draws its rows.
        navigation: { highlightActiveConversation: () => {} },
        feedback,
        toolbar: {
          host: () => section.selectionBar,
          placement: 'inline',
          icon: sectionToolbarIcon,
        },
        getContext: () => ({ accountIsolationEnabled: false, isDestroyed: this.scope.isDisposed }),
        onFolderSelectionChange: () => section.refreshSelection(),
      });
      const drops: SidebarDropContext = {
        store: this.store,
        commands: this.commands,
        rootBucketId,
        feedback,
        sortMode: () => section.sortMode,
        conversationIdentity: FOLDER_SITE_POLICIES.chatgpt,
        finish: () => selection.finishDrop(),
      };
      const section: ChatGptFolderSection = new ChatGptFolderSection({
        data: this.store.data,
        rootBucketId,
        actions: {
          ...this.treeActions(),
          ...selection.treeActions(),
          onDrop: (e, folderId, placement) => dropOnSidebar(drops, e, folderId, placement),
          acceptsDrag: acceptsSidebarDrag,
          // The section sits in the sidebar, next to the row ChatGPT renames in.
          onRenameConversation: this.renameNative,
        },
        prefs: sectionPrefs,
        onPrefsChange: (prefs) => void saveSectionPrefs(prefs),
        activity: activity
          ? {
              commands: this.commands,
              navigation: {
                getConversationHref: (conversation) =>
                  readChatGptConversation(conversation.url)?.url ?? '',
                navigate: (conversation) => void openChatGptConversation(conversation),
              },
              dialogs: this.dialogs,
              onRenameNative: this.renameNative,
            }
          : undefined,
        selection: {
          toolbar: selection.createMultiSelectIndicator(),
          isConversationSelected: (conversation, bucketId) =>
            selection.isFolderConversationSelected(conversation.conversationId, bucketId),
        },
        transfer: {
          import: () => this.pickImportFile(),
          export: () => this.exportFolders(),
        },
        cloud: {
          upload: () => void uploadChatGptFolders(this.cloudHost),
          sync: () => void syncChatGptFolders(this.cloudHost),
        },
      });
      section.setDataReady(this.store.ready);
      // The heading files at the root, as Gemini's does: tree drags, and ChatGPT's row drags.
      section.header.setAttribute(DROP_FOLDER_ATTR, rootBucketId);
      const unbindRootDrop = bindRootDropZone(section.header, drops, DROP_TARGET_CLASS);
      this.section = section;
      this.selection = selection;
      return () => {
        this.section = null;
        this.selection = null;
        selection.reset();
        unbindRootDrop();
        section.destroy();
      };
    }, 'chatgpt-folders:section');
    this.scope.effect(
      () => () => {
        this.picker?.close();
        this.picker = null;
        for (const entry of document.querySelectorAll(`[${MOVE_ENTRY_ATTR}]`)) entry.remove();
      },
      'chatgpt-folders:move-to-folder',
    );
  }

  refresh(change: ChatGptFolderChange = 'data'): void {
    const { data, ready } = this.store;
    // The panel keeps the manual order, which an open does not change.
    this.panel?.update(data);
    this.panel?.setDataReady(ready);
    if (change === 'opened' || change === 'activity') this.section?.updateOpened(data);
    else this.section?.update(data);
    this.section?.setDataReady(ready);
  }

  /**
   * Keeps the sidebar section in ChatGPT's sidebar, marking the conversation the
   * page has open; called after every sidebar change and every route change.
   */
  placeSection(sidebar: HTMLElement | null): void {
    const openId = readChatGptConversation(location.href)?.conversationId ?? null;
    const wasPlaced = !!this.section?.element.isConnected;
    this.section?.place(sidebar);
    // ChatGPT dropped the section, or it left a sidebar that lost Recents: a
    // selection made in the old place ends, as on a Gemini remount.
    if (wasPlaced !== !!this.section?.element.isConnected) this.selection?.reset();
    this.section?.setActiveConversation(openId);
    this.showFloatingEntry(!this.section?.element.isConnected);
    this.recordOpened(openId);
  }

  /** Records when a filed conversation was opened, for the recent order, as Gemini does. */
  private recordOpened(conversationId: string | null): void {
    // Before the folders load, the open is recorded once they have.
    if (conversationId === this.openedConversationId || !this.store.ready) return;
    this.openedConversationId = conversationId;
    if (!conversationId) return;
    void this.commands.run({ kind: 'markConversationOpened', conversationId, at: Date.now() });
  }

  /**
   * The sidebar section is the way in. ChatGPT has no floating-mode setting, so
   * the floating button (and the panel, if it was left open) stands in only
   * while the page shows no sidebar for the section; both together would be two
   * copies of the same tree.
   */
  private showFloatingEntry(show: boolean): void {
    if (show === this.fabShown || (show && this.scope.isDisposed)) return;
    this.fabShown = show;
    if (!show) {
      unmountFloatingFab();
      // Keeps `prefs.open`, so the panel comes back with its button.
      this.unmountPanel();
      return;
    }
    mountFloatingFab({
      onClick: () => this.setOpen(!this.panel),
      storedPos: this.prefs.fabPos,
      onPosChange: (pos) => this.savePrefs({ fabPos: pos }),
    });
    if (this.prefs.open) this.mountPanel();
  }

  /** The section's header while the section is in the page, for the one-time guide. */
  guideAnchor(): HTMLElement | null {
    return this.section?.element.isConnected ? this.section.header : null;
  }

  /** True while the section's own folder menu or name field is open. */
  sectionBusy(): boolean {
    return this.section?.busy ?? false;
  }

  /** "Move to folder" from a sidebar row's menu: files `conversation` where the user picks. */
  pickFolderFor(conversation: ConversationReference): void {
    if (this.scope.isDisposed || !this.store.ready) return;
    this.picker?.close();
    this.picker = openFolderPicker(this.store.data, (folderId) => {
      this.picker = null;
      this.file(folderId, conversation);
    });
  }

  /**
   * The folder drop target under a viewport point, in whichever tree is showing:
   * the panel stands in only while the section is out of the page. Anything of
   * ChatGPT's above the tree, such as the row its own drag carries along, is
   * looked through.
   */
  dropTargetAt(x: number, y: number): FolderDropTarget | null {
    const surface = this.section?.element.isConnected ? this.section : this.panel;
    return surface?.dropTargetAt(x, y) ?? null;
  }

  /**
   * Files `conversation` into `folderId` and confirms the result.
   * A sidebar row dragged onto a folder (`outside-drop`) lands last, as on
   * Gemini; a picked folder puts it first.
   */
  file(folderId: string, conversation: DroppedConversation, via: AddVia = 'picker'): void {
    const { conversationId, title, url } = conversation;
    void this.commands
      .run({
        kind: 'addConversations',
        target: folderId,
        seeds: [{ conversationId, title, url }],
        via,
      })
      .then((outcome) => {
        const notice = addOutcomeNotice(outcome);
        if (notice && !this.scope.isDisposed) this.notify(notice.message, notice.tone);
      });
  }

  /** What a cloud upload or sync reads and writes; the background picks Drive or iCloud. */
  private readonly cloudHost: ChatGptCloudSyncHost = {
    data: () => this.store.data,
    ready: () => this.store.ready,
    replaceData: (data) => this.store.replaceData(data),
    notify: (message, tone) => this.notify(message, tone),
    isDisposed: () => this.scope.isDisposed,
  };

  private notify(message: string, tone: ToastTone): void {
    this.toaster.show({ message, tone, durationMs: NOTICE_MS, channel: NOTICE_CHANNEL });
  }

  /** A load or save problem stays on its own, so the next outcome does not replace it. */
  notifyStorage(message: string, tone: ToastTone): void {
    if (!this.scope.isDisposed) this.toaster.show({ message, tone, durationMs: STORAGE_NOTICE_MS });
  }

  private setOpen(open: boolean): void {
    if (open) this.mountPanel();
    else this.unmountPanel();
    this.savePrefs({ open });
  }

  private savePrefs(change: Partial<ChatGptFolderPanelPrefs>): void {
    Object.assign(this.prefs, change);
    void savePanelPrefs({ ...this.prefs });
  }

  private mountPanel(): void {
    if (this.panel) return;
    const store = this.store;
    this.panel = mountFloatingPanel({
      data: store.data,
      rootBucketId: CHATGPT_FOLDER_CONFIG.rootBucketId,
      conversationIdentity: FOLDER_SITE_POLICIES.chatgpt,
      dataReady: store.ready,
      hintKeys: HINT_KEYS,
      onCloudUpload: () => void uploadChatGptFolders(this.cloudHost),
      onCloudSync: () => void syncChatGptFolders(this.cloudHost),
      getCloudUploadTooltip: () => readSyncTooltip('chatgpt', 'upload'),
      getCloudSyncTooltip: () => readSyncTooltip('chatgpt', 'sync'),
      headerActions: [
        {
          modifier: 'import',
          labelKey: 'folder_import',
          iconPath: UPLOAD_PATH,
          onClick: () => this.pickImportFile(),
        },
        {
          modifier: 'export',
          labelKey: 'folder_export',
          iconPath: DOWNLOAD_PATH,
          onClick: () => this.exportFolders(),
        },
      ],
      storedPos: this.prefs.pos,
      storedSize: this.prefs.size,
      onPosChange: (pos) => this.savePrefs({ pos }),
      onSizeChange: (size) => this.savePrefs({ size }),
      onClose: () => {
        this.dialogs.closeAll();
        this.panel = null;
        this.savePrefs({ open: false });
      },
      ...this.treeActions(),
    });
  }

  /** What both the panel and the sidebar section do on a tree gesture. */
  private treeActions(): TreeActions {
    return {
      ...createCommandTreeActions(this.commands),
      onNavigate: (conversation) => void openChatGptConversation(conversation),
      confirmFolderRemoval: this.dialogs.confirmFolderRemoval,
      confirmConversationRemoval: this.dialogs.confirmConversationRemoval,
      onAddCurrentConversation: (folderId) => this.addCurrent(folderId),
    };
  }

  private unmountPanel(): void {
    this.dialogs.closeAll();
    this.panel?.destroy();
    this.panel = null;
  }

  private addCurrent(folderId: string): void {
    // The handoff plugin's check also reads the temporary-chat toggle, not just the URL.
    const conversation = isTemporaryChat()
      ? null
      : readCurrentConversation(t('chatgptFoldersUntitled'));
    if (!conversation) {
      this.notify(t('chatgptFoldersNoConversation'), 'info');
      return;
    }
    if (!this.store.ready) return;
    this.file(folderId, conversation);
  }

  private exportFolders(): void {
    FolderImportExportService.downloadJSON(
      exportChatGptFolders(this.store.data),
      chatgptFolderExportFilename(),
    );
    this.notify(t('folder_export_success'), 'success');
  }

  private pickImportFile(): void {
    // Never attached to the page: the picker needs only the click.
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', () => void this.importFile(input.files?.[0]), {
      once: true,
    });
    input.click();
  }

  private async importFile(file: File | undefined): Promise<void> {
    if (!file) return;
    const parsed = await FolderImportExportService.readJSONFile(file);
    if (this.scope.isDisposed) return;
    if (!parsed.success) {
      this.notify(t('folder_import_invalid_format'), 'error');
      return;
    }
    if (!this.store.ready) return;
    const outcome = await this.commands.runBulk({
      kind: 'importFile',
      payload: parsed.data,
      strategy: 'merge',
      source: 'file',
    });
    if (this.scope.isDisposed) return;
    const notice = importNotice(outcome);
    if (notice) this.notify(notice.message, notice.tone);
  }
}

/** The notice for an import; `null` when the folders were not open for edits. */
function importNotice(outcome: EditOutcome): Notice | null {
  switch (outcome.kind) {
    case 'saved':
      return {
        message: format('folder_import_success', {
          folders: outcome.stats?.foldersImported ?? 0,
          conversations: outcome.stats?.conversationsImported ?? 0,
        }),
        tone: 'success',
      };
    case 'rejected':
      return { message: t(outcome.messageKey), tone: 'error' };
    case 'failed':
      if (outcome.reason === 'not_loaded') return null;
      return {
        message: format('folder_import_error', { error: outcome.detail ?? '' }),
        tone: 'error',
      };
    default:
      return null;
  }
}

/** The page's selectors for a user message and the prompt, when its adapter names both. */
function turnSelectorsOf(adapter: SiteAdapter | null): ChatGptTurnSelectors | null {
  const userTurn = adapter?.selectors.userTurn;
  const composer = adapter?.selectors.composer;
  return userTurn && composer ? { userTurn, composer } : null;
}

export async function activateChatGptFolders(
  scope: PluginScope,
  settings: PluginSettings = {},
  adapter: SiteAdapter | null = null,
): Promise<void> {
  await initI18n();
  if (scope.isDisposed) return;
  // Created below, before the store first loads, so a load's notice has somewhere to show.
  let view: ChatGptFoldersView | null = null;
  const store = new ChatGptFolderStore(undefined, (message, tone) =>
    view?.notifyStorage(message, tone),
  );
  scope.child(store, 'chatgpt-folders:store');
  const [prefs, sectionPrefs] = await Promise.all([loadPanelPrefs(), loadSectionPrefs()]);
  if (scope.isDisposed) return;
  const commands = createLegacyChatGptCommands(store);
  const hideFiled = settings[HIDE_FILED_SETTING] === true ? new ChatGptHideFiled(scope) : null;
  const renameNative = async (conversation: ConversationReference): Promise<void> => {
    const nativeTitle = await openNativeRename(bareConversationId(conversation.conversationId), {
      sidebar: () => findChatGptSidebar(),
      reveal: (id) => hideFiled?.reveal(id) ?? (() => {}),
      active: () => !scope.isDisposed,
    });
    if (nativeTitle === null || scope.isDisposed) return;
    await commands.run({
      kind: 'restoreNativeTitle',
      conversationId: conversation.conversationId,
      nativeTitle,
    });
  };
  view = new ChatGptFoldersView(scope, store, commands, prefs, (c) => {
    void renameNative(c);
  });
  const turnSelectors = turnSelectorsOf(adapter);
  view.start(sectionPrefs, turnSelectors !== null);
  if (turnSelectors) {
    // A send seen while the stored folders still load waits for them; the store
    // refuses edits until then, and the tracker has already let the send go.
    const waiting = new Map<string, number>();
    const flush = (): void => {
      // Storage can finish loading while the folders turn off; nothing is saved after that.
      if (scope.isDisposed || !store.ready || waiting.size === 0) return;
      const entries = Array.from(waiting, ([conversationId, lastTurnAt]) => ({
        conversationId,
        lastTurnAt,
      }));
      waiting.clear();
      void commands.run({ kind: 'setConversationActivity', entries });
    };
    scope.effect(() => {
      const unsubscribe = store.subscribe(flush);
      return () => {
        unsubscribe();
        waiting.clear();
      };
    }, 'chatgpt-folders:activity-wait');
    trackChatGptLastTurn(scope, turnSelectors, (conversationId, lastTurnAt) => {
      waiting.set(conversationId, Math.max(lastTurnAt, waiting.get(conversationId) ?? 0));
      flush();
    });
  }
  const sidebar = new ChatGptSidebarWatcher(scope);
  const moveMenu = new ChatGptMoveMenu({
    label: () => t('conversation_move_to_folder'),
    untitled: () => t('chatgptFoldersUntitled'),
    canFile: () => store.ready,
    onMove: (conversation) => view.pickFolderFor(conversation),
  });
  const titles = new ChatGptTitleSync(store, commands);
  const guide = new ChatGptFolderGuide(scope, {
    anchor: () => view.guideAnchor(),
    ready: () => store.ready,
    busy: () => view.sectionBusy(),
  });
  scope.effect(() => () => moveMenu.cancel(), 'chatgpt-folders:move-menu');
  bindChatGptRowDrag(scope, {
    untitled: () => t('chatgptFoldersUntitled'),
    dropTargetAt: (x, y) => view.dropTargetAt(x, y),
    onDrop: (folderId, conversation) => view.file(folderId, conversation, 'outside-drop'),
  });
  sidebar.onChange((nav) => {
    view.placeSection(nav);
    hideFiled?.sync(nav);
    titles.sync(nav);
    guide.check();
    if (moveMenu.check(nav)) sidebar.schedule();
  });
  scope.effect(() => store.subscribe(() => sidebar.schedule()), 'chatgpt-folders:sidebar-sync');
  // A chat older than the loaded Recents opens without any sidebar change.
  scope.effect(() => watchRouteChanges(() => sidebar.schedule()), 'chatgpt-folders:route');
  if (hideFiled) {
    scope.effect(
      () => store.subscribe(() => hideFiled.update(store.filedIds())),
      'chatgpt-folders:hide-filed-sync',
    );
  }
  sidebar.start();
  await store.init();
  if (scope.isDisposed) return;
  view.refresh();
  hideFiled?.update(store.filedIds());
  sidebar.schedule();
}
