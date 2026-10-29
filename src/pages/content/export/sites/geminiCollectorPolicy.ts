import { resolveGeminiAnswerElement } from '@/core/gemini/content/reads';
import {
  GEMINI_TURN_PROFILE_KEYS,
  getGeminiSelectorView,
  type GeminiSelectorView,
} from '@/core/gemini/selectors';
import { createContentExtractor } from '@/features/export/services/DOMContentExtractor';
import { queryOutsideThoughts } from '@/features/export/services/exportDomPolicy';
import {
  getExportReadProfiles,
  type ExportReadProfiles,
} from '@/features/export/services/exportSiteData';

import { isServerTurnId } from '../../fork/turnId';
import { historyTimestampStore } from '../../timestamp/historyTimestamps';
import { buildGeminiAdapter } from '../adapter/platform/gemini';
import type { ExportPlatformAdapter } from '../adapter/platformAdapters';
import {
  assistantHasCanvasDoc,
  extractAllCanvasDocs,
  isAnyCanvasOpen,
} from '../canvasDocExtractor';
import type { ChatTurn } from '../conversationCollector';
import { pickAssistantExportElement } from '../conversationDom';
import {
  resolveConversationTurnOperation,
  type ConversationTurnDom,
} from '../conversationTurnOperation';
import { geminiConversationIdFromLocation } from '../sidebarConversationNavigation';
import type { ConversationCollectorPolicy } from './collectorPolicy';
import {
  createInPlaceCollection,
  normalizeCollectedText,
  readPairedConversation,
  type InPlaceReadOperation,
} from './inPlaceCollection';

/** The historical compatibility reader also keeps this packaged Canvas grammar. */
export function geminiShapedCanvasReader(adapter: ExportPlatformAdapter) {
  return adapter.canvas ?? { assistantHasCanvasDoc, extractAllCanvasDocs, isAnyCanvasOpen };
}

function extractAssistantText(
  el: HTMLElement,
  profiles: ExportReadProfiles,
  view?: GeminiSelectorView,
): string {
  try {
    const bundled = () =>
      queryOutsideThoughts<HTMLElement>(el, profiles['export.collectorAnswer']) ?? el;
    const content = view ? resolveGeminiAnswerElement(el, bundled, view) : bundled();
    if (content !== el) {
      const text = normalizeCollectedText(content.textContent || content.innerText || '');
      if (text) return text;
    }
  } catch {}

  // The detached fallback keeps reasoning toggles and their labels out of the summary.
  const clone = el.cloneNode(true) as HTMLElement;
  const matchesReasonToggle = (text: string): boolean => {
    const value = normalizeCollectedText(text).toLowerCase();
    if (!value) return false;
    return (
      /^(show\s*(thinking|reasoning)|hide\s*(thinking|reasoning))$/i.test(value) ||
      /^(显示\s*(思路|推理)|隐藏\s*(思路|推理))$/u.test(value)
    );
  };
  const shouldDrop = (node: HTMLElement): boolean => {
    const role = (node.getAttribute('role') || '').toLowerCase();
    const aria = (node.getAttribute('aria-label') || '').toLowerCase();
    const text = node.textContent || '';
    if (matchesReasonToggle(text)) return true;
    if (role === 'button' && (/thinking|reasoning/i.test(text) || /思路|推理/u.test(text)))
      return true;
    if (/thinking|reasoning/i.test(aria) || /思路|推理/u.test(aria)) return true;
    return false;
  };
  try {
    clone
      .querySelectorAll<HTMLElement>('button, [role="button"], [aria-label], span, div, a')
      .forEach((node) => {
        if (shouldDrop(node)) node.remove();
      });
  } catch {}
  return normalizeCollectedText(clone.innerText || clone.textContent || '');
}

/** Gemini content rules, also reused explicitly by the unchanged unknown-host compatibility reader. */
export function readGeminiShapedPairs(
  adapter: ExportPlatformAdapter,
  turns: ConversationTurnDom,
  starredIds: ReadonlySet<string>,
): ChatTurn[] {
  if (turns.users.length === 0) return [];
  const profiles = getExportReadProfiles(adapter.site.id);
  const nativeConversationId = geminiConversationIdFromLocation();
  return readPairedConversation(turns, (user, assistant, turnId) => {
    const userText = normalizeCollectedText(user.innerText || user.textContent || '');
    const assistantText = assistant ? extractAssistantText(assistant, profiles, turns.view) : '';
    const aliases =
      turnId && nativeConversationId && isServerTurnId(turnId)
        ? historyTimestampStore.getTurnIdAliases(nativeConversationId, turnId)
        : turnId && isServerTurnId(turnId)
          ? [turnId]
          : [];
    const starred = aliases.some((alias) => starredIds.has(alias));
    if (!userText && !assistantText) return null;
    const assistantElement = assistant
      ? (adapter.selectAssistantExportElement?.(assistant) ??
        pickAssistantExportElement(assistant, turns.view))
      : undefined;
    return {
      turnId,
      user: userText,
      assistant: assistantText,
      starred,
      userElement: user,
      assistantElement,
      assistantHostElement: assistant || undefined,
    };
  });
}

/** Whole-turn proof excludes immersive reports and keeps thinking, Canvas and accepted content together. */
export function createGeminiCollectorPolicy(
  adapter: ExportPlatformAdapter,
): ConversationCollectorPolicy {
  const profiles = getExportReadProfiles(adapter.site.id);
  const read: InPlaceReadOperation = (operation, isUsable) =>
    resolveConversationTurnOperation(
      adapter,
      (turns) =>
        operation({
          root: turns.root,
          users: turns.users,
          collect: (starredIds) => ({
            pairs: readGeminiShapedPairs(adapter, turns, starredIds),
            createExtractor: () =>
              createContentExtractor(buildGeminiAdapter(adapter.site, turns.view)),
          }),
        }),
      isUsable,
    );
  return createInPlaceCollection({
    read,
    canvas: geminiShapedCanvasReader(adapter),
    markdownSelector: profiles['export.walkMarkdown'],
    responseOwner: (trigger) => {
      if (GEMINI_TURN_PROFILE_KEYS.some((key) => getGeminiSelectorView().remoteKeys.has(key))) {
        return { kind: 'trigger' };
      }
      const element = trigger.closest<HTMLElement>(profiles['export.menuResponseOwner']);
      return element ? { kind: 'response', element } : null;
    },
  });
}
