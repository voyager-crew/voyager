import { resolveGeminiAnswerElement } from '@/core/gemini/content/reads';
import type { GeminiSelectorView } from '@/core/gemini/selectors';
/**
 * Reads the conversation shown on the page into export turns and selectable messages.
 *
 * All host-specific selectors come from the export adapter. This module owns
 * the DOM heuristics shared by every caller: document-order pairing, skipping
 * Gemini's thinking panel and Deep Research immersive nodes, starred-turn
 * lookup, and appending Canvas document content to responses that reference it.
 */
import {
  type ContentExtractor,
  createContentExtractor,
  extractTurnContent,
} from '@/features/export/services/DOMContentExtractor';
import { queryOutsideThoughts } from '@/features/export/services/exportDomPolicy';
import type { CanvasDoc, ChatTurn as ExportChatTurn } from '@/features/export/types/export';

import { isServerTurnId } from '../fork/turnId';
import { historyTimestampStore } from '../timestamp/historyTimestamps';
import { buildGeminiAdapter } from './adapter/platform/gemini';
import type { ExportPlatformAdapter } from './adapter/platformAdapters';
import { assistantHasCanvasDoc, extractAllCanvasDocs, isAnyCanvasOpen } from './canvasDocExtractor';
import { findAssistantForTurn, pickAssistantExportElement } from './conversationDom';
import {
  resolveConversationTurnOperation,
  type ConversationTurnDom,
} from './conversationTurnOperation';
import { resolveUniqueExportTurnIds } from './selectionIds';
import { groupSelectedMessagesByTurn } from './selectionUtils';
import { geminiConversationIdFromLocation } from './sidebarConversationNavigation';

const CANVAS_EXPORT_SECTION_CLASS = 'gv-canvas-export-section';

export type ChatTurn = {
  turnId: string;
  user: string;
  assistant: string;
  starred: boolean;
  userElement?: HTMLElement;
  assistantElement?: HTMLElement;
  assistantHostElement?: HTMLElement;
};

export type ExportMessageRole = 'user' | 'assistant' | 'unknown';

/** One selectable message: `${turnId}:u` / `${turnId}:a`, or an adapter turn-container id. */
export type ExportMessage = {
  messageId: string;
  role: ExportMessageRole;
  hostElement: HTMLElement;
  exportElement?: HTMLElement;
  text: string;
  starred: boolean;
};

export interface ConversationCollector {
  /** User/assistant pairs in document order. Appends Canvas sections to responses (once). */
  collectChatPairs(): ChatTurn[];
  /** Selectable messages for the current page, in reading order. */
  collectSelectionMessages(): ExportMessage[];
  /** Export turns for the given message ids, read fresh from the page. Empty turns are dropped. */
  turnsForMessageIds(
    selectedMessageIds: ReadonlySet<string>,
    starredIds?: ReadonlySet<string>,
  ): ExportChatTurn[];
  /** Message id of the response that owns a response-menu trigger, or null. */
  assistantMessageIdFor(trigger: HTMLElement | null): string | null;
  /** First top-level user turn inside the conversation root. */
  topUserElement(): HTMLElement | null;
  conversationRoot(): HTMLElement;
  /**
   * Remember open Canvas documents so their content still exports after the
   * preload loop scrolls or re-renders the page and closes the panel.
   */
  snapshotOpenCanvasDocs(): void;
  /** Forget the snapshot and remove every appended Canvas section. */
  releaseCanvasDocs(): void;
}

/** Remove Canvas sections appended to responses during an export. */
export function removeCanvasExportSections(): void {
  document.querySelectorAll(`.${CANVAS_EXPORT_SECTION_CLASS}`).forEach((el) => el.remove());
}

function normalizeText(text: string | null): string {
  try {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

function extractAssistantText(el: HTMLElement, view?: GeminiSelectorView): string {
  // Prefer direct text from message container if available (connected to DOM)
  // Use queryOutsideThoughts to avoid matching the message-content inside
  // the expanded thinking/reasoning panel.
  try {
    const bundled = () =>
      queryOutsideThoughts<HTMLElement>(el, 'message-content, .markdown, .markdown-main-panel') ??
      el;
    const mc = view ? resolveGeminiAnswerElement(el, bundled, view) : bundled();
    if (mc !== el) {
      const raw = mc.textContent || mc.innerText || '';
      const txt = normalizeText(raw);
      if (txt) return txt;
    }
  } catch {}

  // Clone and remove reasoning toggles/labels before reading text (detached fallback)
  const clone = el.cloneNode(true) as HTMLElement;
  const matchesReasonToggle = (txt: string): boolean => {
    const s = normalizeText(txt).toLowerCase();
    if (!s) return false;
    return (
      /^(show\s*(thinking|reasoning)|hide\s*(thinking|reasoning))$/i.test(s) ||
      /^(显示\s*(思路|推理)|隐藏\s*(思路|推理))$/u.test(s)
    );
  };
  const shouldDrop = (node: HTMLElement): boolean => {
    const role = (node.getAttribute('role') || '').toLowerCase();
    const aria = (node.getAttribute('aria-label') || '').toLowerCase();
    const txt = node.textContent || '';
    if (matchesReasonToggle(txt)) return true;
    if (role === 'button' && (/thinking|reasoning/i.test(txt) || /思路|推理/u.test(txt)))
      return true;
    if (/thinking|reasoning/i.test(aria) || /思路|推理/u.test(aria)) return true;
    return false;
  };
  try {
    const candidates = clone.querySelectorAll(
      'button, [role="button"], [aria-label], span, div, a',
    );
    candidates.forEach((n) => {
      const eln = n as HTMLElement;
      if (shouldDrop(eln)) eln.remove();
    });
  } catch {}
  const text = normalizeText(clone.innerText || clone.textContent || '');
  return text;
}

function appendCanvasDocSections(targetContainer: Element, canvasDocs: readonly CanvasDoc[]): void {
  for (const doc of canvasDocs) {
    const section = document.createElement('div');
    section.className = CANVAS_EXPORT_SECTION_CLASS;
    const heading = document.createElement('h3');
    heading.textContent = `📄 Canvas Document: ${doc.title}`;
    const content = document.createElement('div');
    content.className = 'gv-canvas-content';
    content.textContent = doc.content;
    section.appendChild(heading);
    section.appendChild(content);
    targetContainer.appendChild(section);
  }
}

function buildExportMessagesFromPairs(pairs: ChatTurn[]): ExportMessage[] {
  const out: ExportMessage[] = [];
  pairs.forEach((pair) => {
    if (pair.userElement) {
      out.push({
        messageId: `${pair.turnId}:u`,
        role: 'user',
        hostElement: pair.userElement,
        exportElement: pair.userElement,
        text: pair.user,
        starred: pair.starred,
      });
    }

    const assistantHost = pair.assistantHostElement;
    if (assistantHost) {
      out.push({
        messageId: `${pair.turnId}:a`,
        role: 'assistant',
        hostElement: assistantHost,
        exportElement: pair.assistantElement || assistantHost,
        text: pair.assistant,
        starred: pair.starred,
      });
    }
  });
  return out;
}

/** Turns read once from the page, after Canvas sections were appended to their responses. */
function buildTurnsForSelectedMessages(
  selectedMessages: readonly ExportMessage[],
  extractor: ContentExtractor,
): ExportChatTurn[] {
  const groupedTurns = groupSelectedMessagesByTurn(
    selectedMessages.filter(
      (message): message is ExportMessage & { role: Exclude<ExportMessageRole, 'unknown'> } =>
        message.role !== 'unknown',
    ),
  );
  return groupedTurns
    .map((turn) => ({
      user: turn.user?.text || '',
      assistant: turn.assistant?.text || '',
      starred: turn.starred,
      omitEmptySections: true,
      userElement: turn.user?.exportElement,
      assistantElement: turn.assistant?.exportElement,
    }))
    .filter(
      (turn) =>
        turn.user.length > 0 ||
        turn.assistant.length > 0 ||
        !!turn.userElement ||
        !!turn.assistantElement,
    )
    .map((turn) => extractTurnContent(turn, extractor));
}

export function createConversationCollector(adapter: ExportPlatformAdapter): ConversationCollector {
  const extractor = createContentExtractor(adapter);
  let cachedCanvasDocs: CanvasDoc[] | null = null;

  const conversationRoot = (): HTMLElement =>
    resolveConversationTurnOperation(
      adapter,
      (turns) => turns,
      ({ users }) => users.length > 0,
    ).root;

  const topUserElement = (): HTMLElement | null =>
    resolveConversationTurnOperation(
      adapter,
      ({ users }) => users[0] ?? null,
      (user) => user !== null,
    );

  const readChatPairs = (
    { users, assistants, userSelector, assistantSelector, view }: ConversationTurnDom,
    starredIds: ReadonlySet<string>,
  ): ChatTurn[] => {
    if (users.length === 0) return [];

    const uniqueTurnIds = resolveUniqueExportTurnIds(users);

    const nativeConversationId = geminiConversationIdFromLocation();
    const pairs: ChatTurn[] = [];

    for (let i = 0; i < users.length; i++) {
      const uEl = users[i] as HTMLElement;
      const uText = normalizeText(uEl.innerText || uEl.textContent || '');
      const aEl = findAssistantForTurn(
        uEl,
        users[i + 1],
        assistants,
        userSelector,
        assistantSelector,
      );
      const aText = aEl ? extractAssistantText(aEl, view) : '';
      const turnId = uniqueTurnIds[i];
      const turnIdAliases =
        turnId && nativeConversationId && isServerTurnId(turnId)
          ? historyTimestampStore.getTurnIdAliases(nativeConversationId, turnId)
          : turnId && isServerTurnId(turnId)
            ? [turnId]
            : [];
      const starred = turnIdAliases.some((alias) => starredIds.has(alias));
      if (uText || aText) {
        const finalAssistantEl = aEl ? pickAssistantExportElement(aEl, view) : undefined;
        pairs.push({
          turnId,
          user: uText,
          assistant: aText,
          starred,
          userElement: uEl,
          assistantElement: finalAssistantEl,
          assistantHostElement: aEl || undefined,
        });
      }
    }
    return pairs;
  };

  const collectWithExtractor = (starredIds: ReadonlySet<string> = new Set()) => {
    const { pairs, view } = resolveConversationTurnOperation(
      adapter,
      (turns) => ({ pairs: readChatPairs(turns, starredIds), view: turns.view }),
      (result) => result.pairs.length > 0,
    );
    // Only the accepted read may append Canvas content to the live response.
    for (const { assistantHostElement: host, assistantElement: target } of pairs) {
      if (
        !host ||
        !target ||
        !assistantHasCanvasDoc(host) ||
        !(isAnyCanvasOpen() || (cachedCanvasDocs && cachedCanvasDocs.length > 0)) ||
        target.querySelector(`.${CANVAS_EXPORT_SECTION_CLASS}`)
      )
        continue;
      const docs = cachedCanvasDocs?.length ? cachedCanvasDocs : extractAllCanvasDocs();
      if (docs.length > 0) {
        appendCanvasDocSections(
          target.querySelector('.markdown, .markdown-main-panel') || target,
          docs,
        );
      }
    }
    return {
      pairs,
      extractor:
        adapter.site.id === 'gemini'
          ? createContentExtractor(buildGeminiAdapter(adapter.site, view))
          : extractor,
    };
  };

  const collectChatPairs = (starredIds?: ReadonlySet<string>): ChatTurn[] =>
    collectWithExtractor(starredIds).pairs;

  const selectionMessagesFromPairs = (pairsInput: ChatTurn[]): ExportMessage[] => {
    const messages = buildExportMessagesFromPairs(pairsInput);
    return messages
      .map((message) => {
        const rect = message.hostElement.getBoundingClientRect();
        return {
          ...message,
          absTop: rect.top + window.scrollY,
        };
      })
      .sort((a, b) => a.absTop - b.absTop);
  };

  return {
    collectChatPairs,
    collectSelectionMessages: () => selectionMessagesFromPairs(collectChatPairs()),
    turnsForMessageIds: (selectedMessageIds, starredIds) => {
      const { pairs, extractor: acceptedExtractor } = collectWithExtractor(starredIds);
      if (selectedMessageIds.size === 0) return [];
      const selectedMessages = selectionMessagesFromPairs(pairs).filter((message) =>
        selectedMessageIds.has(message.messageId),
      );
      return buildTurnsForSelectedMessages(selectedMessages, acceptedExtractor);
    },
    assistantMessageIdFor: (trigger) => {
      if (!trigger) return null;

      const assistantHost = trigger.closest(
        '.response-container, response-container, .model-response, model-response',
      ) as HTMLElement | null;
      if (!assistantHost) return null;

      const messages = buildExportMessagesFromPairs(collectChatPairs());
      const target = messages.find((message) => {
        if (message.role !== 'assistant') return false;
        const host = message.hostElement;
        return (
          host === assistantHost ||
          host.contains(assistantHost) ||
          assistantHost.contains(host) ||
          host.contains(trigger)
        );
      });

      return target?.messageId || null;
    },
    topUserElement,
    conversationRoot,
    snapshotOpenCanvasDocs: () => {
      if (isAnyCanvasOpen()) cachedCanvasDocs = extractAllCanvasDocs();
    },
    releaseCanvasDocs: () => {
      cachedCanvasDocs = null;
      removeCanvasExportSections();
    },
  };
}
