import {
  requestEChartsDataUrl,
  resolveEChartsExportContainer,
} from '@/pages/content/echarts/exportBridge';

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

function extractMermaidContent(wrapper: HTMLElement): { html: string; text: string } | null {
  const renderedSvg = wrapper.querySelector<SVGSVGElement>(MERMAID_RENDERED_SVG_SELECTOR);
  const lightExportSvg = wrapper
    .querySelector<HTMLTemplateElement>(MERMAID_LIGHT_EXPORT_TEMPLATE_SELECTOR)
    ?.content.querySelector<SVGSVGElement>('svg');
  const codeBlock = wrapper.querySelector<HTMLElement>('code-block, .code-block');
  const codeContent = codeBlock ? extractCodeBlock(codeBlock, 'mermaid') : { html: '', text: '' };
  const renderedTheme = wrapper.getAttribute(MERMAID_THEME_ATTRIBUTE);
  const svg =
    renderedTheme === 'light' ? renderedSvg : renderedTheme === 'dark' ? lightExportSvg : null;

  if (svg) {
    const exportContainer = document.createElement('div');
    exportContainer.className = MERMAID_EXPORT_CLASS;
    exportContainer.setAttribute(MERMAID_THEME_ATTRIBUTE, 'light');
    exportContainer.appendChild(svg.cloneNode(true));
    return { html: exportContainer.outerHTML, text: codeContent.text };
  }

  return codeContent.text ? codeContent : null;
}

function extractWavedromContent(wrapper: HTMLElement): { html: string; text: string } | null {
  const renderedSvg = wrapper.querySelector<SVGSVGElement>(WAVEDROM_RENDERED_SVG_SELECTOR);
  const codeBlock = wrapper.querySelector<HTMLElement>('code-block, .code-block');
  const codeContent = codeBlock ? extractCodeBlock(codeBlock, 'wavedrom') : { html: '', text: '' };

  if (renderedSvg) {
    const exportContainer = document.createElement('div');
    exportContainer.className = WAVEDROM_EXPORT_CLASS;
    exportContainer.appendChild(renderedSvg.cloneNode(true));
    return { html: exportContainer.outerHTML, text: codeContent.text };
  }

  return codeContent.text ? codeContent : null;
}

function extractEchartsContent(
  wrapper: HTMLElement,
  renderedWrapper: HTMLElement = wrapper,
): { html: string; text: string } | null {
  const diagram =
    resolveEChartsExportContainer(renderedWrapper) ??
    renderedWrapper.querySelector<HTMLElement>(ECHARTS_RENDERED_DIAGRAM_SELECTOR);
  const canvas = diagram?.querySelector<HTMLCanvasElement>(ECHARTS_RENDERED_CANVAS_SELECTOR);
  const codeBlock = wrapper.querySelector<HTMLElement>('code-block, .code-block');
  const codeContent = codeBlock ? extractCodeBlock(codeBlock, 'echarts') : { html: '', text: '' };

  if (canvas && canvas.width > 0 && canvas.height > 0) {
    try {
      const liveExport = diagram
        ? requestEChartsDataUrl(diagram)
        : { handled: false, dataUrl: null };
      const dataUrl = liveExport.handled ? liveExport.dataUrl : canvas.toDataURL('image/png');
      if (!dataUrl) throw new Error('ECharts composited export unavailable');
      const exportContainer = document.createElement('div');
      exportContainer.className = ECHARTS_EXPORT_CLASS;
      const img = document.createElement('img');
      img.src = dataUrl;
      const chartDescription =
        diagram?.getAttribute('aria-label')?.trim() ||
        canvas.getAttribute('aria-label')?.trim() ||
        diagram?.querySelector<HTMLElement>('[aria-label]')?.getAttribute('aria-label')?.trim();
      img.alt = chartDescription || 'Chart';
      const inlineWidth = canvas.style.width.endsWith('px')
        ? Number.parseFloat(canvas.style.width)
        : 0;
      const displayWidth =
        canvas.getBoundingClientRect().width || canvas.clientWidth || inlineWidth;
      if (displayWidth > 0) {
        img.width = Math.round(displayWidth);
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
      }
      exportContainer.appendChild(img);
      return { html: exportContainer.outerHTML, text: codeContent.text };
    } catch {
      // Tainted/read-only canvas: fall back to the option source below.
    }
  }

  return codeContent.text ? codeContent : null;
}

/** Keep hidden diagram sources and nested code shells out of the shared DOM-order walk. */
export function findExportCodeBlocks(container: Element): HTMLElement[] {
  const selector = `${MERMAID_WRAPPER_SELECTOR}, ${WAVEDROM_WRAPPER_SELECTOR}, ${ECHARTS_WRAPPER_SELECTOR}, code-block, .code-block`;
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
    if (
      element.closest(
        `${MERMAID_WRAPPER_SELECTOR}, ${WAVEDROM_WRAPPER_SELECTOR}, ${ECHARTS_WRAPPER_SELECTOR}`,
      )
    )
      return false;
    if (element.parentElement?.closest('code-block, .code-block')) return false;
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

export function extractCodeFromCodeElement(codeEl: HTMLElement): { html: string; text: string } {
  const code = codeEl.textContent || '';
  // Try to infer language from class names like "language-python"
  let language = '';
  const className = (codeEl.getAttribute('class') || '').toLowerCase();
  const langMatch = className.match(/language-([a-z0-9]+)/i);
  if (langMatch) {
    language = langMatch[1];
  } else {
    // Try to find a nearby header label inside a surrounding code-block component
    const parentBlock = codeEl.closest('code-block') as HTMLElement | null;
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

export function extractExportCodeBlock(
  element: HTMLElement,
): { html: string; text: string } | null {
  if (element.matches(MERMAID_WRAPPER_SELECTOR)) return extractMermaidContent(element);
  if (element.matches(WAVEDROM_WRAPPER_SELECTOR)) return extractWavedromContent(element);
  if (element.matches(ECHARTS_WRAPPER_SELECTOR)) return extractEchartsContent(element);
  return extractCodeBlock(element);
}

/**
 * Clone markup, but read chart pixels from the matching live owner. `readHostCodeBlock`
 * returns the host adapter's markup for a block it claims ('' drops the block), or null
 * to keep the element.
 */
export function serializeListHtml(
  element: HTMLElement,
  readHostCodeBlock?: (block: HTMLElement) => string | null,
): string {
  const liveEchartsWrappers = Array.from(
    element.querySelectorAll<HTMLElement>(ECHARTS_WRAPPER_SELECTOR),
  );
  const cleanList = element.cloneNode(true) as HTMLElement;
  stripExportArtifacts(cleanList);
  cleanList.querySelectorAll<HTMLElement>(MERMAID_WRAPPER_SELECTOR).forEach((wrapper) => {
    const content = extractMermaidContent(wrapper);
    if (!content) return;

    const replacement = document.createElement('div');
    replacement.innerHTML = content.html;
    if (replacement.firstElementChild) {
      wrapper.replaceWith(replacement.firstElementChild);
    }
  });
  cleanList.querySelectorAll<HTMLElement>(WAVEDROM_WRAPPER_SELECTOR).forEach((wrapper) => {
    const content = extractWavedromContent(wrapper);
    if (!content) return;

    const replacement = document.createElement('div');
    replacement.innerHTML = content.html;
    if (replacement.firstElementChild) {
      wrapper.replaceWith(replacement.firstElementChild);
    }
  });
  cleanList.querySelectorAll<HTMLElement>(ECHARTS_WRAPPER_SELECTOR).forEach((wrapper, index) => {
    const content = extractEchartsContent(wrapper, liveEchartsWrappers[index] ?? wrapper);
    if (!content) return;

    const replacement = document.createElement('div');
    replacement.innerHTML = content.html;
    if (replacement.firstElementChild) {
      wrapper.replaceWith(replacement.firstElementChild);
    }
  });
  cleanList.querySelectorAll<HTMLElement>('code-block, .code-block').forEach((codeBlock) => {
    if (
      codeBlock.closest(
        `${MERMAID_WRAPPER_SELECTOR}, ${WAVEDROM_WRAPPER_SELECTOR}, ${ECHARTS_WRAPPER_SELECTOR}`,
      )
    )
      return;
    if (codeBlock.parentElement?.closest('code-block, .code-block')) return;

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
