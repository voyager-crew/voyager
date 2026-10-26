import type { ExtractedContentFlags } from './exportContentDialect';
import { normalizeText, escapeHtmlAttribute } from './exportDomPolicy';

export interface YouTubeCoverSelectors {
  thumbnails: string;
  card: string;
  title: string;
}

// Other sites keep the shared extractor's original values, independent of Gemini data.
const SHARED_YOUTUBE_SELECTORS: YouTubeCoverSelectors = {
  thumbnails:
    '.attachment-container.youtube img.thumbnail, youtube-block img.thumbnail, single-video img.thumbnail',
  card: 'single-video, youtube-block, .attachment-container.youtube',
  title: '.video-title, [class*="title"]',
};

/**
 * Extract YouTube video cover thumbnails as clickable cover images.
 *
 * Gemini renders a video as
 *   `.attachment-container.youtube > … > youtube-block > single-video > … > img.thumbnail`
 * plus an `<iframe>` player that can't be exported. The custom elements
 * (youtube-block / single-video / default-player) stop processNodes' generic
 * recursion, so the cover is otherwise dropped. Here we emit the cover image
 * linked to the watch URL so it survives Markdown / PDF / image exports.
 *
 * Deduped across call sites via a `processedByGV` marker on the <img>.
 * Returns true if at least one cover was emitted.
 */
export function processYouTubeCovers(
  scope: Element,
  htmlParts: string[],
  textParts: string[],
  flags: ExtractedContentFlags,
  selectors: YouTubeCoverSelectors = SHARED_YOUTUBE_SELECTORS,
): boolean {
  const thumbs = scope.querySelectorAll<HTMLImageElement>(selectors.thumbnails);
  const videoIdFrom = (u: string | null | undefined): string => {
    const m = (u || '').match(/(?:\/vi\/|[?&]v=|youtu\.be\/|embed\/)([\w-]{11})/);
    return m ? m[1] : '';
  };
  let emitted = false;
  for (const imgEl of Array.from(thumbs)) {
    const marked = imgEl as Element & { processedByGV?: boolean };
    if (marked.processedByGV) continue;
    let src = imgEl.src || imgEl.getAttribute('src') || '';
    if (!src || src === 'about:blank') continue;
    marked.processedByGV = true;

    const card = imgEl.closest(selectors.card) || imgEl.parentElement || scope;
    let videoId = videoIdFrom(src);
    if (!videoId) {
      const ref = card.querySelector('a[href*="youtu"], iframe[src*="youtube"]') as
        | HTMLAnchorElement
        | HTMLIFrameElement
        | null;
      videoId = videoIdFrom(
        (ref as HTMLAnchorElement | null)?.href || (ref as HTMLIFrameElement | null)?.src,
      );
    }
    // Prefer a stable cover URL when we know the id and the live src isn't a ytimg URL.
    if (videoId && !/ytimg\.com|img\.youtube\.com/.test(src)) {
      src = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    }
    const watchUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : '';
    const titleRaw =
      (imgEl.alt && imgEl.alt.trim()) ||
      card.querySelector(selectors.title)?.textContent?.trim() ||
      'YouTube video';
    const title = normalizeText(titleRaw);

    flags.hasImages = true;
    const imgHtml = `<img src="${escapeHtmlAttribute(src)}" alt="${escapeHtmlAttribute(title)}" />`;
    htmlParts.push(
      watchUrl ? `<a href="${escapeHtmlAttribute(watchUrl)}">${imgHtml}</a>` : imgHtml,
    );
    const mdAlt = title.replace(/\]/g, '\\]');
    textParts.push(watchUrl ? `\n[![${mdAlt}](${src})](${watchUrl})\n` : `\n![${mdAlt}](${src})\n`);
    emitted = true;
  }
  return emitted;
}
