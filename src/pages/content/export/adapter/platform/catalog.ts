import { extractCodeFromCodeElement } from '@/features/export/services/exportCodeBlocks';
import { escapeHtmlAttribute } from '@/features/export/services/exportDomPolicy';
import { extractLatexSource, isDisplayMode } from '@/features/formulaCopy/formulaSource';
import type { SiteAdapter } from '@/features/plugins/types';

import { exportSiteSnapshot } from '../exportSiteSnapshot';
import type { ExportPlatformAdapter } from './contract';

/** Site facts stay in site.json; the shared extractor owns rich-text conversion. */
export function buildCatalogExportAdapter(provided: SiteAdapter): ExportPlatformAdapter {
  const site = exportSiteSnapshot(provided);
  const formula: ExportPlatformAdapter['extractInlineFormula'] = (element, html, text) => {
    if (!element.matches('.katex, .katex-display, [data-math]')) return;
    const source = extractLatexSource(element as HTMLElement);
    if (!source) return;
    const display = isDisplayMode(element as HTMLElement);
    html.push(
      `<span class="${display ? 'math-block' : 'math-inline'}" data-math="${escapeHtmlAttribute(source)}">${element.outerHTML}</span>`,
    );
    text.push(display ? `\n$$\n${source}\n$$\n` : `$${source}$`);
    return true;
  };
  return {
    site,
    siteId: site.id,
    getUserSelectors: () => (site.selectors.userTurn ? [site.selectors.userTurn] : []),
    getAssistantSelectors: () =>
      site.selectors.assistantTurn ? [site.selectors.assistantTurn] : [],
    extractConversationIdFromUrl: () => {
      const pattern = site.conversationIdPattern;
      return pattern ? (new RegExp(pattern).exec(location.pathname)?.[1] ?? null) : null;
    },
    extractConversationTitle: () =>
      (site.export?.title ? document.querySelector(site.export.title)?.textContent?.trim() : '') ||
      document.title.trim() ||
      site.label,
    resolveConversationRoot: (_selectors, doc) =>
      (site.selectors.scrollContainer
        ? doc.querySelector<HTMLElement>(site.selectors.scrollContainer)
        : null) ?? doc.body,
    extractUserImage: (element) => element.querySelectorAll('img'),
    extractUserText: (_lines, parts, element) => {
      const text = (element.innerText || element.textContent || '').trim();
      if (text) parts.push(text);
    },
    getUserAttachmentCandidates: () => undefined,
    // Inline images are already handled by exportRichText; this hook owns block images.
    extractAssistantImage: (element, html, text, flags, tag, _debug, seen) => {
      if (tag !== 'img') return;
      const image = element as HTMLImageElement;
      const src = image.currentSrc || image.src;
      if (image.getAttribute('aria-hidden') === 'true' || !src || seen?.has(src)) return true;
      seen?.add(src);
      flags.hasImages = true;
      html.push(
        `<img src="${escapeHtmlAttribute(src)}" alt="${escapeHtmlAttribute(image.alt)}" />`,
      );
      text.push(`\n![${image.alt.replace(/\]/g, '\\]')}](${src})\n`);
      return true;
    },
    extractFormula: (element, flags, html, text) => {
      const consumed = formula(element, html, text);
      if (consumed) flags.hasFormulas = true;
      return consumed;
    },
    extractInlineFormula: formula,
    extractCodeBlock: (element, html, text, flags, tag) => {
      if (tag !== 'pre') return;
      const code = element.querySelector<HTMLElement>('code') ?? (element as HTMLElement);
      const content = extractCodeFromCodeElement(code);
      html.push(content.html);
      text.push(`\n${content.text}\n`);
      flags.hasCode = true;
      (code as HTMLElement & { processedByGV?: boolean }).processedByGV = true;
      return true;
    },
  };
}

export function hasCatalogExport(site: SiteAdapter): boolean {
  return Boolean(
    site.export &&
    site.selectors.userTurn &&
    site.selectors.assistantTurn &&
    site.selectors.scrollContainer,
  );
}
