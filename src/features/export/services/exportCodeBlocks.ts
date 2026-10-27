import {
  DIAGRAM_OWNER_ATTR,
  readDiagramExport,
} from '@/features/plugins/verbs/diagramExportRegistry';
import {
  requestEChartsDataUrl,
  resolveEChartsExportContainer,
} from '@/pages/content/echarts/exportBridge';

import {
  DEFAULT_EXPORT_CODE_PROFILE,
  cloneExportCodeProfile,
  closestExportCodeHost,
  exportCodeHosts,
  firstExportCodeHost,
  matchesExportCodeHost,
  type ExportCodeProfile,
} from './exportCodeProfile';
import { escapeHtml, normalizeText, stripExportArtifacts } from './exportDomPolicy';

const MERMAID_WRAPPER_SELECTOR = '.gv-mermaid-wrapper';
const MERMAID_RENDERED_SVG_SELECTOR = '.gv-mermaid-diagram svg';
const MERMAID_LIGHT_EXPORT_TEMPLATE_SELECTOR = 'template.gv-mermaid-light-export';
const MERMAID_EXPORT_CLASS = 'gv-export-mermaid';
const MERMAID_THEME_ATTRIBUTE = 'data-gv-mermaid-theme';
const WAVEDROM_WRAPPER_SELECTOR = '.gv-wavedrom-wrapper';
const WAVEDROM_RENDERED_SVG_SELECTOR = '.gv-wavedrom-diagram svg';
const WAVEDROM_EXPORT_CLASS = 'gv-export-wavedrom';
const ECHARTS_WRAPPER_SELECTOR = '.gv-echarts-wrapper';
const ECHARTS_RENDERED_DIAGRAM_SELECTOR = '.gv-echarts-diagram';
const ECHARTS_RENDERED_CANVAS_SELECTOR = '.gv-echarts-diagram canvas';
const ECHARTS_EXPORT_CLASS = 'gv-export-echarts';

/*
 * Export markup of a drawn diagram. The image and print pipelines style and
 * rasterize these containers (`mermaidSvgImage.ts`, `mermaidExportStyles.ts`),
 * so Gemini's native renderers and the diagram primitives
 * (`verbs/diagramExportRegistry.ts`) both build them here.
 */

/** A Mermaid diagram drawn in the light theme. */
export function mermaidExportHtml(lightSvg: Element): string {
  const exportContainer = document.createElement('div');
  exportContainer.className = MERMAID_EXPORT_CLASS;
  exportContainer.setAttribute(MERMAID_THEME_ATTRIBUTE, 'light');
  exportContainer.appendChild(lightSvg.cloneNode(true));
  return exportContainer.outerHTML;
}

export function waveDromExportHtml(svg: Element): string {
  const exportContainer = document.createElement('div');
  exportContainer.className = WAVEDROM_EXPORT_CLASS;
  exportContainer.appendChild(svg.cloneNode(true));
  return exportContainer.outerHTML;
}

/**
 * A PNG of the ECharts chart in `diagram` (its `.gv-echarts-diagram` container),
 * or null when it has no drawn canvas or the pixels cannot be read.
 */
export function echartsExportHtml(diagram: HTMLElement): string | null {
  const canvas = diagram.querySelector<HTMLCanvasElement>(ECHARTS_RENDERED_CANVAS_SELECTOR);
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null;
  try {
    const liveExport = requestEChartsDataUrl(diagram);
    const dataUrl = liveExport.handled ? liveExport.dataUrl : canvas.toDataURL('image/png');
    if (!dataUrl) return null;
    const exportContainer = document.createElement('div');
    exportContainer.className = ECHARTS_EXPORT_CLASS;
    const img = document.createElement('img');
    img.src = dataUrl;
    const chartDescription =
      diagram.getAttribute('aria-label')?.trim() ||
      canvas.getAttribute('aria-label')?.trim() ||
      diagram.querySelector<HTMLElement>('[aria-label]')?.getAttribute('aria-label')?.trim();
    img.alt = chartDescription || 'Chart';
    const inlineWidth = canvas.style.width.endsWith('px')
      ? Number.parseFloat(canvas.style.width)
      : 0;
    const displayWidth = canvas.getBoundingClientRect().width || canvas.clientWidth || inlineWidth;
    if (displayWidth > 0) {
      img.width = Math.round(displayWidth);
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
    }
    exportContainer.appendChild(img);
    return exportContainer.outerHTML;
  } catch {
    // Tainted/read-only canvas: the caller falls back to the option source.
    return null;
  }
}

function extractMermaidContent(
  wrapper: HTMLElement,
  profile: ExportCodeProfile,
): { html: string; text: string } | null {
  const renderedSvg = wrapper.querySelector<SVGSVGElement>(MERMAID_RENDERED_SVG_SELECTOR);
  const lightExportSvg = wrapper
    .querySelector<HTMLTemplateElement>(MERMAID_LIGHT_EXPORT_TEMPLATE_SELECTOR)
    ?.content.querySelector<SVGSVGElement>('svg');
  const codeBlock = firstExportCodeHost(wrapper, profile);
  const codeContent = codeBlock ? extractCodeBlock(codeBlock, 'mermaid') : { html: '', text: '' };
  const renderedTheme = wrapper.getAttribute(MERMAID_THEME_ATTRIBUTE);
  const svg =
    renderedTheme === 'light' ? renderedSvg : renderedTheme === 'dark' ? lightExportSvg : null;

  if (svg) return { html: mermaidExportHtml(svg), text: codeContent.text };

  return codeContent.text ? codeContent : null;
}

function extractWavedromContent(
  wrapper: HTMLElement,
  profile: ExportCodeProfile,
): { html: string; text: string } | null {
  const renderedSvg = wrapper.querySelector<SVGSVGElement>(WAVEDROM_RENDERED_SVG_SELECTOR);
  const codeBlock = firstExportCodeHost(wrapper, profile);
  const codeContent = codeBlock ? extractCodeBlock(codeBlock, 'wavedrom') : { html: '', text: '' };

  if (renderedSvg) return { html: waveDromExportHtml(renderedSvg), text: codeContent.text };

  return codeContent.text ? codeContent : null;
}

function extractEchartsContent(
  wrapper: HTMLElement,
  renderedWrapper: HTMLElement = wrapper,
  profile: ExportCodeProfile = DEFAULT_EXPORT_CODE_PROFILE,
): { html: string; text: string } | null {
  const diagram =
    resolveEChartsExportContainer(renderedWrapper) ??
    renderedWrapper.querySelector<HTMLElement>(ECHARTS_RENDERED_DIAGRAM_SELECTOR);
  const codeBlock = firstExportCodeHost(wrapper, profile);
  const codeContent = codeBlock ? extractCodeBlock(codeBlock, 'echarts') : { html: '', text: '' };

  const html = diagram ? echartsExportHtml(diagram) : null;
  if (html) return { html, text: codeContent.text };
  return codeContent.text ? codeContent : null;
}

/** Keep hidden diagram sources and nested code shells out of the shared DOM-order walk. */
export function findExportCodeBlocks(
  container: Element,
  profile: ExportCodeProfile = DEFAULT_EXPORT_CODE_PROFILE,
): HTMLElement[] {
  const selector = `${MERMAID_WRAPPER_SELECTOR}, ${WAVEDROM_WRAPPER_SELECTOR}, ${ECHARTS_WRAPPER_SELECTOR}, ${profile.blocks}`;
  const elements = [
    ...(container.matches(selector) ? [container as HTMLElement] : []),
    ...Array.from(container.querySelectorAll<HTMLElement>(selector)),
  ];

  return elements.filter((element) => {
    if (element.matches(MERMAID_WRAPPER_SELECTOR)) {
      return true;
    }
    if (element.matches(WAVEDROM_WRAPPER_SELECTOR)) {
      return true;
    }
    if (element.matches(ECHARTS_WRAPPER_SELECTOR)) {
      return true;
    }
    if (profile.acceptedHosts && !matchesExportCodeHost(element, profile)) return false;
    if (
      element.closest(
        `${MERMAID_WRAPPER_SELECTOR}, ${WAVEDROM_WRAPPER_SELECTOR}, ${ECHARTS_WRAPPER_SELECTOR}`,
      )
    )
      return false;
    if (element.parentElement && closestExportCodeHost(element.parentElement, profile))
      return false;
    return true;
  });
}

export function extractCodeBlock(
  element: HTMLElement,
  languageOverride?: string,
): { html: string; text: string } {
  const codeElement = element.querySelector('code[role="text"], code');
  const code = codeElement?.textContent || '';

  // Try to detect language from class or label
  let language = languageOverride ?? '';
  const langLabel = languageOverride ? null : element.querySelector('.code-block-decoration');
  if (langLabel) {
    language = normalizeText(langLabel.textContent || '').toLowerCase();
  }

  return {
    html: `<pre><code class="language-${language}">${escapeHtml(code)}</code></pre>`,
    text: `\`\`\`${language}\n${code}\n\`\`\``,
  };
}

export function extractCodeFromCodeElement(
  codeEl: HTMLElement,
  profile: ExportCodeProfile = DEFAULT_EXPORT_CODE_PROFILE,
): { html: string; text: string } {
  const code = codeEl.textContent || '';
  // Try to infer language from class names like "language-python"
  let language = '';
  const className = (codeEl.getAttribute('class') || '').toLowerCase();
  const langMatch = className.match(/language-([a-z0-9]+)/i);
  if (langMatch) {
    language = langMatch[1];
  } else {
    // Try to find a nearby header label inside a surrounding code-block component
    const parentBlock = closestExportCodeHost(codeEl, profile, true);
    if (parentBlock) {
      const label = parentBlock.querySelector('.code-block-decoration');
      if (label) {
        language = normalizeText(label.textContent || '').toLowerCase();
      }
    }
  }
  return {
    html: `<pre><code class="language-${language}">${escapeHtml(code)}</code></pre>`,
    text: `\`\`\`${language}\n${code}\n\`\`\``,
  };
}

/**
 * The drawing a diagram plugin registered for a live code block, on any host,
 * or null when `element` is no such block or its drawing cannot be read now
 * (then the block exports its source).
 */
export function readDrawnDiagramBlock(element: Element): { html: string; text: string } | null {
  return element.hasAttribute(DIAGRAM_OWNER_ATTR) ? readDiagramExport(element) : null;
}

export function extractExportCodeBlock(
  element: HTMLElement,
  profile: ExportCodeProfile = DEFAULT_EXPORT_CODE_PROFILE,
): { html: string; text: string } | null {
  if (element.matches(MERMAID_WRAPPER_SELECTOR)) return extractMermaidContent(element, profile);
  if (element.matches(WAVEDROM_WRAPPER_SELECTOR)) return extractWavedromContent(element, profile);
  if (element.matches(ECHARTS_WRAPPER_SELECTOR))
    return extractEchartsContent(element, element, profile);
  return readDrawnDiagramBlock(element) ?? extractCodeBlock(element);
}

/** Puts `html`'s first element in place of `element`, if it has one. */
function replaceWithHtml(element: Element, html: string): void {
  const replacement = document.createElement('div');
  replacement.innerHTML = html;
  if (replacement.firstElementChild) element.replaceWith(replacement.firstElementChild);
}

/**
 * Clone markup, but read chart pixels from the matching live owner. `readHostCodeBlock`
 * returns the host adapter's markup for a block it claims ('' drops the block), or null
 * to keep the element.
 */
export function serializeListHtml(
  element: HTMLElement,
  readHostCodeBlock?: (block: HTMLElement) => string | null,
  liveProfile: ExportCodeProfile = DEFAULT_EXPORT_CODE_PROFILE,
): string {
  const liveEchartsWrappers = Array.from(
    element.querySelectorAll<HTMLElement>(ECHARTS_WRAPPER_SELECTOR),
  );
  // Diagram plugins register their drawings on live blocks; pair each clone with
  // its live block by document order before stripping changes the clone.
  const ownedSelector = `[${DIAGRAM_OWNER_ATTR}]`;
  const liveDiagramBlocks = Array.from(element.querySelectorAll<HTMLElement>(ownedSelector));
  const cleanList = element.cloneNode(true) as HTMLElement;
  const profile = cloneExportCodeProfile(element, cleanList, liveProfile);
  const clonedDiagramBlocks = Array.from(cleanList.querySelectorAll<HTMLElement>(ownedSelector));
  stripExportArtifacts(cleanList);
  // After stripping, which would drop the <style> inside a drawn SVG; before the
  // code-block pass below, which would put the source in the drawing's place.
  clonedDiagramBlocks.forEach((clone, index) => {
    const live = liveDiagramBlocks[index];
    const drawn = live ? readDiagramExport(live) : null;
    if (drawn && cleanList.contains(clone)) replaceWithHtml(clone, drawn.html);
  });
  cleanList.querySelectorAll<HTMLElement>(MERMAID_WRAPPER_SELECTOR).forEach((wrapper) => {
    const content = extractMermaidContent(wrapper, profile);
    if (!content) return;

    const replacement = document.createElement('div');
    replacement.innerHTML = content.html;
    if (replacement.firstElementChild) {
      wrapper.replaceWith(replacement.firstElementChild);
    }
  });
  cleanList.querySelectorAll<HTMLElement>(WAVEDROM_WRAPPER_SELECTOR).forEach((wrapper) => {
    const content = extractWavedromContent(wrapper, profile);
    if (!content) return;

    const replacement = document.createElement('div');
    replacement.innerHTML = content.html;
    if (replacement.firstElementChild) {
      wrapper.replaceWith(replacement.firstElementChild);
    }
  });
  cleanList.querySelectorAll<HTMLElement>(ECHARTS_WRAPPER_SELECTOR).forEach((wrapper, index) => {
    const content = extractEchartsContent(wrapper, liveEchartsWrappers[index] ?? wrapper, profile);
    if (!content) return;

    const replacement = document.createElement('div');
    replacement.innerHTML = content.html;
    if (replacement.firstElementChild) {
      wrapper.replaceWith(replacement.firstElementChild);
    }
  });
  exportCodeHosts(cleanList, profile).forEach((codeBlock) => {
    if (profile.acceptedHosts && !matchesExportCodeHost(codeBlock, profile)) return;
    if (
      codeBlock.closest(
        `${MERMAID_WRAPPER_SELECTOR}, ${WAVEDROM_WRAPPER_SELECTOR}, ${ECHARTS_WRAPPER_SELECTOR}`,
      )
    )
      return;
    if (codeBlock.parentElement && closestExportCodeHost(codeBlock.parentElement, profile)) return;

    const content = extractCodeBlock(codeBlock);
    const replacement = document.createElement('div');
    replacement.innerHTML = content.html;
    if (replacement.firstElementChild) {
      codeBlock.replaceWith(replacement.firstElementChild);
    }
  });
  if (readHostCodeBlock) {
    for (const block of Array.from(cleanList.querySelectorAll<HTMLElement>('*'))) {
      // Skip what a replaced ancestor took with it.
      if (!cleanList.contains(block)) continue;
      const html = readHostCodeBlock(block);
      if (html === null) continue;

      const replacement = document.createElement('div');
      replacement.innerHTML = html;
      if (replacement.firstElementChild) {
        block.replaceWith(replacement.firstElementChild);
      } else {
        block.remove();
      }
    }
  }
  return cleanList.outerHTML;
}
