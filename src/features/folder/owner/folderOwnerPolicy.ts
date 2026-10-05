import { StorageKeys } from '@/core/types/common';
import type { ConversationReference } from '@/core/types/folder';
import { AISTUDIO_ROOT_BUCKET_ID, ROOT_CONVERSATIONS_ID } from '@/features/folder/constants';
import { EXACT_CONVERSATION_IDENTITY } from '@/features/folder/model/conversationStars';
import {
  conversationKeys,
  normalizeConversationId,
} from '@/features/folder/model/folderConversationIdentity';
import type { ConversationPlacement } from '@/features/folder/model/placeConversations';
import { FOLDER_PLATFORMS } from '@/features/folder/platforms';

/** Every site whose folder bucket the owner may write; the same ids as `FolderPlatform`. */
export type FolderSite = 'gemini' | 'aistudio' | 'chatgpt';

export type AddVia = 'native-menu' | 'project' | 'picker' | 'outside-drop';

/**
 * Per-site rules the owner applies; never chosen by a client. Values keep each
 * site's behavior today (`folders-timeline-ui.md`, the per-entry-point rules).
 */
export interface FolderSitePolicy {
  site: FolderSite;
  /** Page hosts whose content scripts may name this site's keys. */
  hosts: readonly string[];
  /** The bucket for conversations outside any folder: a valid target without a folder. */
  rootBucketId: string;
  /** Every key a stored record answers to. */
  keysOf: (conversation: ConversationReference) => readonly string[];
  /** The key an id named by an op is looked up under (`null`: matches nothing). */
  idKey: (id: string) => string | null;
  /** Gemini moves stamp `addedAt`; AI Studio and ChatGPT keep the stored one. */
  resetAddedAtOnMove: boolean;
  /** AI Studio: a conversation lives in one bucket, kept in array order, stored record preferred. */
  singleBucket: boolean;
  addPlacement: (via: AddVia) => ConversationPlacement;
}

export const FOLDER_SITE_POLICIES: Readonly<Record<FolderSite, FolderSitePolicy>> = {
  gemini: {
    site: 'gemini',
    hosts: FOLDER_PLATFORMS.gemini.hosts,
    rootBucketId: ROOT_CONVERSATIONS_ID,
    keysOf: conversationKeys,
    idKey: normalizeConversationId,
    resetAddedAtOnMove: true,
    singleBucket: false,
    // The native menu and folder projects file at the top (`FolderStore.ts` addConversationToFolderFromNative).
    addPlacement: (via) => (via === 'outside-drop' ? 'append' : 'top'),
  },
  aistudio: {
    site: 'aistudio',
    hosts: FOLDER_PLATFORMS.aistudio.hosts,
    rootBucketId: AISTUDIO_ROOT_BUCKET_ID,
    keysOf: EXACT_CONVERSATION_IDENTITY.keysOf,
    idKey: EXACT_CONVERSATION_IDENTITY.idKey,
    resetAddedAtOnMove: false,
    singleBucket: true,
    addPlacement: () => 'keep',
  },
  chatgpt: {
    site: 'chatgpt',
    hosts: ['chatgpt.com'],
    rootBucketId: ROOT_CONVERSATIONS_ID,
    keysOf: EXACT_CONVERSATION_IDENTITY.keysOf,
    idKey: EXACT_CONVERSATION_IDENTITY.idKey,
    resetAddedAtOnMove: false,
    singleBucket: false,
    addPlacement: (via) => (via === 'outside-drop' ? 'append' : 'top'),
  },
};

const ACCOUNT_SUFFIX = /^:acct:[0-9a-z]{1,7}$/;

/**
 * The site whose folder key family `key` belongs to: the base key, or for
 * Gemini and AI Studio `base:acct:<hash>`. Matching is exact, never by prefix,
 * so sidecars such as `gvFolderDataAIStudio:legacySyncImported` name no site.
 */
export function siteOfFolderKey(key: string): FolderSite | null {
  if (key === StorageKeys.FOLDER_DATA_CHATGPT) return 'chatgpt';
  for (const site of ['gemini', 'aistudio'] as const) {
    const base = FOLDER_PLATFORMS[site].folderStorageKey;
    if (key === base) return site;
    if (key.startsWith(base) && ACCOUNT_SUFFIX.test(key.slice(base.length))) return site;
  }
  return null;
}
