import { askConfirm } from '@/core/ui/confirm';
import { cloneFolderData } from '@/features/folder/model/folderData';
import { FolderImportExportService } from '@/features/folder/services/FolderImportExportService';
import type {
  FolderExportPayload,
  ImportResult,
  ImportStrategy,
} from '@/features/folder/types/import-export';
import { getTranslationSyncUnsafe as t } from '@/utils/i18n';

import { syncFolders, uploadFolders } from './folderCloudSync';
import { createImportDialog } from './folderImportDialog';
import {
  type FolderTransferHost,
  type ImportSource,
  type TransferContext,
  debugTransfer,
  isCurrentTransfer,
} from './folderTransferHost';
import { readSyncTooltip } from './syncTooltip';

function importSuccessMessage(strategy: ImportStrategy, stats: ImportResult): string {
  const skipped =
    (stats.duplicatesFoldersSkipped || 0) + (stats.duplicatesConversationsSkipped || 0);
  return t(
    strategy === 'merge' && skipped > 0 ? 'folder_import_success_skipped' : 'folder_import_success',
  )
    .replace('{folders}', String(stats.foldersImported))
    .replace('{conversations}', String(stats.conversationsImported))
    .replace('{skipped}', String(skipped));
}

/**
 * Owns import/export, the import dialog and the cloud commands; delayed results remain bound to
 * their account activation. Drive upload and merge live in `folderCloudSync.ts`.
 */
export class FolderTransferController {
  private importInProgress = false;
  private exportInProgress = false;
  private activeImportDialog: HTMLElement | null = null;

  constructor(private readonly host: FolderTransferHost) {}

  private isCurrent(context: TransferContext): boolean {
    return isCurrentTransfer(this.host, context);
  }

  /** Refuse a file another site marked as its own, then validate it; notifies on refusal. */
  private validateImport(data: unknown): FolderExportPayload | null {
    // A file another site marked as its own holds conversations Gemini cannot
    // open; merging it would mix platforms in one bucket.
    if (FolderImportExportService.exportedPlatform(data) !== null) {
      this.host.notify(t('folder_import_wrong_site'), 'error');
      return null;
    }

    const validated = FolderImportExportService.validatePayload(data);
    if (!validated.success) {
      this.host.notify(`${t('folder_import_invalid_format')}: ${validated.error.message}`, 'error');
      return null;
    }
    return validated.data;
  }

  /** Whether the user chose to replace every folder, asked beside `anchor`. */
  private async confirmOverwrite(anchor: HTMLElement): Promise<boolean> {
    const answer = await askConfirm({
      message: t('folder_import_confirm_overwrite'),
      anchor,
      tone: 'danger',
      choices: [{ id: 'overwrite', label: t('folder_import_overwrite') }],
    });
    return answer === 'overwrite';
  }

  /** `anchor` is the control that asked for the import; an overwrite confirms beside it. */
  async import(
    source: ImportSource,
    strategy: ImportStrategy,
    anchor: HTMLElement,
  ): Promise<boolean> {
    const context = this.host.getContext();
    const { session } = context;
    if (!session?.ready) return false;
    if (this.importInProgress) {
      this.host.notify(t('folder_import_in_progress'), 'info');
      return false;
    }

    this.importInProgress = true;
    try {
      let parsed: ReturnType<typeof FolderImportExportService.parseJSONText>;
      if ('text' in source) {
        parsed = FolderImportExportService.parseJSONText(source.text);
        if (!parsed.success) {
          this.host.notify(t('folder_import_invalid_format'), 'error');
          return false;
        }
        if (strategy === 'overwrite' && !(await this.confirmOverwrite(anchor))) return false;
        if (!this.isCurrent(context)) return false;
      } else {
        if (!source.file) {
          this.host.notify(t('folder_import_select_file'), 'error');
          return false;
        }
        if (strategy === 'overwrite' && !(await this.confirmOverwrite(anchor))) return false;
        if (!this.isCurrent(context)) return false;
        parsed = await FolderImportExportService.readJSONFile(source.file);
        if (!this.isCurrent(context)) return false;
        if (!parsed.success) {
          this.host.notify(t('folder_import_invalid_format'), 'error');
          return false;
        }
      }

      const payload = this.validateImport(parsed.data);
      if (!payload) return false;
      const result = await FolderImportExportService.importFromPayload(
        payload,
        cloneFolderData(session.data),
        { strategy, createBackup: true },
      );
      if (!this.isCurrent(context)) return false;
      if (!result.success) {
        this.host.notify(
          t('folder_import_error').replace('{error}', () => String(result.error)),
          'error',
        );
        return false;
      }

      const saved = await this.host.applyData(result.data.data);
      if (!this.isCurrent(context)) return false;
      if (!saved) {
        this.host.notify(t('folder_save_error'), 'error');
        return false;
      }
      this.host.refresh();
      this.host.notify(importSuccessMessage(strategy, result.data.stats), 'success');
      return true;
    } catch (error) {
      console.error('[FolderTransfer] Import failed:', error);
      if (this.isCurrent(context)) {
        this.host.notify(
          t('folder_import_error').replace('{error}', () => String(error)),
          'error',
        );
      }
      return false;
    } finally {
      this.importInProgress = false;
    }
  }

  exportFolders(): void {
    // Prevent concurrent exports
    if (this.exportInProgress) {
      this.host.notify(t('folder_export_in_progress'), 'info');
      return;
    }

    this.exportInProgress = true;

    try {
      const payload = FolderImportExportService.exportToPayload(this.host.getContext().data);
      FolderImportExportService.downloadJSON(payload);
      this.host.notify(t('folder_export_success'), 'success');
      debugTransfer('Folders exported successfully');
    } catch (error) {
      console.error('[FolderTransfer] Export error:', error);
      this.host.notify(
        t('folder_import_error').replace('{error}', () => String(error)),
        'error',
      );
    } finally {
      // Always release the lock
      this.exportInProgress = false;
    }
  }

  showImportDialog(): void {
    if (this.activeImportDialog && !this.activeImportDialog.isConnected) {
      this.activeImportDialog = null;
    }

    // Prevent creating multiple import dialogs simultaneously
    if (this.activeImportDialog) return;

    const overlay = createImportDialog({
      submit: (source, strategy, anchor) => this.import(source, strategy, anchor),
      isActive: (dialog) => this.activeImportDialog === dialog,
      close: () => this.closeImportDialog(),
    });
    document.body.appendChild(overlay);

    // Track this dialog as the active one
    this.activeImportDialog = overlay;

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.closeImportDialog();
      }
    });
  }

  closeImportDialog(): void {
    if (this.activeImportDialog) {
      this.activeImportDialog.remove();
      this.activeImportDialog = null;
    }
  }

  upload(): Promise<void> {
    return uploadFolders(this.host);
  }

  sync(): Promise<void> {
    return syncFolders(this.host);
  }

  getUploadTooltip(): Promise<string> {
    return readSyncTooltip('gemini', 'upload');
  }

  getSyncTooltip(): Promise<string> {
    return readSyncTooltip('gemini', 'sync');
  }
}
