import { GEMINI_PACKAGED_CONTENT } from '@/core/gemini/content/packaged';
import { resolveGeminiAnswerElement, readGeminiUserLines } from '@/core/gemini/content/reads';
import { getGeminiSelectorView, type GeminiSelectorView } from '@/core/gemini/selectors';
import {
  GEMINI_PACKAGED_TITLE_SELECTORS,
  readCorroboratedGeminiTitle,
} from '@/core/gemini/sidebarTitles';
import { resolveExportMessageContent } from '@/features/export/services/exportContentRoots';
import { getExportReadProfiles } from '@/features/export/services/exportSiteData';
import titleData from '@/features/plugins/catalog/sites/gemini/selector-data/sidebar-titles.json';
import type { SiteAdapter } from '@/features/plugins/types';

import {
  geminiAssistantTurnSelectors,
  geminiUserTurnSelectors,
  resolveConversationRoot,
} from '../../conversationDom';
import type { ExportPlatformAdapter } from './contract';
import {
  extractAppConversationId,
  readConversationRowTitle,
  readConversationTitle,
} from './conversationTitle';
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

function extractConversationTitle(): string {
  const profile = {
    heading: GEMINI_PACKAGED_TITLE_SELECTORS.export,
    links: '',
    active: titleData['title.activeExport'],
  };
  return readConversationTitle(profile, (element) =>
    readCorroboratedGeminiTitle((view) =>
      readConversationRowTitle(element, {
        ...profile,
        links: view.profiles['sidebar.conversationLinks'].join(', '),
      }),
    ),
  );
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
    extractConversationIdFromUrl: extractAppConversationId,
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
