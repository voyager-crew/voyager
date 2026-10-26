import type { ExportAttachment } from '../types/export';
import type { ExtractedContent } from './DOMContentExtractor';
import type { ExportContentDialect } from './exportContentDialect';
import { normalizeText, escapeHtml, escapeHtmlAttribute } from './exportDomPolicy';
import { getExportReadProfiles } from './exportSiteData';

export function extractUserContent(
  element: HTMLElement,
  adapter: ExportContentDialect,
): ExtractedContent {
  const result: ExtractedContent = {
    text: '',
    html: '',
    attachments: [],
    hasImages: false,
    hasFormulas: false,
    hasTables: false,
    hasCode: false,
  };

  const images = adapter.extractUserImage(element) ?? [];
  result.hasImages = images.length > 0;

  const attachments = extractUserAttachments(element, adapter);
  result.attachments = attachments;

  // Extract user message text. Each platform exposes its own DOM shape
  // (Gemini's .query-text-line paragraphs vs. ChatGPT's plain text node),
  // so the actual extraction strategy is delegated to the platform adapter.
  const textLines =
    adapter.getUserTextLines?.(element) ??
    element.querySelectorAll<HTMLElement>(
      getExportReadProfiles(adapter.siteId)['export.userLinesFallback'],
    );
  const textParts: string[] = [];
  adapter.extractUserText(textLines, textParts, element);

  result.text = textParts.join('\n');

  // Build HTML representation
  const htmlParts: string[] = [];

  // Add image markdown
  const imageMarkdown: string[] = [];
  images.forEach((img, index) => {
    const src = (img as HTMLImageElement).src;
    const alt = (img as HTMLImageElement).alt || `Uploaded image ${index + 1}`;
    htmlParts.push(`<img src="${escapeHtmlAttribute(src)}" alt="${escapeHtmlAttribute(alt)}" />`);
    imageMarkdown.push(`![${alt}](${src})`);
  });

  attachments.forEach((attachment) => {
    htmlParts.push(
      `<div class="gv-export-attachment"><span class="gv-export-attachment-icon" aria-hidden="true">📄</span><span class="gv-export-attachment-name">${escapeHtml(attachment.name)}</span></div>`,
    );
  });

  // Combine image markdown and text
  const allTextParts: string[] = [];
  if (imageMarkdown.length > 0) {
    allTextParts.push(imageMarkdown.join('\n\n'));
  }
  if (attachments.length > 0) {
    allTextParts.push(attachments.map(({ name }) => `📎 ${name}`).join('\n'));
  }
  if (textParts.length > 0) {
    allTextParts.push(textParts.join('\n'));
  }
  result.text = allTextParts.join('\n\n');

  // Browsers collapse raw newlines; escape first, then add breaks without changing plain text.
  textParts.forEach((text) => {
    htmlParts.push(`<p>${escapeHtml(text).replace(/\n/g, '<br />')}</p>`);
  });

  result.html = htmlParts.join('\n');

  return result;
}

function extractUserAttachments(
  element: HTMLElement,
  adapter: ExportContentDialect,
): ExportAttachment[] {
  const candidates = adapter.getUserAttachmentCandidates(element);
  const previewOwner = getExportReadProfiles(adapter.siteId)['export.attachmentPreviewOwner'];
  const attachments: ExportAttachment[] = [];
  const seen = new Set<string>();

  candidates?.forEach((candidate) => {
    const labelledElement = candidate.matches('[aria-label]')
      ? candidate
      : candidate.querySelector<HTMLElement>('[aria-label]');
    const name =
      labelledElement?.getAttribute('aria-label')?.trim() ||
      candidate.getAttribute('title')?.trim() ||
      normalizeText(candidate.textContent ?? '').replace(
        /^(?:PDF|DOCX?|PPTX?|XLSX?|CSV|TXT|ZIP|FILE)\s+/i,
        '',
      );

    if (!name) return;

    const type = name.match(/\.([a-z0-9]{1,12})$/i)?.[1].toLowerCase() ?? 'file';
    const preview = candidate.closest(previewOwner) ?? candidate;
    const isImage =
      /^(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i.test(type) &&
      !!preview.querySelector('img');
    const key = `${name}\u0000${type}`;

    if (isImage || seen.has(key)) return;

    seen.add(key);
    attachments.push({ name, type });
  });

  return attachments;
}
