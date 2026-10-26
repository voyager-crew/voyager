/**
 * Canvas Document Extractor
 *
 * Detects Canvas documents associated with conversation assistant responses,
 * and extracts their full content from the DOM.
 *
 * Supports two Canvas types:
 *   - Document Canvas: content in <immersive-editor> .ProseMirror (HTML → Markdown)
 *   - Code/App Canvas: content in <code-immersive-panel> xap-code-editor .view-lines (code lines)
 */
import codeProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/canvas-code.json';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/canvas-packaged.json';

import type { CanvasDoc } from '../../../features/export/types/export';
import { resolveFirstCanvasCodeRoot } from '../canvasExport/canvasTargets';
import { convertCanvasDomToMarkdown } from '../canvasExport/markdownConverter';

// Native document titles do not prove renamed editor ownership, so document roots stay packaged.
const DOCUMENT_EDITOR = packaged['canvas.documentEditors'].join(', ');
const CODE_PANEL = codeProfiles['canvas.codePanels'].join(', ');

/**
 * Check whether any Canvas panel is open in the document.
 */
export function isAnyCanvasOpen(): boolean {
  return !!(document.querySelector(DOCUMENT_EDITOR) || resolveFirstCanvasCodeRoot(document));
}

// ── Document Canvas (immersive-editor .ProseMirror) ────────────────

function findAllImmersiveEditors(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(DOCUMENT_EDITOR));
}

function extractProseMirrorContent(editor: HTMLElement): string | null {
  const proseMirror = editor.querySelector<HTMLElement>(packaged['canvas.proseMirror']);
  if (!proseMirror) return null;
  const markdown = convertCanvasDomToMarkdown(proseMirror).trim();
  return markdown || null;
}

function findProseMirrorTitle(editor: HTMLElement): string {
  const selectors = [
    ...packaged['canvas.documentTitles'].map((selector) => ({ selector, value: false })),
    ...packaged['canvas.documentTitleInputs'].map((selector) => ({ selector, value: true })),
  ];
  for (const { selector, value } of selectors) {
    const element = editor.querySelector<HTMLElement>(selector);
    const text = (
      value ? (element as HTMLInputElement | null)?.value : element?.textContent
    )?.trim();
    if (text) return text;
  }
  return '';
}

function extractDocumentCanvasDocs(): CanvasDoc[] {
  const editors = findAllImmersiveEditors();
  const docs: CanvasDoc[] = [];

  for (const editor of editors) {
    const content = extractProseMirrorContent(editor);
    if (!content) continue;

    const title = findProseMirrorTitle(editor) || 'Canvas Document';
    docs.push({ title, content });
  }

  return docs;
}

// ── Code / App Canvas (code-immersive-panel → xap-code-editor → Monaco .view-lines) ───

/**
 * Find the first code-immersive-panel in the document.
 * App Canvas wraps it inside <immersive-panel>, so query by tag directly.
 */
function findCodeImmersivePanel(): HTMLElement | null {
  return resolveFirstCanvasCodeRoot(document);
}

/**
 * Extract code content from Monaco editor's .view-lines.
 * Each .view-line holds one line of code; join them with \n to preserve line breaks.
 */
function extractCodeContent(panel: HTMLElement): string | null {
  // The bundled path preserves its historical document-wide read. A repaired host owns its source.
  const linesContainer = panel.matches(CODE_PANEL)
    ? document.querySelector<HTMLElement>(`${CODE_PANEL} ${packaged['canvas.codeLines']}`)
    : panel.querySelector<HTMLElement>(packaged['canvas.codeLines']);
  if (!linesContainer) return null;

  const lines = linesContainer.querySelectorAll<HTMLElement>(packaged['canvas.codeLine']);
  if (lines.length === 0) return null;

  const code = Array.from(lines)
    .map((line) => line.textContent?.trimEnd() || '')
    .join('\n')
    .trim();

  return code || null;
}

/**
 * Find the Canvas title from code-immersive-panel toolbar.
 * The title is in an h2.title-text element.
 */
function findCodeCanvasTitle(panel: HTMLElement): string {
  const titleEl = panel.querySelector<HTMLElement>(packaged['canvas.codeTitle']);
  return titleEl?.textContent?.trim() || '';
}

/**
 * Detect language from Monaco editor's data-mode-id attribute.
 */
function detectCodeLanguage(panel: HTMLElement): string {
  const editor = panel.matches(CODE_PANEL)
    ? document.querySelector<HTMLElement>(`${CODE_PANEL} ${packaged['canvas.codeLanguage']}`)
    : panel.querySelector<HTMLElement>(packaged['canvas.codeLanguage']);
  const lang = editor?.getAttribute('data-mode-id') || '';
  return lang;
}

function extractCodeCanvasDocs(): CanvasDoc[] {
  const panel = findCodeImmersivePanel();
  if (!panel) return [];

  const content = extractCodeContent(panel);
  if (!content) return [];

  const rawTitle = findCodeCanvasTitle(panel);
  const lang = detectCodeLanguage(panel);
  const title = rawTitle || (lang ? `${lang} Code` : 'Code Canvas');

  // Prepend language annotation as first line so formatted output shows it
  const annotatedContent = lang ? `// ${lang.toUpperCase()}\n${content}` : content;

  return [{ title, content: annotatedContent }];
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Extract all Canvas documents currently open in the DOM.
 * Supports Document Canvas (ProseMirror) and Code/App Canvas (Monaco editor).
 */
export function extractAllCanvasDocs(): CanvasDoc[] {
  const docs: CanvasDoc[] = [];

  // 1. Document Canvas — content in ProseMirror
  docs.push(...extractDocumentCanvasDocs());

  // 2. Code / App Canvas — content in Monaco editor
  docs.push(...extractCodeCanvasDocs());

  return docs;
}

// ── Detection helpers ──────────────────────────────────────────────

const CANVAS_DOC_INDICATORS = packaged['canvas.indicators'];

/**
 * Check if an assistant response element contains a reference to a Canvas document.
 */
export function assistantHasCanvasDoc(assistantElement: HTMLElement): boolean {
  for (const indicator of CANVAS_DOC_INDICATORS) {
    try {
      if (assistantElement.querySelector(indicator)) return true;
    } catch {
      continue;
    }
  }
  return false;
}
