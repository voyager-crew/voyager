import browser from 'webextension-polyfill';

import { StorageKeys } from '@/core/types/common';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';
import type { FolderCommands } from '@/features/folder/commands/folderCommands';
import type { ConversationSortMode } from '@/features/folder/model/folderData';

import type { FolderNavigation } from './FolderNavigation';
import type { FolderStore } from './FolderStore';
import type { FolderTransferController } from './FolderTransferController';
import { type FloatingFabPos, mountFloatingFab, unmountFloatingFab } from './floatingModeFab';
import {
  type FloatingPanelHandle,
  type FloatingPanelPos,
  type FloatingPanelSize,
  mountFloatingPanel,
} from './floatingPanel';
import { createFloatingTreeStoreActions } from './floatingPanelActions';
import type { FolderDialogs } from './folderDialogs';
import { folderDebugWarn } from './folderManagerDebug';

type FloatingFolderUIOptions = {
  store: FolderStore;
  commands: FolderCommands;
  dialogs: FolderDialogs;
  transfer: FolderTransferController;
  navigation: FolderNavigation;
  /** False once the manager is destroyed or the folder feature is off. */
  isActive(): boolean;
  /** True only in explicit floating mode, not in the sidebar's recovery fallback. */
  isFloatingMode(): boolean;
  getSortMode(): ConversationSortMode;
  /** Drops the selection toolbar host the floating panel shares. */
  removeFloatingHost(): void;
};

type StoredGeometry = { storedPos: FloatingPanelPos | null; storedSize: FloatingPanelSize | null };

function readNumberPair<T>(candidate: unknown, a: keyof T, b: keyof T): T | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const record = candidate as T;
  return typeof record[a] === 'number' && typeof record[b] === 'number' ? record : null;
}

function persistSync(key: string, value: unknown, failure: string): void {
  void browser.storage.sync.set({ [key]: value }).catch((error) => {
    if (!isExtensionContextInvalidatedError(error)) folderDebugWarn(failure, error);
  });
}

/**
 * Floating mode (a popup opt-in): never inject into Gemini's sidebar; mount the
 * body-level floating panel (or its FAB) instead. Owns the open panel's handle.
 */
export class FloatingFolderUI {
  handle: FloatingPanelHandle | null = null;

  constructor(private readonly options: FloatingFolderUIOptions) {}

  get isOpen(): boolean {
    return this.handle !== null;
  }

  /**
   * Leave floating mode — tear down the body-level UI. Safe to call when
   * floating mode was never entered.
   */
  close(): void {
    unmountFloatingFab();
    if (this.handle) {
      this.handle.destroy();
      this.handle = null;
    }
    this.options.removeFloatingHost();
  }

  /**
   * Mounts the small persistent FAB button in the corner. Safe to call multiple
   * times — the module is idempotent. Hydrates and persists position via
   * chrome.storage.sync so the user's chosen spot sticks across reloads.
   */
  showFab(): Promise<void> {
    const canShow = () => this.options.isActive() && this.options.isFloatingMode();
    return browser.storage.sync
      .get({ [StorageKeys.FOLDER_FLOATING_FAB_POS]: null })
      .then((raw) => {
        if (!canShow()) return;
        mountFloatingFab({
          storedPos: readNumberPair<FloatingFabPos>(
            raw[StorageKeys.FOLDER_FLOATING_FAB_POS],
            'x',
            'y',
          ),
          onClick: () => void this.openPanel(),
          onPosChange: (pos) =>
            persistSync(
              StorageKeys.FOLDER_FLOATING_FAB_POS,
              pos,
              'Failed to persist floating FAB position:',
            ),
        });
      })
      .catch((error) => {
        if (isExtensionContextInvalidatedError(error)) return;
        if (!canShow()) return;
        folderDebugWarn('Failed to read floating FAB position:', error);
        // Still mount at default position so feature degrades gracefully.
        mountFloatingFab({ onClick: () => void this.openPanel() });
      });
  }

  async openPanel(): Promise<void> {
    if (!this.options.isActive() || this.handle) return;
    // Only one entry point visible at a time — FAB hides when the panel is up.
    unmountFloatingFab();

    const geometry = await this.readStoredGeometry();
    if (!geometry || !this.options.isActive()) return;
    this.handle = this.mountPanel(geometry);
  }

  /** Null when the extension context is gone; empty geometry when the read fails. */
  private async readStoredGeometry(): Promise<StoredGeometry | null> {
    try {
      const raw = await browser.storage.sync.get({
        [StorageKeys.FOLDER_FLOATING_POS]: null,
        [StorageKeys.FOLDER_FLOATING_SIZE]: null,
      });
      return {
        storedPos: readNumberPair<FloatingPanelPos>(raw[StorageKeys.FOLDER_FLOATING_POS], 'x', 'y'),
        storedSize: readNumberPair<FloatingPanelSize>(
          raw[StorageKeys.FOLDER_FLOATING_SIZE],
          'w',
          'h',
        ),
      };
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) return null;
      folderDebugWarn('Failed to read floating-mode position/size:', error);
      return { storedPos: null, storedSize: null };
    }
  }

  private mountPanel(geometry: StoredGeometry): FloatingPanelHandle {
    const { store, dialogs, navigation } = this.options;
    return mountFloatingPanel({
      data: store.data,
      dataReady: store.canEdit,
      conversationSortMode: this.options.getSortMode(),
      ...geometry,
      onPosChange: (pos) =>
        persistSync(
          StorageKeys.FOLDER_FLOATING_POS,
          pos,
          'Failed to persist floating-mode position:',
        ),
      // Fires once, 300ms after the last resize observed by the panel, so
      // storage.sync isn't spammed with every intermediate size during a drag.
      onSizeChange: (size) =>
        persistSync(
          StorageKeys.FOLDER_FLOATING_SIZE,
          size,
          'Failed to persist floating-mode size:',
        ),
      onClose: () => {
        this.handle = null;
        // Only explicit floating mode owns a persistent FAB. A temporary
        // recovery fallback stays dismissed until the sidebar returns, which
        // avoids turning an internal recovery state into a sticky user mode.
        if (this.options.isFloatingMode()) void this.showFab();
      },
      onNavigate: (conv) => {
        if (conv.url) navigation.navigate(conv);
      },
      ...createFloatingTreeStoreActions(this.options.commands, dialogs),
      ...this.cloudActions(),
    });
  }

  /**
   * Cloud sync / upload — mirror what the sidebar's header buttons do, on every
   * browser: Safari uploads through its native Drive bridge or iCloud.
   *
   * onCloudSync can mutate store.data (merges Drive payload locally); it
   * persists via saveData, whose centralised hook pushes the merged snapshot
   * into the floating panel. onCloudUpload is read-only locally.
   */
  private cloudActions() {
    const { transfer } = this.options;
    return {
      onCloudUpload: () => void transfer.upload(),
      onCloudSync: () => void transfer.sync(),
      getCloudUploadTooltip: () => transfer.getUploadTooltip(),
      getCloudSyncTooltip: () => transfer.getSyncTooltip(),
    };
  }
}
