import { createContentExtractor } from '@/features/export/services/DOMContentExtractor';
import type { ChatTurn } from '@/features/export/types/export';
import { chatGptTurnHash, loadChatGptStarHashes } from '@/features/savedLibrary/exportStars';

import type { ExportMessage } from '../conversationCollector';
import type { ExportTurnReader } from '../exportSite';
import { chatgptTurnSelector } from './chatgptExportData';
import {
  chatgptLoggedOutAssistantSelector,
  chatgptStreamingSelector,
} from './chatgptExportLocators';
import { LOGGED_OUT_MESSAGE_SELECTOR, resolveChatGptLoggedOutThread } from './chatgptLoggedOutDom';
import { assertActive } from './chatgptShared';
import {
  isChatGptThreadGenerating,
  isRendered,
  resolveVisibleConversationRoot,
} from './chatgptThread';
import type { ExportPlatformAdapter } from './platform/contract';
import type { ExportSelectionOptions } from './type';

/**
 * A reply still streaming: its message carries `data-message-streaming` with an
 * empty value (measured live). Its Stop button sits outside `main`, where the
 * desktop check looks, so that check alone never fires on this page.
 */

/**
 * Reads ChatGPT's logged-out conversation page (see `chatgptLoggedOutDom.ts`),
 * which keeps every message in the DOM in order, without the desktop virtual list.
 */
export function createChatGptLoggedOutReader(
  adapter: ExportPlatformAdapter,
): ExportTurnReader & Required<Pick<ExportTurnReader, 'roles'>> {
  const extractor = createContentExtractor(adapter);
  const fallbackIds = new WeakMap<HTMLElement, string>();
  let nextId = 0;

  function messages(): ExportMessage[] {
    const thread = resolveChatGptLoggedOutThread();
    if (!thread) return [];
    const seen = new Set<string>();
    return Array.from(thread.querySelectorAll<HTMLElement>(LOGGED_OUT_MESSAGE_SELECTOR)).flatMap(
      (hostElement) => {
        if (!isRendered(hostElement)) return [];
        if (hostElement.parentElement?.closest(LOGGED_OUT_MESSAGE_SELECTOR)) return [];
        const role = hostElement.getAttribute('data-message-role');
        if (role !== 'user' && role !== 'assistant') return [];
        const selector =
          role === 'user'
            ? chatgptTurnSelector('userTurn')
            : chatgptLoggedOutAssistantSelector(thread);
        const exportElement = hostElement.matches(selector)
          ? hostElement
          : hostElement.querySelector<HTMLElement>(selector);
        if (!exportElement) return [];
        const nativeId =
          hostElement.id.trim() || hostElement.getAttribute('data-message-id')?.trim();
        let messageId = nativeId
          ? `logged-out-id:${role}:${nativeId}`
          : fallbackIds.get(hostElement);
        if (!messageId) {
          messageId = `logged-out-node:${++nextId}`;
          fallbackIds.set(hostElement, messageId);
        }
        // Reconciliation can briefly retain two wrappers for the same native message.
        if (seen.has(messageId)) return [];
        seen.add(messageId);
        return [{ messageId, role, hostElement, exportElement, text: '', starred: false }];
      },
    );
  }

  function selection(selectedIds: ReadonlySet<string>): ExportMessage[] {
    const current = messages();
    const known = new Set(current.map((message) => message.messageId));
    const missing = Array.from(selectedIds).filter((id) => !known.has(id));
    if (missing.length > 0) throw new Error(`chatgpt_export_messages_missing:${missing.join(',')}`);
    return current;
  }

  return {
    messages,
    async roles(selectedIds, options) {
      assertActive(options);
      return new Map(
        selection(selectedIds)
          .filter((message) => selectedIds.has(message.messageId))
          .map((message) => [message.messageId, message.role]),
      );
    },
    async build(selectedIds, options: ExportSelectionOptions) {
      const captured = { ...options, expectedUrl: options.expectedUrl ?? location.href };
      assertActive(captured);
      selection(selectedIds);
      const hashes = await loadChatGptStarHashes(captured.expectedUrl);
      assertActive(captured);
      if (
        resolveChatGptLoggedOutThread()?.querySelector(chatgptStreamingSelector(true)) ||
        isChatGptThreadGenerating(resolveVisibleConversationRoot())
      ) {
        throw new Error('chatgpt_export_response_still_generating');
      }
      const current = selection(selectedIds);
      const turns: ChatTurn[] = [];
      let pending: { turn: ChatTurn; sequence: number } | null = null;
      for (const [sequence, message] of current.entries()) {
        if (!selectedIds.has(message.messageId)) continue;
        // Logged-out role wrappers also hold Copy/Edit controls; only export the message root.
        const element = message.exportElement!;
        const content =
          message.role === 'user'
            ? extractor.extractUserContent(element)
            : extractor.extractAssistantContent(element);
        if (!content.text && !content.html && content.attachments.length === 0) {
          throw new Error(`chatgpt_export_message_empty:${message.messageId}`);
        }
        const prompt = message.role === 'user' ? message : current[sequence - 1];
        const starred =
          prompt?.role === 'user' &&
          !!prompt.exportElement &&
          hashes.has(chatGptTurnHash(prompt.exportElement));
        if (message.role === 'user') {
          if (pending) turns.push(pending.turn);
          pending = {
            sequence,
            turn: {
              user: content.text,
              assistant: '',
              userContent: content,
              attachments: content.attachments,
              starred,
              omitEmptySections: true,
            },
          };
        } else if (pending?.sequence === sequence - 1) {
          pending.turn.assistant = content.text;
          pending.turn.assistantContent = content;
          turns.push(pending.turn);
          pending = null;
        } else {
          if (pending) turns.push(pending.turn);
          pending = null;
          turns.push({
            user: '',
            assistant: content.text,
            assistantContent: content,
            starred,
            omitEmptySections: true,
          });
        }
      }
      if (pending) turns.push(pending.turn);
      return turns;
    },
  };
}
