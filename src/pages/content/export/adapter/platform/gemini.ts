import { GEMINI_PACKAGED_CONTENT } from '@/core/gemini/content/packaged';
import { resolveGeminiAnswerElement, readGeminiUserLines } from '@/core/gemini/content/reads';
import { getGeminiSelectorView, type GeminiSelectorView } from '@/core/gemini/selectors';
import {
  GEMINI_PACKAGED_TITLE_SELECTORS,
  readCorroboratedGeminiTitle,
  readGeminiActiveSidebarTitle,
} from '@/core/gemini/sidebarTitles';
import { resolveExportMessageContent } from '@/features/export/services/exportContentRoots';
import { getExportReadProfiles } from '@/features/export/services/exportSiteData';
import type { SiteAdapter } from '@/features/plugins/types';

import {
  geminiAssistantTurnSelectors,
  geminiUserTurnSelectors,
  resolveConversationRoot,
} from '../../conversationDom';
import type { ExportPlatformAdapter } from './contract';
import { checkedGeminiContentView } from './geminiContentView';
import {
  bundledGeminiSearchImageSelector,
  resolveGeminiSearchImageSelector,
} from './geminiImageRead';
import { collectGeminiAssistantImages, extractGeminiAssistantImage } from './geminiImages';
import {
  extractUserText,
  extractFormula,
  extractCodeBlock,
  extractInlineFormula,
} from './sharedContent';

function extractConversationId(): string | null {
  const appMatch = window.location.pathname.match(/\/app\/([^/?#]+)/);
  if (appMatch?.[1]) return appMatch[1];
  return window.location.pathname.match(/\/gem\/[^/]+\/([^/?#]+)/)?.[1] ?? null;
}

function isMeaningfulTitle(value: string | null | undefined): value is string {
  const title = (value || '').trim();
  if (!title) return false;
  if (
    ['Untitled Conversation', 'Gemini', 'Google Gemini', 'Google AI Studio', 'New chat'].includes(
      title,
    )
  ) {
    return false;
  }
  return !(title.startsWith('Gemini -') || title.startsWith('Google AI Studio -'));
}

function escapeCss(value: string): string {
  return globalThis.CSS?.escape?.(value) ?? value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function extractTitleFromConversationElement(
  element: HTMLElement,
  view: GeminiSelectorView,
): string | null {
  // Remote labels never change the packaged conversation-identity boundary.
  const scope = (element.closest('[data-test-id="conversation"]') as HTMLElement) || element;
  const heading = scope.querySelector(GEMINI_PACKAGED_TITLE_SELECTORS.export);
  const headingText = heading?.textContent?.trim();
  if (isMeaningfulTitle(headingText)) return headingText;

  const candidate = scope.querySelector(view.profiles['sidebar.conversationLinks'].join(', '));
  const link = candidate instanceof HTMLAnchorElement ? candidate : null;
  const ariaLabel = link?.getAttribute('aria-label')?.trim();
  if (isMeaningfulTitle(ariaLabel)) return ariaLabel;
  const linkTitle = link?.getAttribute('title')?.trim();
  return isMeaningfulTitle(linkTitle) ? linkTitle : null;
}

function extractConversationTitle(): string {
  try {
    const active =
      document.querySelector(
        '.gv-folder-conversation.gv-folder-conversation-selected .gv-conversation-title',
      ) || document.querySelector('.gv-folder-conversation-selected .gv-conversation-title');
    if (active?.textContent?.trim()) return active.textContent.trim();
  } catch {
    /* ignore */
  }

  try {
    const conversationId = extractConversationId();
    if (conversationId) {
      const escapedId = escapeCss(conversationId);
      const element =
        (document.querySelector(
          `[data-test-id="conversation"][jslog*="c_${escapedId}"]`,
        ) as HTMLElement) ||
        (document.querySelector(
          `[data-test-id="conversation"] a[href*="${escapedId}"]`,
        ) as HTMLElement);
      if (element) {
        const title = readCorroboratedGeminiTitle((view) =>
          extractTitleFromConversationElement(element, view),
        );
        if (title) return title;
      }
    }
  } catch {
    /* ignore */
  }

  const pageTitle = document.title?.trim();
  if (isMeaningfulTitle(pageTitle)) return pageTitle;

  try {
    const title = readGeminiActiveSidebarTitle('activeExport', isMeaningfulTitle);
    if (title) return title;
  } catch {
    /* ignore */
  }

  const conversationId = extractConversationId();
  return conversationId ? `Conversation ${conversationId.slice(0, 8)}` : 'Untitled Conversation';
}

function resolveRoot(userSelectors: string[], doc: Document = document): HTMLElement {
  return resolveConversationRoot({ userSelectors, doc });
}

function extractUserImage(element: HTMLElement): NodeListOf<HTMLImageElement> {
  return element.querySelectorAll(GEMINI_PACKAGED_CONTENT['export.userImages'].join(','));
}

function getUserAttachmentCandidates(element: HTMLElement): HTMLElement[] | undefined {
  const uploadedFiles = Array.from(
    element.querySelectorAll<HTMLElement>(
      GEMINI_PACKAGED_CONTENT['export.uploadedFiles'].join(','),
    ),
  );
  if (uploadedFiles.length > 0) return uploadedFiles;

  const filePreviews = Array.from(
    element.querySelectorAll<HTMLElement>(GEMINI_PACKAGED_CONTENT['export.filePreviews'].join(',')),
  );
  return filePreviews.length > 0 ? filePreviews : undefined;
}

export function buildGeminiAdapter(
  site: SiteAdapter,
  acceptedView?: GeminiSelectorView,
): ExportPlatformAdapter {
  const current = acceptedView ?? getGeminiSelectorView();
  const profiles = getExportReadProfiles(site.id);
  // Extraction is synchronous; one probe chooses the image tier before any output is emitted.
  let imageSearchSelector = bundledGeminiSearchImageSelector();
  const contentView = (element: HTMLElement, role: 'user' | 'assistant') =>
    acceptedView ?? checkedGeminiContentView(element, role, current);
  return {
    site,
    siteId: site.id,
    getUserSelectors: geminiUserTurnSelectors,
    getAssistantSelectors: geminiAssistantTurnSelectors,
    extractConversationTitle,
    extractConversationIdFromUrl: extractConversationId,
    resolveConversationRoot: resolveRoot,
    resolveAssistantContent: (element) => {
      const content = resolveGeminiAnswerElement(
        element,
        () => resolveExportMessageContent(element),
        contentView(element, 'assistant'),
      );
      if (current.remoteKeys.has('imageExport.searchHosts')) {
        const imageRoot = content.closest(profiles['export.responseOwner']) || content;
        imageSearchSelector = resolveGeminiSearchImageSelector(imageRoot, current);
      }
      return content;
    },
    getUserTextLines: (element) => readGeminiUserLines(element, contentView(element, 'user')),
    extractUserImage,
    extractUserText,
    getUserAttachmentCandidates,
    extractAssistantImage: (child, html, text, flags, tag, debug, processed) =>
      extractGeminiAssistantImage(
        child,
        html,
        text,
        flags,
        tag,
        debug,
        processed,
        imageSearchSelector,
      ),
    collectAssistantImages: (root, html, text, flags, processed, skip) =>
      collectGeminiAssistantImages(root, html, text, flags, processed, skip, imageSearchSelector),
    extractFormula,
    extractCodeBlock,
    extractInlineFormula,
  };
}
