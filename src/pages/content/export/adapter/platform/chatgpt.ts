import { USER_LATEX_ORIGINAL_ATTRIBUTE, hasUserLatexRendering } from '@/core/utils/userLatexSource';
import type { ExtractedContent } from '@/features/export/services/DOMContentExtractor';
import { escapeHtml, escapeHtmlAttribute } from '@/features/export/services/exportDomPolicy';
import type { SiteAdapter } from '@/features/plugins/types';

import { chatgptCodeLanguageLabel } from '../chatgptCodeLanguage';
import { chatgptExportData } from '../chatgptExportData';
import { chatgptLoggedOutAssistantSelector } from '../chatgptExportLocators';
import {
  DESKTOP_TURN_SELECTOR,
  LOGGED_OUT_MESSAGE_SELECTOR,
  isChatGptLoggedOutConversation,
  resolveChatGptLoggedOutThread,
} from '../chatgptLoggedOutDom';
import { resolveVisibleConversationRoot } from '../chatgptThread';
import { exportSiteSnapshot } from '../exportSiteSnapshot';
import type { ExportPlatformAdapter } from './contract';

/** The logged-out page's tab title is ChatGPT's marketing copy, never the conversation's name. */
function isLoggedOutPage(): boolean {
  return (
    LOGGED_OUT_ROUTE.test(window.location.pathname) || isChatGptLoggedOutConversation(document)
  );
}

function extractTitle(): string {
  const title = isLoggedOutPage() ? '' : document.title?.trim();
  if (title && title !== 'ChatGPT' && title !== 'New chat') return title;

  const active = document.querySelector(chatgptExportData['export.activeConversation']);
  const activeTitle = active?.textContent?.trim();
  if (activeTitle) return activeTitle;

  const conversationId = extractId();
  return conversationId ? `Conversation ${conversationId.slice(0, 8)}` : 'Untitled Conversation';
}

function extractId(): string | null {
  return window.location.pathname.match(CONVERSATION_ROUTE)?.[1] ?? null;
}

/**
 * Signed in: `/c/<id>` or `/g/<gpt>/c/<id>`, optionally under `/u/<index>/`.
 * The logged-out page, at any width: `/uc/<id>`.
 */
const CONVERSATION_ROUTE = /^(?:\/u\/[^/]+)?(?:\/g\/[^/]+)?\/(?:c|uc)\/([^/?#]+)/;
const LOGGED_OUT_ROUTE = /^(?:\/u\/[^/]+)?(?:\/g\/[^/]+)?\/uc\/[^/?#]+/;

/**
 * ChatGPT serves Codex, settings and other non-chat pages from the same
 * origin. A conversation lives on a `/c/<id>` or `/uc/<id>` route, or, for a temporary chat
 * that never leaves `/?temporary-chat=true`, wherever a turn is rendered.
 */
export function chatgptIsConversationPage(doc: Document, url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  return (
    CONVERSATION_ROUTE.test(pathname) ||
    doc.querySelector(DESKTOP_TURN_SELECTOR) !== null ||
    resolveChatGptLoggedOutThread(doc)?.querySelector(LOGGED_OUT_MESSAGE_SELECTOR) != null
  );
}

/** The visible conversation's `main`: ChatGPT keeps earlier pages in hidden ones. */
function resolveRoot(_userSelectors: string[], doc: Document = document): HTMLElement {
  return resolveVisibleConversationRoot(doc);
}

function extractUserImage(element: HTMLElement): NodeListOf<HTMLImageElement> {
  return element.querySelectorAll('img');
}

function getUserAttachmentCandidates(element: HTMLElement): HTMLElement[] | undefined {
  return Array.from(
    element.querySelectorAll<HTMLElement>(chatgptExportData['export.userAttachments']),
  ).filter((candidate) => {
    const buttonName = candidate
      .querySelector<HTMLElement>(chatgptExportData['export.attachmentAction'])
      ?.getAttribute('aria-label')
      ?.trim();
    // A labelled tile must carry its button's name; the newer resource card labels only the button.
    const name = candidate.getAttribute('aria-label')?.trim() ?? buttonName;
    return !!name && name === buttonName;
  });
}

const USER_TEXT_BLOCK_TAGS = new Set([
  'ADDRESS',
  'BLOCKQUOTE',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'P',
  'PRE',
]);

function readStructuredUserText(root: HTMLElement): string {
  const parts: string[] = [];
  const appendLineBreak = (): void => {
    if (parts.length > 0 && !parts.at(-1)?.endsWith('\n')) parts.push('\n');
  };
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push((node.textContent || '').replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' '));
      return;
    }
    if (!(node instanceof Element)) return;
    // Rendered user LaTeX exports as the source the user typed, as on Gemini;
    // an edited message React repainted exports its new text instead.
    const latex = node.getAttribute(USER_LATEX_ORIGINAL_ATTRIBUTE);
    if (latex !== null && hasUserLatexRendering(node)) {
      parts.push(latex.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' '));
      return;
    }
    if (node.tagName === 'BR') {
      parts.push('\n');
      return;
    }
    const block = USER_TEXT_BLOCK_TAGS.has(node.tagName);
    if (block) appendLineBreak();
    node.childNodes.forEach(visit);
    if (block) appendLineBreak();
  };

  root.childNodes.forEach(visit);
  return parts
    .join('')
    .replace(/[\u200b\u00a0]/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function chatgptExtractUserText(
  _textLines: NodeListOf<HTMLElement>,
  textParts: string[],
  element: HTMLElement,
): void {
  const contentOnly = element.cloneNode(true) as HTMLElement;
  getUserAttachmentCandidates(contentOnly)?.forEach((candidate) => candidate.remove());
  const fallback = readStructuredUserText(contentOnly);
  if (fallback) textParts.push(fallback);
}

function extractAssistantImage(
  child: Element,
  htmlParts: string[],
  textParts: string[],
  flags: Pick<ExtractedContent, 'hasImages' | 'hasFormulas' | 'hasTables' | 'hasCode'>,
  tagName?: string,
  _DEBUG?: boolean,
  processedImageSrcs?: Set<string>,
): boolean | undefined {
  if (tagName !== 'img') return;
  const image = child as HTMLImageElement;
  if (image.getAttribute('aria-hidden') === 'true') return true;

  const src = image.getAttribute('src') || image.src || '';
  if (src && src !== 'about:blank' && !processedImageSrcs?.has(src)) {
    processedImageSrcs?.add(src);
    flags.hasImages = true;
    const alt = image.getAttribute('alt')?.trim() || 'Image';
    htmlParts.push(`<img src="${escapeHtmlAttribute(src)}" alt="${escapeHtmlAttribute(alt)}" />`);
    textParts.push(`\n![${alt.replace(/\]/g, '\\]')}](${src})\n`);
  }
  return true;
}

export function chatgptExtractFormula(
  child: Element,
  flags: Pick<ExtractedContent, 'hasImages' | 'hasFormulas' | 'hasTables' | 'hasCode'>,
  htmlParts: string[],
  textParts: string[],
): boolean | undefined {
  if (!child.classList.contains('katex-display') && !child.classList.contains('katex')) return;
  const source = child.closest('[data-math-source]') ?? child.closest('[role="math"]');
  const latex = (
    source?.getAttribute('data-math-source') ||
    source?.getAttribute('aria-label') ||
    ''
  ).trim();
  if (!latex) return;

  flags.hasFormulas = true;
  htmlParts.push(
    `<div class="math-block" data-math="${escapeHtmlAttribute(latex)}">${child.outerHTML}</div>`,
  );
  textParts.push(`\n$$\n${latex}\n$$\n`);
  return true;
}

/** Block chrome ChatGPT leaves out of its own copy: language label, wrap and copy buttons. */
const COPY_EXCLUDED_SELECTOR = chatgptExportData['export.copyExcluded'];
/** ChatGPT's own Mermaid drawing; the finished chart keeps no source to export. */
const MERMAID_PREVIEW_SELECTOR = chatgptExportData['export.mermaidPreview'];
const LANGUAGE_ID = /^[a-z0-9_+#.-]{1,32}$/i;
const PLAIN_TEXT_IDS = new Set(['plaintext', 'plain', 'text', 'txt']);

/** The header label names the language, localized: 纯文本 or "Plain text" mean none. */
function readCodeLanguageLabel(block: Element): string {
  const label = chatgptCodeLanguageLabel(block);
  if (!LANGUAGE_ID.test(label)) return '';
  const language = label.toLowerCase();
  return PLAIN_TEXT_IDS.has(language) ? '' : language;
}

function extractCodeBlock(
  codeBlockSelector: string,
  child: Element,
  htmlParts: string[],
  textParts: string[],
  flags: Pick<ExtractedContent, 'hasImages' | 'hasFormulas' | 'hasTables' | 'hasCode'>,
  tagName?: string,
): boolean | undefined {
  if (child.matches(COPY_EXCLUDED_SELECTOR)) return true;
  if (child.matches(MERMAID_PREVIEW_SELECTOR) && !child.querySelector('pre, code')) return true;
  // ChatGPT dropped `pre` and `language-*` for this block; read it by its copy markers, or
  // its header label and buttons export as prose.
  if (tagName !== 'pre' && !child.matches(codeBlockSelector)) return;
  const codeElement =
    Array.from(child.querySelectorAll('code')).find(
      (code) => !code.closest(COPY_EXCLUDED_SELECTOR),
    ) ?? (tagName === 'pre' ? child : null);
  if (!codeElement) return true;
  const code = codeElement.textContent || '';
  const className = (codeElement.getAttribute('class') || '').toLowerCase();
  const language =
    className.match(/language-([a-z0-9]+)/i)?.[1] ??
    readCodeLanguageLabel(child.querySelector(codeBlockSelector) ?? child);
  if (code.trim()) {
    flags.hasCode = true;
    htmlParts.push(`<pre><code class="language-${language}">${escapeHtml(code)}</code></pre>`);
    textParts.push(`\n\`\`\`${language}\n${code}\n\`\`\`\n`);
    (child as Element & { processedByGV?: boolean }).processedByGV = true;
    if (codeElement !== child) {
      (codeElement as Element & { processedByGV?: boolean }).processedByGV = true;
    }
  }
  return true;
}

export function chatgptExtractInlineFormula(
  element: Element,
  htmlParts: string[],
  textParts: string[],
): boolean | undefined {
  if (!element.classList.contains('katex-display') && !element.classList.contains('katex')) return;
  const source = element.closest('[data-math-source]') ?? element.closest('[role="math"]');
  const latex = (
    source?.getAttribute('data-math-source') ||
    source?.getAttribute('aria-label') ||
    ''
  ).trim();
  if (!latex) return;

  const display =
    element.classList.contains('katex-display') || element.closest('.katex-display') != null;
  htmlParts.push(
    `<span class="${display ? 'math-block' : 'math-inline'}" data-math="${escapeHtmlAttribute(latex)}">${element.outerHTML}</span>`,
  );
  textParts.push(display ? `\n$$\n${latex}\n$$\n` : `$${latex}$`);
  return true;
}

export function buildChatGptAdapter(provided: SiteAdapter): ExportPlatformAdapter {
  const site = exportSiteSnapshot(provided);
  return {
    site,
    siteId: site.id,
    getUserSelectors: () => [site.selectors.userTurn],
    getAssistantSelectors: () => [
      site.selectors.assistantTurn,
      chatgptLoggedOutAssistantSelector(),
    ],
    extractConversationTitle: extractTitle,
    extractConversationIdFromUrl: extractId,
    resolveConversationRoot: resolveRoot,
    extractUserImage,
    extractUserText: chatgptExtractUserText,
    getUserAttachmentCandidates,
    extractAssistantImage,
    extractFormula: chatgptExtractFormula,
    // Reprove the frozen catalog value at extraction time; a later DOM may invalidate its host.
    extractCodeBlock: (child, html, text, flags, tag) =>
      extractCodeBlock(site.selectors.codeBlock, child, html, text, flags, tag),
    extractInlineFormula: chatgptExtractInlineFormula,
  };
}
