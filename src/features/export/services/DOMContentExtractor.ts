/**
 * Extracts rich message content from a host page, preserving formatting such
 * as LaTeX formulas, code blocks and tables. Host-specific rules come from the
 * dialect the extractor is created with.
 */
import { logger } from '@/core/services/LoggerService';

import type { ChatTurn, ExportAttachment } from '../types/export';
import {
  findExportCodeBlocks,
  extractExportCodeBlock,
  extractCodeFromCodeElement,
  readDrawnDiagramBlock,
} from './exportCodeBlocks';
import {
  DEFAULT_EXPORT_CODE_PROFILE,
  closestExportCodeHost,
  type ExportCodeProfile,
} from './exportCodeProfile';
import type { ExportContentDialect, ExtractedContentFlags } from './exportContentDialect';
import { resolveExportMessageContent } from './exportContentRoots';
import {
  shouldSkipElement,
  normalizeText,
  escapeHtml,
  queryOutsideThoughts,
} from './exportDomPolicy';
import { processInlineContent, extractTable, extractList } from './exportRichText';
import type { ProcessedInlineContent } from './exportRichText';
import { getExportReadProfiles } from './exportSiteData';
import { extractUserContent } from './exportUserContent';
import { processYouTubeCovers } from './exportYouTubeCovers';

export { processYouTubeCovers } from './exportYouTubeCovers';

export interface ExtractedContent {
  text: string;
  html: string;
  attachments: ExportAttachment[];
  hasImages: boolean;
  hasFormulas: boolean;
  hasTables: boolean;
  hasCode: boolean;
}

export interface ContentExtractor {
  extractUserContent(element: HTMLElement): ExtractedContent;
  extractAssistantContent(element: HTMLElement): ExtractedContent;
}

const PROSE_BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, ul, ol, pre, blockquote, hr';

/** Whether `container` holds prose blocks outside its tables, i.e. is more than a table's frame. */
function hasBlocksBesideTable(container: Element): boolean {
  return Array.from(container.querySelectorAll(PROSE_BLOCK_SELECTOR)).some(
    (block) => !block.closest('table, table-block'),
  );
}

export function createContentExtractor(dialect: ExportContentDialect): ContentExtractor {
  const readProfiles = getExportReadProfiles(dialect.siteId);
  function extractAssistantContent(element: HTMLElement): ExtractedContent {
    const result: ExtractedContent = {
      text: '',
      html: '',
      attachments: [],
      hasImages: false,
      hasFormulas: false,
      hasTables: false,
      hasCode: false,
    };

    const messageContent =
      dialect.resolveAssistantContent?.(element) ??
      resolveExportMessageContent(element, dialect.siteId);

    const codeProfile = dialect.resolveCodeProfile?.(messageContent) ?? DEFAULT_EXPORT_CODE_PROFILE;

    // Don't clone! Angular custom elements may lose content when cloned
    // Instead, skip model-thoughts during processNodes
    const htmlParts: string[] = [];
    const textParts: string[] = [];
    const processedImageSrcs = new Set<string>();

    const markdownDiv = messageContent.querySelector(readProfiles['export.walkMarkdown']);
    processNodes(
      markdownDiv || messageContent,
      htmlParts,
      textParts,
      result,
      processedImageSrcs,
      codeProfile,
    );

    // Helper function to search in both light DOM and shadow DOM
    const searchAll = (root: Element, selector: string): Element[] => {
      const results: Element[] = [];

      // Search in light DOM
      results.push(...Array.from(root.querySelectorAll(selector)));

      // Search in shadow DOM recursively
      const searchShadow = (el: Element) => {
        const shadowRoot = el.shadowRoot;
        if (shadowRoot) {
          logger.debug('[DOMContentExtractor] Searching in Shadow DOM', { tagName: el.tagName });
          results.push(...Array.from(shadowRoot.querySelectorAll(selector)));
        }

        // Recursively check children for shadow roots
        Array.from(el.children).forEach(searchShadow);
      };

      searchShadow(root);
      return results;
    };

    // Also search for raw code elements regardless of presence of code-block
    const altCodeBlocks = searchAll(messageContent, readProfiles['export.rawCode']);
    altCodeBlocks.forEach((codeEl) => {
      // Avoid duplicates if already processed
      if ((codeEl as Element & { processedByGV?: boolean }).processedByGV) return;
      // Skip if inside a code-block (already handled by processNodes)
      if (closestExportCodeHost(codeEl, codeProfile, true)) return;
      const extracted = extractCodeFromCodeElement(codeEl as HTMLElement, codeProfile);
      if (extracted.text) {
        (codeEl as Element & { processedByGV?: boolean }).processedByGV = true;
        result.hasCode = true;
        htmlParts.push(extracted.html);
        textParts.push(`\n${extracted.text}\n`);
      }
    });
    // Note: tables and code-blocks were already processed via processNodes()

    const leftoverRoot =
      (messageContent.closest(readProfiles['export.responseOwner']) as HTMLElement | null) ||
      messageContent;
    processYouTubeCovers(leftoverRoot, htmlParts, textParts, result);
    if (markdownDiv) {
      dialect.collectAssistantImages?.(
        leftoverRoot,
        htmlParts,
        textParts,
        result,
        processedImageSrcs,
        markdownDiv,
      );
    }

    result.html = htmlParts.join('\n');
    // Clean up multiple newlines but preserve intentional spacing
    let combinedText = textParts
      .join('')
      .replace(/\n{3,}/g, '\n\n') // Max 2 consecutive newlines
      .trim();
    // Last-chance fallback: if no structured text captured, use plain innerText
    if (!combinedText) {
      const fallbackContainer =
        (messageContent as HTMLElement) ||
        queryOutsideThoughts<HTMLElement>(element, readProfiles['export.messageContent']) ||
        (element as HTMLElement);
      try {
        const plain =
          readTextOutsideEmptyBlocks(fallbackContainer, codeProfile) ??
          ((fallbackContainer as HTMLElement).innerText || fallbackContainer.textContent || '');
        combinedText = normalizeText(plain);
      } catch {
        /* ignore */
      }
    }
    result.text = combinedText;

    return result;
  }

  /** Whether the dialect claims `element` as a code block that exports as nothing. */
  function isEmptyClaimedBlock(element: Element, codeProfile: ExportCodeProfile): boolean {
    const textParts: string[] = [];
    const flags = { hasImages: false, hasFormulas: false, hasTables: false, hasCode: false };
    const claimed = dialect.extractCodeBlock(
      element,
      [],
      textParts,
      flags,
      element.localName,
      false,
      codeProfile,
    );
    return Boolean(claimed) && !textParts.join('').trim();
  }

  /**
   * `container`'s text without the blocks the walk deliberately exported as nothing, or
   * null when it holds none. A host-drawn chart's labels are no reply text (ChatGPT's
   * Mermaid preview would otherwise export as "StartFinish").
   */
  function readTextOutsideEmptyBlocks(
    container: Element,
    codeProfile: ExportCodeProfile,
  ): string | null {
    let skipped = false;
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      (node) => {
        if (!(node instanceof Element)) return NodeFilter.FILTER_ACCEPT;
        if (shouldSkipElement(node)) return NodeFilter.FILTER_REJECT;
        if (!isEmptyClaimedBlock(node, codeProfile)) return NodeFilter.FILTER_SKIP;
        skipped = true;
        return NodeFilter.FILTER_REJECT;
      },
    );
    const parts: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) parts.push(node.textContent ?? '');
    }
    return skipped ? parts.join('') : null;
  }

  function processNodes(
    container: Element | ShadowRoot,
    htmlParts: string[],
    textParts: string[],
    flags: ExtractedContentFlags,
    processedImageSrcs: Set<string>,
    codeProfile: ExportCodeProfile,
  ): void {
    const children = Array.from(container.children);
    const appendInlineContent = (processed: ProcessedInlineContent): void => {
      const isWhitespaceOnly =
        !processed.html &&
        !processed.text &&
        (processed.hasLeadingWhitespace || processed.hasTrailingWhitespace);

      if (isWhitespaceOnly) {
        const previousText = textParts.at(-1) ?? '';
        if (previousText && !/\s$/.test(previousText)) {
          htmlParts.push('<span> </span>');
          textParts.push(' ');
        }
        return;
      }

      if (processed.html) {
        htmlParts.push(`<span>${processed.html}</span>`);
      }

      if (processed.text) {
        const previousText = textParts.at(-1) ?? '';
        const needsLeadingSpace =
          processed.hasLeadingWhitespace && previousText.length > 0 && !/\s$/.test(previousText);

        textParts.push(
          `${needsLeadingSpace ? ' ' : ''}${processed.text}${
            processed.hasTrailingWhitespace ? ' ' : ''
          }`,
        );
      }
    };

    // Check for Shadow DOM
    const shadowRoot = container instanceof Element ? container.shadowRoot : null;
    if (shadowRoot) {
      processNodes(shadowRoot, htmlParts, textParts, flags, processedImageSrcs, codeProfile);
    }

    for (const child of children) {
      const tagName = child.tagName.toLowerCase();

      // Skip certain elements
      if (shouldSkipElement(child)) {
        continue;
      }

      if (child.shadowRoot && child.children.length === 0) {
        processNodes(
          child.shadowRoot,
          htmlParts,
          textParts,
          flags,
          processedImageSrcs,
          codeProfile,
        );
        continue;
      }

      // Canvas Export Section (Injected Canvas document content)
      if (child.classList.contains('gv-canvas-export-section')) {
        const headingEl = child.querySelector('h3');
        const contentEl = child.querySelector('.gv-canvas-content');
        const headingText = headingEl?.textContent || 'Canvas Document';
        const contentText = contentEl?.textContent || '';

        htmlParts.push(
          `<div class="gv-canvas-export-section"><h3>${escapeHtml(headingText)}</h3><pre style="white-space: pre-wrap;">${escapeHtml(contentText)}</pre></div>`,
        );
        textParts.push(`\n### ${headingText}\n\n${contentText}\n`);
        continue;
      }

      // Extract formula
      if (dialect.extractFormula(child, flags, htmlParts, textParts, false)) {
        continue;
      }

      const exportCodeBlocks = findExportCodeBlocks(child, codeProfile);
      const directExportCodeBlock = exportCodeBlocks.find((element) => element === child);
      if (directExportCodeBlock) {
        const content = extractExportCodeBlock(directExportCodeBlock, codeProfile);
        if (content) {
          htmlParts.push(content.html);
        }
        if (content?.text) {
          flags.hasCode = true;
          textParts.push(`\n${content.text}\n`);
        }
        continue;
      }

      // A diagram plugin's drawn block (ChatGPT's `pre`, say): the host adapter below
      // only reads its source, so the drawing comes first; without one, the source.
      const drawn = readDrawnDiagramBlock(child);
      if (drawn) {
        htmlParts.push(drawn.html);
        if (drawn.text) {
          flags.hasCode = true;
          textParts.push(`\n${drawn.text}\n`);
        }
        // Or the raw-code pass after the walk would add the source a second time.
        for (const code of Array.from(child.querySelectorAll('code'))) {
          (code as Element & { processedByGV?: boolean }).processedByGV = true;
        }
        continue;
      }

      // Extract code block via the per-platform adapter
      if (
        dialect.extractCodeBlock(child, htmlParts, textParts, flags, tagName, false, codeProfile)
      ) {
        continue;
      }

      // Traverse containers that own export blocks instead of consuming only their first
      // descendant. This keeps prose, code, and Mermaid output in DOM order.
      if (tagName !== 'ul' && tagName !== 'ol' && exportCodeBlocks.length > 0) {
        processNodes(child, htmlParts, textParts, flags, new Set<string>(), codeProfile);
        continue;
      }

      // Table block (check for nested table-block first)
      const tableBlock = child.querySelector('table-block');
      const isTable = tagName === 'table' || tagName === 'table-block';
      // A wrapper around the whole reply also "contains a table": exporting it as one
      // dropped every heading, paragraph and list beside the table.
      if (!isTable && (tableBlock || child.querySelector('table')) && hasBlocksBesideTable(child)) {
        processNodes(child, htmlParts, textParts, flags, processedImageSrcs, codeProfile);
        continue;
      }
      if (isTable || tableBlock || child.querySelector('table')) {
        const elementToExtract = (tableBlock || child) as HTMLElement;
        const tableContent = extractTable(elementToExtract, dialect);
        if (tableContent.hasFormulas) flags.hasFormulas = true;
        if (tableContent.text) {
          // Only add if table was successfully extracted
          flags.hasTables = true;
          htmlParts.push(tableContent.html);
          textParts.push(`\n${tableContent.text}\n\n`);
        }
        continue;
      }

      // Extract assistant image
      if (
        dialect.extractAssistantImage(
          child,
          htmlParts,
          textParts,
          flags,
          tagName,
          false,
          processedImageSrcs,
        )
      ) {
        continue;
      }

      // Horizontal rule
      if (tagName === 'hr') {
        htmlParts.push('<hr>');
        textParts.push('\n---\n');
        continue;
      }

      // Paragraph with possible inline formulas
      if (tagName === 'p') {
        const processed = processInlineContent(child as HTMLElement, dialect);
        if (processed.hasFormulas) flags.hasFormulas = true;
        htmlParts.push(`<p>${processed.html}</p>`);
        textParts.push(`${processed.text}\n`);
        continue;
      }

      // Headings
      if (/^h[1-6]$/.test(tagName)) {
        const text = processInlineContent(child as HTMLElement, dialect);
        const level = tagName[1];
        htmlParts.push(`<h${level}>${text.html}</h${level}>`);
        textParts.push(`\n${'#'.repeat(parseInt(level))} ${text.text}\n`);
        continue;
      }

      // Lists
      if (tagName === 'ul' || tagName === 'ol') {
        const listContent = extractList(child as HTMLElement, dialect, 0, codeProfile);
        if (listContent.hasFormulas) flags.hasFormulas = true;
        if (listContent.hasCode) flags.hasCode = true;
        htmlParts.push(listContent.html);
        textParts.push(`\n${listContent.text}\n`);
        continue;
      }

      if (tagName === 'blockquote') {
        const quoteHtml: string[] = [];
        const quoteText: string[] = [];
        processNodes(child, quoteHtml, quoteText, flags, processedImageSrcs, codeProfile);
        htmlParts.push(`<blockquote>${quoteHtml.join('')}</blockquote>`);
        const markdown = quoteText
          .join('')
          .trim()
          .split('\n')
          .map((line) => (line ? `> ${line}` : '>'))
          .join('\n');
        if (markdown) textParts.push(`\n${markdown}\n`);
        continue;
      }

      // Generic containers: recurse if the element has child elements,
      // regardless of tag name. This handles custom elements from any platform
      // (e.g. Claude's response containers) without needing a whitelist.
      if (child.children.length > 0) {
        const hasDirectText = Array.from(child.childNodes).some(
          (node) => node.nodeType === Node.TEXT_NODE && normalizeText(node.textContent || ''),
        );
        const onlyInlineChildren = Array.from(child.children).every((element) =>
          /^(?:A|B|CODE|EM|I|IMG|SPAN|STRONG|SUB|SUP)$/.test(element.tagName),
        );
        if (hasDirectText && onlyInlineChildren) {
          const processed = processInlineContent(child as HTMLElement, dialect);
          if (processed.hasFormulas) flags.hasFormulas = true;
          appendInlineContent(processed);
        } else {
          processNodes(child, htmlParts, textParts, flags, processedImageSrcs, codeProfile);
        }
        continue;
      }

      // Leaf element with no child elements: extract text content
      const rawText = child.textContent || '';
      const text = normalizeText(rawText);
      appendInlineContent({
        html: escapeHtml(text),
        text,
        hasFormulas: false,
        hasLeadingWhitespace: /^\s/.test(rawText),
        hasTrailingWhitespace: /\s$/.test(rawText),
      });
    }
  }

  return {
    extractUserContent: (element) => extractUserContent(element, dialect),
    extractAssistantContent,
  };
}

/**
 * The turn with its rich content read from the page once, so every export
 * format renders the same snapshot. Content captured earlier is kept.
 */
export function extractTurnContent(turn: ChatTurn, extractor: ContentExtractor): ChatTurn {
  return {
    ...turn,
    userContent:
      turn.userContent ??
      (turn.userElement ? extractor.extractUserContent(turn.userElement) : undefined),
    assistantContent:
      turn.assistantContent ??
      (turn.assistantElement
        ? extractor.extractAssistantContent(turn.assistantElement)
        : undefined),
  };
}
