/**
 * Service for managing starred messages across all conversations
 * Uses message passing to background script to prevent race conditions
 */
import { StorageKeys } from '@/core/types/common';
import type { SyncAccountScope } from '@/core/types/sync';

import { decodeStarredSnapshot, normalizeStarredMessages } from './starData';
import type { StarSyncSources } from './starSyncPayload';
import type { StarredMessage, StarredMessagesData } from './starTypes';

export class StarredMessagesService {
  /**
   * Send message to background script and wait for response
   */
  private static async sendMessage<T>(type: string, payload?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response || !response.ok) {
          reject(new Error(response?.error || 'Operation failed'));
          return;
        }
        resolve(response as T);
      });
    });
  }

  static decodeStorageChange(
    area: string,
    changes: Record<string, unknown>,
  ): StarredMessagesData | undefined {
    if (area !== 'local') return undefined;
    const change = changes[StorageKeys.SAVED_LIBRARY_STARS];
    if (!change || typeof change !== 'object' || Array.isArray(change)) return undefined;
    if ('newValue' in change) {
      return change.newValue === undefined
        ? normalizeStarredMessages(undefined)
        : decodeStarredSnapshot(change.newValue);
    }
    return 'oldValue' in change ? normalizeStarredMessages(undefined) : undefined;
  }

  /**
   * Get all starred messages from storage
   */
  static async getAllStarredMessages(): Promise<StarredMessagesData> {
    const response = await this.sendMessage<{ ok: boolean; data: StarredMessagesData }>(
      'gv.starred.getAll',
    );
    return normalizeStarredMessages(response.data);
  }

  /**
   * Get starred messages for a specific conversation
   */
  static async getStarredMessagesForConversation(
    conversationId: string,
  ): Promise<StarredMessage[]> {
    const response = await this.sendMessage<{ ok: boolean; messages: StarredMessage[] }>(
      'gv.starred.getForConversation',
      { conversationId },
    );
    return normalizeStarredMessages({ messages: { [conversationId]: response.messages } }).messages[
      conversationId
    ];
  }

  /**
   * Add a starred message - delegated to background script
   */
  static async addStarredMessage(message: StarredMessage): Promise<void> {
    await this.sendMessage('gv.starred.add', message);
  }

  static async backfillStarredTexts(
    conversationId: string,
    entries: Array<{ turnId: string; text: string }>,
  ): Promise<void> {
    await this.sendMessage('gv.starred.backfillTexts', { conversationId, entries });
  }

  static async removeStarredMessage(conversationId: string, turnId: string): Promise<void> {
    await this.sendMessage('gv.starred.remove', { conversationId, turnId });
  }

  static async mergeCloud(
    envelope: unknown,
  ): Promise<{ status: 'absent' | 'merged'; count: number }> {
    const response = await this.sendMessage<{
      ok: boolean;
      status: 'absent' | 'merged';
      count: number;
    }>('gv.starred.mergeCloud', envelope);
    return { status: response.status, count: response.count };
  }

  static async mergeSync(
    sources: StarSyncSources,
    accountScope: SyncAccountScope | null,
    snapshotId?: string,
  ): Promise<{ status: 'absent' | 'merged'; count: number }> {
    const response = await this.sendMessage<{
      ok: boolean;
      status: 'absent' | 'merged';
      count: number;
    }>('gv.starred.mergeSync', {
      ...sources,
      accountScope,
      ...(snapshotId === undefined ? {} : { snapshotId }),
    });
    return { status: response.status, count: response.count };
  }

  /**
   * Check if a message is starred
   */
  static async isMessageStarred(conversationId: string, turnId: string): Promise<boolean> {
    const messages = await this.getStarredMessagesForConversation(conversationId);
    return messages.some((m) => m.turnId === turnId);
  }

  /**
   * Get all starred messages sorted by timestamp (newest first)
   */
  static async getAllStarredMessagesSorted(): Promise<StarredMessage[]> {
    const data = await this.getAllStarredMessages();
    const allMessages: StarredMessage[] = [];

    Object.values(data.messages).forEach((messages) => {
      allMessages.push(...messages);
    });

    return allMessages.sort((a, b) => b.starredAt - a.starredAt);
  }

  /**
   * Merge legacy conversation IDs into the current stable conversation ID.
   */
  static async reconcileConversationIds(
    targetConversationId: string,
    sourceConversationIds: string[],
    conversationUrl: string,
  ): Promise<StarredMessage[]> {
    const response = await this.sendMessage<{ ok: boolean; messages: StarredMessage[] }>(
      'gv.starred.reconcileConversationIds',
      {
        targetConversationId,
        sourceConversationIds,
        conversationUrl,
      },
    );
    return normalizeStarredMessages({
      messages: { [targetConversationId]: response.messages },
    }).messages[targetConversationId];
  }
}
