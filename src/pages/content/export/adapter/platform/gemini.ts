import type { GeminiSelectorView } from '@/core/gemini/selectors';
import {
  GEMINI_PACKAGED_TITLE_SELECTORS,
  readCorroboratedGeminiTitle,
  readGeminiActiveSidebarTitle,
} from '@/core/gemini/sidebarTitles';
import type { ExtractedContent } from '@/features/export/services/DOMContentExtractor';
import { extractExportCodeBlock } from '@/features/export/services/exportCodeBlocks';
import { normalizeText } from '@/features/export/services/exportDomPolicy';
import type { SiteAdapter } from '@/features/plugins/types';

import {
  geminiAssistantTurnSelectors,
  geminiUserTurnSelectors,
  resolveConversationRoot,
} from '../../conversationDom';
import type { ExportPlatformAdapter } from './contract';
import { collectGeminiAssistantImages, extractGeminiAssistantImage } from './geminiImages';

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
  return element.querySelectorAll('user-query-file-preview img, .preview-image');
}

function extractUserText(textLines: NodeListOf<HTMLElement>, textParts: string[]): void {
  textLines.forEach((line) => {
    const raw = line.dataset?.userLatexOriginal ?? line.textContent ?? '';
    const text = normalizeText(raw);
    if (text) textParts.push(text);
  });
}

function getUserAttachmentCandidates(element: HTMLElement): HTMLElement[] | undefined {
  const uploadedFiles = Array.from(
    element.querySelectorAll<HTMLElement>('user-query-file-preview [data-test-id="uploaded-file"]'),
  );
  if (uploadedFiles.length > 0) return uploadedFiles;

  const filePreviews = Array.from(
    element.querySelectorAll<HTMLElement>('user-query-file-preview .new-file-preview-file'),
  );
  return filePreviews.length > 0 ? filePreviews : undefined;
}

function extractFormula(
  child: Element,
  flags: Pick<ExtractedContent, 'hasImages' | 'hasFormulas' | 'hasTables' | 'hasCode'>,
  htmlParts: string[],
  textParts: string[],
  _DEBUG: boolean,
): boolean | undefined {
  if (!child.classList.contains('math-block') && !child.hasAttribute('data-math')) return;
  const latex = child.getAttribute('data-math') || '';
  if (!latex) return;

  flags.hasFormulas = true;
  const clonedFormula = (child as HTMLElement).cloneNode(true) as HTMLElement;
  if (!clonedFormula.hasAttribute('data-math')) clonedFormula.setAttribute('data-math', latex);
  htmlParts.push(clonedFormula.outerHTML);
  textParts.push(`\n$$\n${latex}\n$$\n`);
  return true;
}

function extractCodeBlock(
  child: Element,
  htmlParts: string[],
  textParts: string[],
  flags: Pick<ExtractedContent, 'hasImages' | 'hasFormulas' | 'hasTables' | 'hasCode'>,
  tagName?: string,
  _DEBUG?: boolean,
): boolean | undefined {
  if (child.querySelector('.gv-mermaid-wrapper')) return;

  // Descendant code blocks belong to the shared DOM-order traversal. Claiming
  // their parent here drops prose and sibling blocks around the first match.
  if (tagName !== 'code-block' && !child.classList.contains('code-block')) return;

  // A diagram plugin's block exports its drawing while it can be read; otherwise its source.
  const codeContent = extractExportCodeBlock(child as HTMLElement);
  if (codeContent?.text) {
    flags.hasCode = true;
    htmlParts.push(codeContent.html);
    textParts.push(`\n${codeContent.text}\n`);
  }
  return true;
}

function extractInlineFormula(
  element: Element,
  htmlParts: string[],
  textParts: string[],
): boolean | undefined {
  if (!element.classList.contains('math-inline') && !element.hasAttribute('data-math')) return;
  const latex = element.getAttribute('data-math') || '';
  if (!latex) return;

  const clonedFormula = (element as HTMLElement).cloneNode(true) as HTMLElement;
  if (!clonedFormula.hasAttribute('data-math')) clonedFormula.setAttribute('data-math', latex);
  htmlParts.push(clonedFormula.outerHTML);
  textParts.push(`$${latex}$`);
  return true;
}

export function buildGeminiAdapter(site: SiteAdapter): ExportPlatformAdapter {
  return {
    site,
    getUserSelectors: geminiUserTurnSelectors,
    getAssistantSelectors: geminiAssistantTurnSelectors,
    extractConversationTitle,
    extractConversationIdFromUrl: extractConversationId,
    resolveConversationRoot: resolveRoot,
    extractUserImage,
    extractUserText,
    getUserAttachmentCandidates,
    extractAssistantImage: extractGeminiAssistantImage,
    collectAssistantImages: collectGeminiAssistantImages,
    extractFormula,
    extractCodeBlock,
    extractInlineFormula,
  };
}
