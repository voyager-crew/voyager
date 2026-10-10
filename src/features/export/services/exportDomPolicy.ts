// Licensed hero images use action-like buttons and classes; keep those as content.
export function shouldSkipElement(element: Element): boolean {
  // Skip non-content HTML nodes and interactive/action elements. Some hosts
  // colocate component styles inside message cards; their textContent is CSS,
  // not conversation text.
  if (
    element.tagName === 'STYLE' ||
    element.tagName === 'SCRIPT' ||
    element.tagName === 'NOSCRIPT' ||
    element.tagName === 'TEMPLATE' ||
    (element.tagName === 'BUTTON' &&
      !(element.classList.contains('image-button') && element.querySelector('img'))) ||
    element.tagName === 'MAT-ICON' ||
    // Gemini inline sources/citation chips (appear as link icons in export/print)
    element.tagName === 'SOURCES-CAROUSEL-INLINE' ||
    element.tagName === 'SOURCE-INLINE-CHIPS' ||
    element.tagName === 'SOURCE-INLINE-CHIP' ||
    // Generated image overlay controls (share, copy, download buttons)
    element.tagName === 'SHARE-BUTTON' ||
    element.tagName === 'COPY-BUTTON' ||
    element.tagName === 'DOWNLOAD-GENERATED-IMAGE-BUTTON'
  ) {
    return true;
  }

  // Skip model thoughts completely (including the toggle button)
  if (element.tagName === 'MODEL-THOUGHTS' || element.classList.contains('model-thoughts')) {
    return true;
  }

  // Skip action buttons and controls
  if (
    element.classList.contains('copy-button') ||
    element.classList.contains('action-button') ||
    element.classList.contains('table-footer') ||
    element.classList.contains('export-sheets-button') ||
    element.classList.contains('thoughts-header') ||
    // Gemini inline source/citation container
    element.classList.contains('source-inline-chip-container') ||
    // NanoBanana watermark remover indicator (🍌 emoji)
    element.classList.contains('nanobanana-indicator') ||
    // Generated image overlay controls (share/copy/download buttons)
    element.classList.contains('generated-image-controls') ||
    // A plugin's drawn diagram: its host code block, kept in the page, exports the source.
    element.classList.contains('gv-diagram-panel') ||
    (element.classList.contains('hide-from-message-actions') &&
      !element.matches('.image-container, single-image, generated-image') &&
      !element.querySelector('img.hero-image, img.spark-licensed-portrait, img.image'))
  ) {
    return true;
  }

  return false;
}

/** Set by the code-block diagram plugins (`verbs/codeBlockDiagram.ts`) on a block they hide. */
const DIAGRAM_HIDDEN_ATTR = 'data-gv-diagram-hidden';

export function stripExportArtifacts(root: HTMLElement): void {
  const selector = [
    'style',
    'script',
    'noscript',
    'template',
    'button',
    'mat-icon',
    'model-thoughts',
    'sources-carousel-inline',
    'source-inline-chips',
    'source-inline-chip',
    'share-button',
    'copy-button',
    'download-generated-image-button',
    '.model-thoughts',
    '.copy-button',
    '.action-button',
    '.table-footer',
    '.export-sheets-button',
    '.thoughts-header',
    '.source-inline-chip-container',
    '.nanobanana-indicator',
    '.generated-image-controls',
    '.hide-from-message-actions',
    '.gv-diagram-panel',
  ].join(',');

  root.querySelectorAll(selector).forEach((el) => {
    // WaveDrom skins live in an embedded SVG stylesheet. List extraction
    // strips UI artifacts before it replaces the wrapper with the exported
    // SVG, so preserve that one content-bearing style element.
    if (el.localName === 'style' && el.closest('.gv-wavedrom-wrapper')) return;
    el.remove();
  });
  // Image export renders the clone in the page, where a diagram plugin's hiding CSS still applies.
  for (const el of [root, ...Array.from(root.querySelectorAll(`[${DIAGRAM_HIDDEN_ATTR}]`))]) {
    el.removeAttribute(DIAGRAM_HIDDEN_ATTR);
  }
}

/**
 * querySelector that skips matches inside Gemini's thinking panel. An expanded
 * panel renders its own `message-content` before the real response.
 */
export function queryOutsideThoughts<T extends Element = Element>(
  root: Element,
  selector: string,
): T | null {
  const candidates = root.querySelectorAll<T>(selector);
  for (const el of Array.from(candidates)) {
    if (!el.closest('model-thoughts, .thoughts-container, .thoughts-content')) {
      return el;
    }
  }
  return null;
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function escapeHtmlAttribute(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;');
}
