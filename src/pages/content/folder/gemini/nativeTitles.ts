/**
 * Gemini's own chat titles in the folders: a pass over the sidebar's rows
 * carries each native title to the records of that chat, and undoing a rename
 * from a folder row drops the folder's own title for the native one. Records a
 * user renamed in the folders keep their title in a pass.
 */
import { applyNativeTitle, indexConversationsByRouteId } from '../conversationTitleSync';
import { isSameConversation, normalizeConversationId } from '../folderConversationIdentity';
import {
  extractConversationIdFromElement,
  extractNativeConversationId,
} from '../nativeConversationIds';
import { extractNativeConversationTitle } from '../nativeConversationTitles';
import { packagedConversationRows } from '../sidebarConversationQueries';
import type { ConversationReference, FolderData } from '../types';

type FolderContents = Record<string, ConversationReference[]>;

/** Every record, in every folder, of the chat `conversationId` names. */
export function recordsOfConversation(
  folderContents: FolderContents,
  conversationId: string,
): ConversationReference[] {
  return Object.values(folderContents)
    .flat()
    .filter((conv) => isSameConversation(conversationId, conv));
}

/** Applies the sidebar rows' titles; returns whether any record changed. */
export function applySidebarTitles(
  folderContents: FolderContents,
  sidebar: HTMLElement | null,
  updatedAt: number,
): boolean {
  let updated = false;
  // One index per pass: O(stored + rows + matches); see indexConversationsByRouteId.
  const index = indexConversationsByRouteId(folderContents);
  for (const convEl of Array.from(packagedConversationRows(sidebar))) {
    const element = convEl as HTMLElement;
    const conversationId =
      extractNativeConversationId(element) || extractConversationIdFromElement(element);
    const matches = index.get(normalizeConversationId(conversationId) ?? '');
    if (!matches) continue;
    const title = extractNativeConversationTitle(element);
    if (!title) continue;

    updated = applyNativeTitle(matches, title, updatedAt) || updated;
  }
  return updated;
}

/** Drops the folders' own title of a chat for `nativeTitle`; returns whether any record changed. */
export function restoreNativeTitle(
  folderContents: FolderContents,
  conversationId: string,
  nativeTitle: string | null,
  updatedAt: number,
): boolean {
  const title = nativeTitle?.trim() || null;
  let updated = false;

  for (const conversation of recordsOfConversation(folderContents, conversationId)) {
    if (conversation.customTitle) {
      delete conversation.customTitle;
      updated = true;
    }

    if (title && conversation.title !== title) {
      conversation.title = title;
      conversation.updatedAt = updatedAt;
      updated = true;
    }
  }
  return updated;
}

export interface NativeTitleHost {
  /** The folders the titles go to; resolved on every call. */
  data(): FolderData;
  canEdit(): boolean;
  /** Gemini's sidebar, whose rows a pass reads. */
  sidebar(): HTMLElement | null;
  /** Changes whenever the folders are rebound to another session or account. */
  binding(): readonly unknown[];
  saveData(): Promise<boolean>;
  /** Titles changed and were saved. */
  onTitlesChanged(): void;
}

/**
 * The titles Gemini's sidebar and folder rows give filed chats: buffered row
 * renames saved together, a pass over the sidebar's rows, one chat's new
 * title, and undoing a folder rename.
 */
export class GeminiNativeTitles {
  private syncing = false;
  private readonly pending = new Map<string, string>();

  constructor(private readonly host: NativeTitleHost) {}

  /** The account was released: its buffered titles go with it. */
  clear(): void {
    this.pending.clear();
  }

  buffer(conversation: ConversationReference, title: string): void {
    if (!this.host.canEdit()) return;
    conversation.title = title;
    this.pending.set(conversation.conversationId, title);
  }

  flush(): void {
    if (this.pending.size === 0) return;
    const binding = this.host.binding();
    void this.host
      .saveData()
      .then((saved) => {
        const current = this.host.binding();
        if (saved && binding.every((value, index) => current[index] === value)) {
          this.pending.clear();
        }
      })
      .catch((error) =>
        console.error('[FolderStore] Failed to save pending title updates:', error),
      );
  }

  async syncSidebar(): Promise<void> {
    if (this.syncing) return;
    const { folderContents } = this.host.data();
    const hasStored = Object.values(folderContents).some((records) => records.length > 0);
    if (!hasStored || !this.host.canEdit()) return;

    this.syncing = true;
    try {
      if (!applySidebarTitles(folderContents, this.host.sidebar(), Date.now())) return;
      await this.host.saveData();
      this.host.onTitlesChanged();
    } finally {
      this.syncing = false;
    }
  }

  update(conversationId: string, newTitle: string): void {
    if (!this.host.canEdit()) return;
    const matches = recordsOfConversation(this.host.data().folderContents, conversationId);
    if (!applyNativeTitle(matches, newTitle, Date.now())) return;

    void this.host.saveData();
    // Re-render folders to show updated title
    this.host.onTitlesChanged();
  }

  async restore(conversationId: string, nativeTitle: string | null): Promise<void> {
    if (!this.host.canEdit()) return;
    const { folderContents } = this.host.data();
    if (!restoreNativeTitle(folderContents, conversationId, nativeTitle, Date.now())) return;

    await this.host.saveData();
    this.host.onTitlesChanged();
  }
}
