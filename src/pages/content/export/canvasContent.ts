import type { CanvasDoc } from '@/features/export/types/export';

import { convertCanvasDomToMarkdown } from '../canvasExport/markdownConverter';

export interface CanvasContentProfiles {
  readonly 'canvas.documentEditors': readonly string[];
  readonly 'canvas.proseMirror': string;
  readonly 'canvas.documentTitles': readonly string[];
  readonly 'canvas.documentTitleInputs': readonly string[];
  readonly 'canvas.codePanels': readonly string[];
  readonly 'canvas.codeLines': string;
  readonly 'canvas.codeLine': string;
  readonly 'canvas.codeTitle': string;
  readonly 'canvas.codeLanguage': string;
  readonly 'canvas.indicators': readonly string[];
}
export interface CanvasContentReader {
  isAnyCanvasOpen(): boolean;
  extractAllCanvasDocs(): CanvasDoc[];
  assistantHasCanvasDoc(element: HTMLElement): boolean;
}

export function createCanvasContent(
  profiles: CanvasContentProfiles,
  readCodeRoot: (doc: Document) => HTMLElement | null,
  documentRoots?: {
    first(doc: Document): HTMLElement | null;
    all(doc: Document): HTMLElement[];
  },
): CanvasContentReader {
  const DOCUMENT_EDITOR = profiles['canvas.documentEditors'].join(', ');
  const CODE_PANEL = profiles['canvas.codePanels'].join(', ');

  /**
   * Check whether any Canvas panel is open in the document.
   */
  function isAnyCanvasOpen(): boolean {
    return !!(
      (documentRoots ? documentRoots.first(document) : document.querySelector(DOCUMENT_EDITOR)) ||
      readCodeRoot(document)
    );
  }

  // ── Document Canvas (immersive-editor .ProseMirror) ────────────────

  function findAllImmersiveEditors(): HTMLElement[] {
    return documentRoots
      ? documentRoots.all(document)
      : Array.from(document.querySelectorAll<HTMLElement>(DOCUMENT_EDITOR));
  }

  function extractProseMirrorContent(editor: HTMLElement): string | null {
    const proseMirror = editor.querySelector<HTMLElement>(profiles['canvas.proseMirror']);
    if (!proseMirror) return null;
    const markdown = convertCanvasDomToMarkdown(proseMirror).trim();
    return markdown || null;
  }

  function findProseMirrorTitle(editor: HTMLElement): string {
    const selectors = [
      ...profiles['canvas.documentTitles'].map((selector) => ({ selector, value: false })),
      ...profiles['canvas.documentTitleInputs'].map((selector) => ({ selector, value: true })),
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
    return readCodeRoot(document);
  }

  /**
   * Extract code content from Monaco editor's .view-lines.
   * Each .view-line holds one line of code; join them with \n to preserve line breaks.
   */
  function extractCodeContent(panel: HTMLElement): string | null {
    // The bundled path preserves its historical document-wide read. A repaired host owns its source.
    const linesContainer = panel.matches(CODE_PANEL)
      ? document.querySelector<HTMLElement>(`${CODE_PANEL} ${profiles['canvas.codeLines']}`)
      : panel.querySelector<HTMLElement>(profiles['canvas.codeLines']);
    if (!linesContainer) return null;

    const lines = linesContainer.querySelectorAll<HTMLElement>(profiles['canvas.codeLine']);
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
    const titleEl = panel.querySelector<HTMLElement>(profiles['canvas.codeTitle']);
    return titleEl?.textContent?.trim() || '';
  }

  /**
   * Detect language from Monaco editor's data-mode-id attribute.
   */
  function detectCodeLanguage(panel: HTMLElement): string {
    const editor = panel.matches(CODE_PANEL)
      ? document.querySelector<HTMLElement>(`${CODE_PANEL} ${profiles['canvas.codeLanguage']}`)
      : panel.querySelector<HTMLElement>(profiles['canvas.codeLanguage']);
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
  function extractAllCanvasDocs(): CanvasDoc[] {
    const docs: CanvasDoc[] = [];

    // 1. Document Canvas — content in ProseMirror
    docs.push(...extractDocumentCanvasDocs());

    // 2. Code / App Canvas — content in Monaco editor
    docs.push(...extractCodeCanvasDocs());

    return docs;
  }

  // ── Detection helpers ──────────────────────────────────────────────

  const CANVAS_DOC_INDICATORS = profiles['canvas.indicators'];

  /**
   * Check if an assistant response element contains a reference to a Canvas document.
   */
  function assistantHasCanvasDoc(assistantElement: HTMLElement): boolean {
    for (const indicator of CANVAS_DOC_INDICATORS) {
      try {
        if (assistantElement.querySelector(indicator)) return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  return { isAnyCanvasOpen, extractAllCanvasDocs, assistantHasCanvasDoc };
}
