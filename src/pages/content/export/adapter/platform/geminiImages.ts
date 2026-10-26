// Consume only image hosts, or their wrapper's prose and captions disappear.
// Lazy image URLs and figure captions must reach HTML for copy-as-image.
// Sweep images beside markdown, skipping walked hosts so they stay in DOM order.
import {
  type ExtractedContent,
  processYouTubeCovers,
} from '@/features/export/services/DOMContentExtractor';
import {
  escapeHtml,
  escapeHtmlAttribute,
  normalizeText,
} from '@/features/export/services/exportDomPolicy';
import imageSelectors from '@/features/plugins/catalog/sites/gemini/selector-data/image-export-packaged.json';

import { bundledGeminiSearchImageSelector, collectGeminiImageHosts } from './geminiImageRead';

type ImageFlags = Pick<ExtractedContent, 'hasImages' | 'hasFormulas' | 'hasTables' | 'hasCode'>;

const GENERATED_IMAGE_HOST_SELECTOR = imageSelectors['imageExport.generatedHosts'].join(', ');
const YOUTUBE_SELECTORS = {
  thumbnails: imageSelectors['imageExport.youtubeThumbnails'].join(', '),
  card: imageSelectors['imageExport.youtubeCard'].join(', '),
  title: imageSelectors['imageExport.youtubeTitle'].join(', '),
};

const SKIP_IMAGE_ANCESTOR_SELECTOR = [
  'model-thoughts',
  '.thoughts-container',
  '.thoughts-content',
  'mat-icon',
  '.katex',
  '.katex-html',
  'youtube-block',
  'single-video',
  '.attachment-container.youtube',
  'share-button',
  'copy-button',
  'download-generated-image-button',
  '.generated-image-controls',
].join(', ');

const PLACEHOLDER_SRC_PATTERN = /^(?:about:blank|data:image\/gif;base64,R0lGODlhAQAB)/i;

type ImageAttribution = {
  caption: string;
  sourceLabel: string;
  sourceUrl: string;
};

function isPlaceholderSrc(src: string): boolean {
  return !src || PLACEHOLDER_SRC_PATTERN.test(src);
}

function firstSrcsetUrl(srcset: string): string {
  return srcset.split(',')[0]?.trim().split(/\s+/)[0] || '';
}

export function resolveGeminiImageSrc(image: HTMLImageElement, host?: Element | null): string {
  const dataSrc =
    image.getAttribute('data-src') ||
    image.getAttribute('data-original-src') ||
    image.getAttribute('data-full-size-image-uri') ||
    '';
  const fullSize =
    host?.getAttribute('data-full-size-image-uri') ||
    image.closest('[data-full-size-image-uri]')?.getAttribute('data-full-size-image-uri') ||
    '';
  const candidates = [
    image.currentSrc,
    image.src,
    dataSrc,
    image.getAttribute('src') || '',
    firstSrcsetUrl(image.getAttribute('srcset') || ''),
    fullSize,
  ];
  return candidates.find((src) => !isPlaceholderSrc(src)) || '';
}

function isImageHost(element: Element, searchSelector: string): boolean {
  return element.matches(`${searchSelector}, ${GENERATED_IMAGE_HOST_SELECTOR}`);
}

function isNestedImageHost(element: Element, searchSelector: string): boolean {
  return !!element.parentElement?.closest(`${searchSelector}, ${GENERATED_IMAGE_HOST_SELECTOR}`);
}

function isChromeWrappedImage(image: HTMLImageElement): boolean {
  const button = image.closest('button');
  if (!button) return false;
  // Licensed / search hero shots are the <img> inside Gemini's image-button.
  if (button.classList.contains('image-button')) return false;
  if (image.closest('single-image, generated-image, .image-container')) return false;
  return true;
}

function contentImages(host: Element): HTMLImageElement[] {
  const preferred = Array.from(
    host.querySelectorAll<HTMLImageElement>(
      imageSelectors['imageExport.preferredImages'].join(', '),
    ),
  );
  const images =
    preferred.length > 0 ? preferred : Array.from(host.querySelectorAll<HTMLImageElement>('img'));
  return images.filter((image) => {
    if (image.classList.contains('katex-svg')) return false;
    if (image.closest(SKIP_IMAGE_ANCESTOR_SELECTOR)) return false;
    if (isChromeWrappedImage(image)) return false;
    return true;
  });
}

function readAttribution(host: Element): ImageAttribution {
  const sourceAnchor = host.querySelector<HTMLAnchorElement>(
    imageSelectors['imageExport.sourceAnchor'].join(', '),
  );
  const caption = normalizeText(
    host.querySelector(imageSelectors['imageExport.caption'].join(', '))?.textContent || '',
  );
  const sourceLabel = normalizeText(
    host.querySelector(imageSelectors['imageExport.sourceLabel'].join(', '))?.textContent ||
      sourceAnchor?.textContent ||
      '',
  );
  const sourceUrl = sourceAnchor?.href || host.getAttribute('data-full-size-image-uri') || '';
  return { caption, sourceLabel, sourceUrl };
}

function attributionLine(attribution: ImageAttribution): string {
  if (attribution.caption) return attribution.caption;
  if (attribution.sourceLabel && attribution.sourceUrl) {
    return `Source: [${attribution.sourceLabel}](${attribution.sourceUrl})`;
  }
  if (attribution.sourceLabel) return `Source: ${attribution.sourceLabel}`;
  if (attribution.sourceUrl) return `Source: ${attribution.sourceUrl}`;
  return '';
}

function emitFigure(
  images: Array<{ src: string; alt: string }>,
  attribution: ImageAttribution,
  htmlParts: string[],
  textParts: string[],
): void {
  const imgHtml = images
    .map(
      (image) =>
        `<img src="${escapeHtmlAttribute(image.src)}" alt="${escapeHtmlAttribute(image.alt)}" />`,
    )
    .join('');
  const caption = attributionLine(attribution);
  if (caption) {
    htmlParts.push(
      `<figure class="gv-export-figure">${imgHtml}<figcaption>${escapeHtml(caption)}</figcaption></figure>`,
    );
  } else {
    htmlParts.push(imgHtml);
  }

  images.forEach((image, index) => {
    const markdown = `![${image.alt.replace(/\]/g, '\\]')}](${image.src})`;
    const suffix = index === images.length - 1 && caption ? `\n*${caption}*` : '';
    textParts.push(`\n${markdown}${suffix}\n`);
  });
}

function emitFromHost(
  host: Element,
  htmlParts: string[],
  textParts: string[],
  flags: ImageFlags,
  processedImageSrcs: Set<string> | undefined,
  fallbackAlt: string,
): boolean {
  const emitted: Array<{ src: string; alt: string }> = [];
  for (const image of contentImages(host)) {
    const src = resolveGeminiImageSrc(image, host);
    if (!src || processedImageSrcs?.has(src)) continue;
    processedImageSrcs?.add(src);
    emitted.push({ src, alt: image.alt || fallbackAlt });
  }
  if (emitted.length === 0) return false;

  flags.hasImages = true;
  emitFigure(emitted, readAttribution(host), htmlParts, textParts);
  return true;
}

function emitStandaloneImage(
  image: HTMLImageElement,
  htmlParts: string[],
  textParts: string[],
  flags: ImageFlags,
  processedImageSrcs: Set<string> | undefined,
): void {
  const src = resolveGeminiImageSrc(image);
  if (!src || processedImageSrcs?.has(src)) return;
  processedImageSrcs?.add(src);
  flags.hasImages = true;
  const alt = image.alt || 'Image';
  htmlParts.push(`<img src="${escapeHtmlAttribute(src)}" alt="${escapeHtmlAttribute(alt)}" />`);
  textParts.push(`\n![${alt.replace(/\]/g, '\\]')}](${src})\n`);
}

function fallbackAltFor(host: Element, searchSelector: string): string {
  if (host.matches(GENERATED_IMAGE_HOST_SELECTOR) && !host.matches(searchSelector)) {
    return 'Generated image';
  }
  return 'Search result image';
}

export function extractGeminiAssistantImage(
  child: Element,
  htmlParts: string[],
  textParts: string[],
  flags: ImageFlags,
  tagName?: string,
  _DEBUG?: boolean,
  processedImageSrcs?: Set<string>,
  searchSelector: string = bundledGeminiSearchImageSelector(),
): boolean | undefined {
  if (tagName === 'img') {
    if (child.closest(SKIP_IMAGE_ANCESTOR_SELECTOR) || child.classList.contains('katex-svg')) {
      return true;
    }
    emitStandaloneImage(child as HTMLImageElement, htmlParts, textParts, flags, processedImageSrcs);
    return true;
  }

  if (isImageHost(child, searchSelector)) {
    emitFromHost(
      child,
      htmlParts,
      textParts,
      flags,
      processedImageSrcs,
      fallbackAltFor(child, searchSelector),
    );
    return true;
  }

  if (
    child.querySelector(imageSelectors['imageExport.youtubeThumbnails'].join(', ')) &&
    processYouTubeCovers(child, htmlParts, textParts, flags, YOUTUBE_SELECTORS)
  ) {
    return true;
  }
}

export function collectGeminiAssistantImages(
  root: Element,
  htmlParts: string[],
  textParts: string[],
  flags: ImageFlags,
  processedImageSrcs?: Set<string>,
  skipInside?: Element | null,
  searchSelector: string = bundledGeminiSearchImageSelector(),
): void {
  const seen = new Set<Element>();
  for (const host of collectGeminiImageHosts(
    root,
    `${searchSelector}, ${GENERATED_IMAGE_HOST_SELECTOR}`,
  )) {
    if (seen.has(host)) continue;
    seen.add(host);
    if (host.closest('model-thoughts, .thoughts-container, .thoughts-content')) continue;
    if (host.closest('.attachment-container.youtube, youtube-block, single-video')) continue;
    if (skipInside && skipInside !== host && skipInside.contains(host)) continue;
    if (isNestedImageHost(host, searchSelector)) continue;
    emitFromHost(
      host,
      htmlParts,
      textParts,
      flags,
      processedImageSrcs,
      fallbackAltFor(host, searchSelector),
    );
  }
}
