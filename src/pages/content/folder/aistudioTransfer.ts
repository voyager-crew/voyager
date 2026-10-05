/**
 * Moves AI Studio folders in and out: Drive upload and download-merge through
 * the background, plus JSON file import. AI Studio has its own Drive folder file
 * but shares prompts with Gemini.
 *
 * Every operation captures the account session and activation it started in,
 * and drops its result (and its feedback) once either has changed.
 */
import browser, { type Runtime } from 'webextension-polyfill';

import type { AccountScope } from '@/core/services/AccountIsolationService';
import type { PromptItem, SyncAccountScope } from '@/core/types/sync';
import type { ToastTone } from '@/core/ui/toast/types';
import { cloneFolderData } from '@/features/folder/model/folderData';
import { mergeFolderData, mergePrompts } from '@/utils/merge';

import type { FolderDataSession } from './FolderDataSession';
import { mergeAIStudioImport, readAIStudioImportFile } from './aistudioImport';
import type { FolderData } from './types';

export type AIStudioTransferHost = {
  t: (key: string) => string;
  session: () => FolderDataSession | null;
  /** Changes on every account rebind, including a return to the same account. */
  activation: () => number;
  canEdit: () => boolean;
  data: () => FolderData;
  /** Persists a draft (with prompts in the same write) and publishes it only on success. */
  replaceData: (data: FolderData, prompts?: PromptItem[]) => Promise<boolean>;
  notify: (message: string, tone: ToastTone, channel?: string) => void;
};

/** One transfer notice at a time: a result replaces its "in progress" notice. */
const TRANSFER_CHANNEL = 'transfer';

type DownloadResponse =
  | {
      ok?: boolean;
      error?: string;
      data?: { folders?: { data?: FolderData }; prompts?: { items?: PromptItem[] } };
    }
  | undefined;

export function toSyncAccountScope(scope: AccountScope | null): SyncAccountScope | undefined {
  if (!scope) return undefined;
  return {
    accountKey: scope.accountKey,
    accountId: scope.accountId,
    routeUserId: scope.routeUserId,
  };
}

export type SyncMessageHost = {
  canEdit: () => boolean;
  data: () => FolderData;
  accountScope: () => AccountScope | null;
  /** Reloads folder data from storage and shows it. */
  reload: () => Promise<void>;
};

/**
 * Serves the popup's cloud sync: `gv.sync.requestData` (before an upload)
 * answers with this account's folders, `gv.folders.reload` (after a
 * download) reloads them.
 */
export function createSyncMessageListener(
  host: SyncMessageHost,
): Runtime.OnMessageListenerCallback {
  const listener = (
    message: unknown,
    _sender: Runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ): true | undefined => {
    const type = (message as { type?: unknown } | null)?.type;
    if (type === 'gv.sync.requestData') {
      // An unresolved or unreadable session's empty data must not replace the popup's storage fallback.
      if (!host.canEdit()) {
        sendResponse({ ok: false });
        return true;
      }
      const accountScope = toSyncAccountScope(host.accountScope());
      sendResponse({ ok: true, data: host.data(), accountScope });
      return true;
    }
    if (type === 'gv.folders.reload') {
      void host.reload();
      sendResponse({ ok: true });
      return true;
    }
    // An unknown message must settle the sender's promise now: `true` would
    // promise a response that never comes and leave broadcasts hanging.
    return undefined;
  };
  // The polyfill's typing cannot express "respond to some messages, ignore the rest".
  return listener as Runtime.OnMessageListenerCallback;
}

async function readLocalPrompts(purpose: string): Promise<PromptItem[]> {
  try {
    const result = await chrome.storage.local.get(['gvPromptItems']);
    return (result.gvPromptItems as PromptItem[] | undefined) || [];
  } catch (error) {
    console.warn(`[AIStudioFolderManager] Could not get prompts for ${purpose}:`, error);
    return [];
  }
}

export class AIStudioTransfer {
  constructor(private readonly host: AIStudioTransferHost) {}

  /** Uploads this account's folders and the shared prompts to Drive. */
  async upload(): Promise<void> {
    const started = this.begin();
    if (!started) return;
    const { session, current } = started;
    try {
      this.report(this.host.t('uploadInProgress'), 'info');
      const folders = cloneFolderData(session.data);
      const prompts = await readLocalPrompts('upload');
      if (!current()) return;
      const response = (await browser.runtime.sendMessage({
        type: 'gv.sync.upload',
        payload: {
          folders,
          prompts,
          platform: 'aistudio',
          accountScope: toSyncAccountScope(session.accountScope),
        },
      })) as { ok?: boolean; error?: string } | undefined;
      if (!current()) return;
      if (response?.ok) this.report(this.host.t('uploadSuccess'), 'success');
      else this.notifySyncError(response?.error || 'Unknown error');
    } catch (error) {
      if (!current()) return;
      console.error('[AIStudioFolderManager] Cloud upload failed:', error);
      this.notifySyncError(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /** Downloads Drive's copy and merges it into this account's folders and the shared prompts. */
  async sync(): Promise<void> {
    const started = this.begin();
    if (!started) return;
    const { session, current } = started;
    try {
      this.report(this.host.t('downloadInProgress'), 'info');
      const response = (await browser.runtime.sendMessage({
        type: 'gv.sync.download',
        payload: { platform: 'aistudio', accountScope: toSyncAccountScope(session.accountScope) },
      })) as DownloadResponse;
      if (!current()) return;
      if (!response?.ok) return this.notifySyncError(response?.error || 'Download failed');
      if (!response.data) {
        this.report(this.host.t('syncNoData') || 'No data in cloud', 'info');
        return;
      }
      const cloudFolders = response.data.folders?.data || { folders: [], folderContents: {} };
      const cloudPrompts = response.data.prompts?.items || [];
      const localPrompts = await readLocalPrompts('merge');
      if (!current()) return;
      const saved = await this.host.replaceData(
        mergeFolderData(this.host.data(), cloudFolders),
        mergePrompts(localPrompts, cloudPrompts),
      );
      if (!current() || !saved) return;
      this.report(this.host.t('downloadMergeSuccess'), 'success');
    } catch (error) {
      if (!current()) return;
      console.error('[AIStudioFolderManager] Cloud sync failed:', error);
      this.notifySyncError(error instanceof Error ? error.message : 'Unknown error');
    }
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

  private notifySyncError(message: string): void {
    this.report(
      this.host.t('syncError').replace('{error}', () => message),
      'error',
    );
  }
}
