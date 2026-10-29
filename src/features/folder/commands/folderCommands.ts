/**
 * The one interface folder UI code edits through (DESIGN-v2 §8.2). Today every
 * site is backed by a legacy façade over its store; from P4 a site's backend is
 * the background owner, and callers do not change.
 */
import type { ConversationReference, FolderData } from '@/core/types/folder';
import type { PromptItem } from '@/core/types/sync';
import type { FolderOpBody, OpOutcome } from '@/features/folder/owner/folderOps';
import type { FolderWriteReceipt } from '@/pages/content/folder/storage/FolderStorageAdapter';
import type { TranslationKey } from '@/utils/translations';

export type BulkOpKind = 'importFile' | 'restoreBackup' | 'cloudMerge';
/** A captured page drop retains the records and single/batch distinction the legacy UI used. */
export type ConversationDrop = {
  conversationId?: string;
  title: string;
  url?: string;
  isGem?: boolean;
  gemId?: string;
  conversations?: ConversationReference[];
  sourceFolderId?: string;
};

/** Site operations whose legacy batching cannot be expressed by an ordinary owner edit. */
type SiteOpBody =
  | { kind: 'dropConversations'; target: string; payload: ConversationDrop; index?: number }
  | { kind: 'bufferNativeTitle'; folderId: string; index: number; title: string }
  | { kind: 'flushNativeTitles' }
  | { kind: 'syncNativeSidebarTitles' }
  /** AI Studio stages drops before each caller's existing save boundary. */
  | {
      kind: 'placeAIStudioPrompt';
      prompt: { conversationId: string; title: string; url?: string; sourceFolderId?: string };
      target: string | null;
      untitledTitle: string;
      at: number;
    }
  | { kind: 'saveCurrentData' }
  /** The /library drop zone creates its first folder before saving, even while read-only. */
  | { kind: 'ensureDefaultAIStudioFolder'; folderId: string; name: string; at: number };

export type BulkOpBody =
  | Extract<FolderOpBody, { kind: BulkOpKind }>
  /** The transfer controller already validated, merged and backed up this draft. */
  | {
      kind: 'commitPreparedData';
      data: FolderData;
      prompts?: PromptItem[];
      beforeWrite?: FolderWriteReceipt;
    };
export type OrdinaryOpBody = Exclude<FolderOpBody, { kind: BulkOpKind }>;
export type FolderEditBody = OrdinaryOpBody | SiteOpBody;
export type OpOf<K extends FolderEditBody['kind']> = Extract<FolderEditBody, { kind: K }>;

export type FailReason = 'not_loaded' | 'read_only' | 'reload_required' | 'storage_error';

/** What a command resolves with. */
export type EditOutcome =
  | OpOutcome
  /** Never reached a decision. `detail`: text a legacy error carried, shown as today. */
  | { kind: 'failed'; reason: FailReason; messageKey: TranslationKey; detail?: string }
  /** A legacy fire-and-forget save (§8.5): applied in memory, persistence not reported. */
  | { kind: 'unconfirmed' };

export type FolderCommandsStatus =
  | 'reconciling'
  | 'loading'
  | 'ready'
  | 'delayed'
  | 'read_only'
  | 'reload_required';

/** `unconfirmed` is not saved: branch on this only where the backend can report `saved`. */
export function isSaved(outcome: EditOutcome): boolean {
  return outcome.kind === 'saved' || outcome.kind === 'unchanged';
}

export interface FolderCommands {
  status(): FolderCommandsStatus;
  view(): FolderData;
  /** Updates the view synchronously; resolves once the outcome is known. Most callers do not await. */
  run(body: FolderEditBody): Promise<EditOutcome>;
  /** Whole-data operations; dialogs await them and stay open unless saved. */
  runBulk(body: BulkOpBody): Promise<EditOutcome>;
  /** Resolves when every op run so far has an outcome. */
  flush(): Promise<void>;
}

const FAIL_KEYS: Record<FailReason, TranslationKey> = {
  not_loaded: 'folder_save_error',
  read_only: 'folder_save_error',
  reload_required: 'folder_save_error',
  storage_error: 'folder_save_error',
};

export function failed(reason: FailReason, detail?: string): EditOutcome {
  return { kind: 'failed', reason, messageKey: FAIL_KEYS[reason], ...(detail ? { detail } : {}) };
}

export const UNCONFIRMED: EditOutcome = { kind: 'unconfirmed' };
export const NOOP: EditOutcome = { kind: 'unchanged', reason: 'noop' };

/** A legacy void command's outcome: its store no-ops without edit rights, else it saved in the background. */
export const legacyOutcome = (editable: boolean): EditOutcome =>
  editable ? UNCONFIRMED : failed('read_only');
