/**
 * A site's folders on screen: the sidebar section, the shared floating panel
 * that stands in while the page shows no sidebar for it, the "Move to folder"
 * picker, and one toaster for every outcome. Everything is registered on the
 * plugin's scope, so turning the plugin off leaves nothing behind.
 */
import { DOWNLOAD_PATH, UPLOAD_PATH } from '@/core/icons/transferPaths';
import type { ConversationReference } from '@/core/types/folder';
import { createToaster } from '@/core/ui/toast/toaster';
import type { ToastTone } from '@/core/ui/toast/types';
import type { FolderCommands } from '@/features/folder/commands/folderCommands';
import type { AddVia } from '@/features/folder/owner/folderOwnerPolicy';
import { FolderImportExportService } from '@/features/folder/services/FolderImportExportService';
import type { PluginScope } from '@/features/plugins/runtime/pluginScope';
import type { FolderSelection } from '@/pages/content/folder/FolderSelection';
import type { SiteFolderChange } from '@/pages/content/folder/SiteFolderStore';
import {
  type CloudSyncSite,
  syncSiteFolders,
  uploadSiteFolders,
} from '@/pages/content/folder/cloudSyncClient';
import { createCommandTreeActions } from '@/pages/content/folder/commandTreeActions';
import { type FloatingFabHandle, createFloatingFab } from '@/pages/content/folder/floatingModeFab';
import { type FloatingPanelHandle, mountFloatingPanel } from '@/pages/content/folder/floatingPanel';
import type { FolderDropTarget } from '@/pages/content/folder/floatingTree/dropTargets';
import type { TreeActions } from '@/pages/content/folder/floatingTree/shared';
import { createFolderDialogs } from '@/pages/content/folder/folderDialogs';
import { readCloudTooltip, readSyncTooltip } from '@/pages/content/folder/syncTooltip';
import { getTranslationSyncUnsafe as t } from '@/utils/i18n';

import { type FolderPickerHandle, openFolderPicker } from './folderPicker';
import type { SiteFolderSection } from './folderSection';
import { NOTICE_MS, STORAGE_NOTICE_MS, addOutcomeNotice, importNotice } from './notices';
import { type SiteFolderPanelPrefs, savePanelPrefs } from './panelPrefs';
import type { DroppedConversation } from './rowDrag';
import { mountSiteSection } from './sectionMount';
import { type SiteFolderSectionPrefs, saveSectionPrefs } from './sectionPrefs';
import { permittedTreeActions } from './treeSite';
import type { SiteFoldersAdapter, SiteFoldersStore } from './types';

export class SiteFoldersView {
  private panel: FloatingPanelHandle | null = null;
  private section: SiteFolderSection | null = null;
  /** Multi-select in the sidebar section; it lives and ends with the section. */
  private selection: FolderSelection | null = null;
  private picker: FolderPickerHandle | null = null;
  private fab: FloatingFabHandle | null = null;
  /** The conversation last recorded as opened, so each open is recorded once. */
  private openedConversationId: string | null = null;
  // Gemini's removal confirm; it closes with the panel.
  private readonly dialogs = createFolderDialogs();
  // One place for every outcome: the section, the panel and a row's menu all
  // report here, and either tree may be hidden.
  private readonly toaster = createToaster();
  private readonly cloudSite: CloudSyncSite;

  constructor(
    private readonly scope: PluginScope,
    private readonly site: SiteFoldersAdapter,
    private readonly store: SiteFoldersStore,
    private readonly commands: FolderCommands,
    private readonly prefs: SiteFolderPanelPrefs,
    private readonly renameNative: (conversation: ConversationReference) => void,
  ) {
    // What a cloud upload or sync reads and writes; the background picks Drive or
    // iCloud. A failed save is reported by the store.
    this.cloudSite = {
      platform: site.platform,
      t,
      notify: (message, tone) => this.notify(message, tone),
      // A result completes the transfer notice in place, with Undo for a download.
      notice: (input) =>
        this.scope.isDisposed ? null : this.toaster.show({ ...input, channel: this.site.key }),
      begin: () => {
        if (!this.store.ready) return null;
        return {
          current: () => !this.scope.isDisposed,
          folders: this.store.data,
          data: () => this.store.data,
          save: async (folders, _prompts, beforeWrite) =>
            this.store.ready && this.store.replaceData(folders, beforeWrite),
        };
      },
    };
  }

  /**
   * Mounts the sidebar section, which owns `sectionPrefs` from here on. It
   * offers the Activity view only when the page records send times (`activity`).
   */
  start(sectionPrefs: SiteFolderSectionPrefs, activity: boolean): void {
    const { key, identity, page } = this.site;
    this.scope.child(this.toaster, `${key}:toasts`);
    this.scope.effect(() => () => this.showFloatingEntry(false), `${key}:fab`);
    this.scope.effect(() => this.store.subscribe((change) => this.refresh(change)), `${key}:sync`);
    this.scope.effect(() => () => this.unmountPanel(), `${key}:panel`);
    this.scope.effect(() => {
      const mounted = mountSiteSection({
        site: this.site.section,
        store: this.store,
        commands: this.commands,
        rootBucketId: this.site.rootBucketId,
        treeActions: this.treeActions(),
        renameNative: this.renameNative,
        activity: activity
          ? {
              navigation: {
                getConversationHref: identity.href,
                navigate: (conversation) => page.open(conversation),
              },
              dialogs: this.dialogs,
            }
          : null,
        transfer: {
          import: () => this.pickImportFile(),
          export: () => this.exportFolders(),
        },
        cloud: {
          upload: () => void uploadSiteFolders(this.cloudSite),
          sync: () => void syncSiteFolders(this.cloudSite),
          // The sidebar's one cloud button was a bare label; only the floating panel showed these times.
          tooltip: () => readCloudTooltip(this.site.platform),
        },
        prefs: sectionPrefs,
        savePrefs: (prefs) => void saveSectionPrefs(this.site.prefsKeys.section, prefs),
        notify: (message, tone) => this.notify(message, tone),
        isDisposed: () => this.scope.isDisposed,
      });
      this.section = mounted.section;
      this.selection = mounted.selection;
      return () => {
        this.section = null;
        this.selection = null;
        mounted.dispose();
      };
    }, `${key}:section`);
    this.scope.effect(
      () => () => {
        this.picker?.close();
        this.picker = null;
      },
      `${key}:move-to-folder`,
    );
  }

  refresh(change: SiteFolderChange = 'data'): void {
    const { data, ready } = this.store;
    // The panel keeps the manual order, which an open does not change.
    this.panel?.update(data);
    this.panel?.setDataReady(ready);
    if (change === 'opened' || change === 'activity') this.section?.updateOpened(data);
    else this.section?.update(data);
    this.section?.setDataReady(ready);
  }

  /**
   * Keeps the sidebar section in the site's sidebar, marking the conversation the
   * page has open; called after every sidebar change and every route change.
   */
  placeSection(sidebar: HTMLElement | null): void {
    const openId = this.site.identity.conversationIdOf(location.href);
    const wasPlaced = !!this.section?.element.isConnected;
    this.section?.place(sidebar);
    // The site dropped the section, or it left a sidebar that lost its anchor: a
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
   * The sidebar section is the way in. These sites have no floating-mode
   * setting, so the floating button (and the panel, if it was left open) stands
   * in only while the page shows no sidebar for the section; both together
   * would be two copies of the same tree.
   */
  private showFloatingEntry(show: boolean): void {
    if (show === !!this.fab || (show && this.scope.isDisposed)) return;
    if (!show) {
      this.fab?.destroy();
      this.fab = null;
      // Keeps `prefs.open`, so the panel comes back with its button.
      this.unmountPanel();
      return;
    }
    this.fab = createFloatingFab({
      onClick: () => this.setOpen(!this.panel),
      storedPos: this.prefs.fabPos,
      onPosChange: (pos) => this.savePrefs({ fabPos: pos }),
    });
    if (this.prefs.open) this.mountPanel();
  }

  /** Whether the folders are on screen: the section in the sidebar, or the floating button. */
  onScreen(): boolean {
    return !!this.section?.element.isConnected || this.fab !== null;
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
   * the site's above the tree, such as the row its own drag carries along, is
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
        const notice = addOutcomeNotice(outcome, this.site.messages);
        if (notice && !this.scope.isDisposed) this.notify(notice.message, notice.tone);
      });
  }

  private notify(message: string, tone: ToastTone): void {
    this.toaster.show({ message, tone, durationMs: NOTICE_MS, channel: this.site.key });
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

  private savePrefs(change: Partial<SiteFolderPanelPrefs>): void {
    Object.assign(this.prefs, change);
    void savePanelPrefs(this.site.prefsKeys.panel, { ...this.prefs });
  }

  private mountPanel(): void {
    if (this.panel) return;
    const { store, site } = this;
    this.panel = mountFloatingPanel({
      data: store.data,
      replaceExisting: false,
      policy: site.policy,
      cloudActions: true,
      dataReady: store.ready,
      hintKeys: [site.messages.hint, 'floatingPanelGestureHint'],
      onCloudUpload: () => void uploadSiteFolders(this.cloudSite),
      onCloudSync: () => void syncSiteFolders(this.cloudSite),
      getCloudUploadTooltip: () => readSyncTooltip(site.platform, 'upload'),
      getCloudSyncTooltip: () => readSyncTooltip(site.platform, 'sync'),
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
    return permittedTreeActions(
      {
        ...createCommandTreeActions(this.commands),
        onNavigate: (conversation) => this.site.page.open(conversation),
        confirmFolderRemoval: this.dialogs.confirmFolderRemoval,
        confirmConversationRemoval: this.dialogs.confirmConversationRemoval,
        onAddCurrentConversation: (folderId) => this.addCurrent(folderId),
      },
      this.site.section.tree,
    );
  }

  private unmountPanel(): void {
    this.dialogs.closeAll();
    this.panel?.destroy();
    this.panel = null;
  }

  private addCurrent(folderId: string): void {
    const conversation = this.site.page.current(t(this.site.messages.untitled));
    if (!conversation) {
      this.notify(t(this.site.messages.noConversation), 'info');
      return;
    }
    if (!this.store.ready) return;
    this.file(folderId, conversation);
  }

  private exportFolders(): void {
    FolderImportExportService.downloadJSON(
      this.site.transfer.export(this.store.data),
      this.site.transfer.filename(),
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
