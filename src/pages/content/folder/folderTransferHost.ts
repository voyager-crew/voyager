import type { ToastHandle, ToastTone } from '@/core/ui/toast/types';

import type { FolderDataSession } from './FolderDataSession';
import type { FolderWriteReceipt } from './storage/FolderStorageAdapter';
import type { FolderData } from './types';

export type TransferContext = {
  session: FolderDataSession | null;
  // A session may be retained across A -> B -> A; identity alone is insufficient.
  activation: number;
  data: FolderData;
};

/** What folder transfers need from the manager: account context, persistence and feedback. */
export interface FolderTransferHost {
  getContext(): TransferContext;
  applyData(data: FolderData, beforeWrite?: FolderWriteReceipt): Promise<boolean>;
  refresh(): void;
  /**
   * Shows a transfer notice. A host that returns its toast's handle lets a
   * cloud result complete it with a title, Undo and timing; one that does not
   * shows results without Undo.
   */
  notify(message: string, type?: ToastTone): ToastHandle | void;
}

export type ImportSource = { text: string } | { file: File | null };

/** A delayed transfer result may land only on the account activation that started it. */
export function isCurrentTransfer(host: FolderTransferHost, context: TransferContext): boolean {
  const current = host.getContext();
  return current.session === context.session && current.activation === context.activation;
}

export function debugTransfer(...args: unknown[]): void {
  try {
    if (localStorage.getItem('gvFolderDebug') === '1') console.log('[FolderTransfer]', ...args);
  } catch {
    // Debug storage may be unavailable in private browsing.
  }
}
