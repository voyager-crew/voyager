/**
 * Moves AI Studio folders in and out: Drive upload and download-merge through
 * the background, plus JSON file import. AI Studio has its own Drive folder file
 * but shares prompts with Gemini.
 *
 * Every operation captures the account session and activation it started in,
 * and drops its result (and its feedback) once either has changed.
 */
import type { PromptItem } from '@/core/types/sync';
import type { ToastHandle, ToastInput, ToastTone } from '@/core/ui/toast/types';
import { toSyncAccountScope } from '@/core/utils/syncAccountScope';
import {
  mergeAIStudioImport,
  readAIStudioImportFile,
} from '@/features/folder/model/aistudioImport';
import { cloneFolderData } from '@/features/folder/model/folderData';
import type { FolderDataSession } from '@/pages/content/folder/FolderDataSession';
import {
  type CloudSyncSite,
  syncSiteFolders,
  uploadSiteFolders,
} from '@/pages/content/folder/cloudSyncClient';
import type { FolderWriteReceipt } from '@/pages/content/folder/storage/FolderStorageAdapter';
import type { FolderData } from '@/pages/content/folder/types';

export type AIStudioTransferHost = {
  t: (key: string) => string;
  session: () => FolderDataSession | null;
  /** Changes on every account rebind, including a return to the same account. */
  activation: () => number;
  canEdit: () => boolean;
  data: () => FolderData;
  /** Persists a draft (with prompts in the same write) and publishes it only on success. */
  replaceData: (
    data: FolderData,
    prompts?: PromptItem[],
    beforeWrite?: FolderWriteReceipt,
  ) => Promise<boolean>;
  notify: (message: string, tone: ToastTone, channel?: string) => void;
  /** A full notice (title, action, timing) on `channel`, for a result with Undo. */
  notice: (input: ToastInput) => ToastHandle | null;
};

/** One transfer notice at a time: a result replaces its "in progress" notice. */
const TRANSFER_CHANNEL = 'transfer';

export class AIStudioTransfer {
  constructor(private readonly host: AIStudioTransferHost) {}

  /** Uploads this account's folders and the shared prompts to Drive. */
  upload(): Promise<void> {
    return uploadSiteFolders(this.cloudSite);
  }

  /**
   * Downloads Drive's copy and merges it into this account's folders and the
   * shared prompts. A failed save is reported by the repository.
   */
  sync(): Promise<void> {
    return syncSiteFolders(this.cloudSite);
  }

  /** Opens a file picker and merges the chosen folder file. Not offered in AI Studio's UI yet. */
  importFile(): void {
    const started = this.begin();
    if (!started) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.addEventListener('change', () => void this.importChosen(input, started.current), {
      once: true,
    });
    input.click();
  }

  private readonly cloudSite: CloudSyncSite = {
    platform: 'aistudio',
    t: (key) => this.host.t(key),
    notify: (message, tone) => this.report(message, tone),
    notice: (input) => this.host.notice({ ...input, channel: TRANSFER_CHANNEL }),
    begin: () => {
      const started = this.begin();
      if (!started) return null;
      const { session, current } = started;
      const accountScope = toSyncAccountScope(session.accountScope);
      return {
        current,
        folders: cloneFolderData(session.data),
        data: () => this.host.data(),
        scopes: async () => ({ accountScope }),
        save: (folders, prompts, beforeWrite) =>
          this.host.replaceData(folders, prompts, beforeWrite),
      };
    },
  };

  /** The session an operation starts in, and a check that it is still the live one. */
  private begin(): { session: FolderDataSession; current: () => boolean } | null {
    const session = this.host.session();
    const activation = this.host.activation();
    if (!session || !this.host.canEdit()) return null;
    const current = () => this.host.session() === session && this.host.activation() === activation;
    return { session, current };
  }

  private async importChosen(input: HTMLInputElement, current: () => boolean): Promise<void> {
    const file = input.files && input.files[0];
    if (!file) return;
    const { t } = this.host;
    try {
      const text = await file.text();
      if (!current()) return;
      const read = readAIStudioImportFile(JSON.parse(text));
      if (!read.ok) {
        this.report(t(read.messageKey) || 'Invalid file format', 'error');
        return;
      }
      const merge = mergeAIStudioImport(this.host.data(), read.data);
      const saved = await this.host.replaceData(merge.data);
      if (!current() || !saved) return;
      this.report(
        t('folder_import_success')
          .replace('{folders}', String(merge.stats.foldersImported))
          .replace('{conversations}', String(merge.stats.conversationsImported)),
        'success',
      );
    } catch (error) {
      if (!current()) return;
      this.report(
        t('folder_import_error').replace('{error}', () => String(error)),
        'error',
      );
    }
  }

  private report(message: string, tone: ToastTone): void {
    this.host.notify(message, tone, TRANSFER_CHANNEL);
  }
}
