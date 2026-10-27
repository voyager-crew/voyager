import { logger } from '@/core/services/LoggerService';

import { recordWatermarkPresence } from '../watermarkNativeNotice/cleanStreak';
import {
  GENERATED_IMAGE_PACKAGED,
  findGeneratedDownloadIcon,
  findGeneratedImageOwner,
  findGeneratedPreviewImages,
} from './generatedImageTargets';
import type { WatermarkEngine } from './watermarkEngine';

/** The 🍌 badge on a download button that saves the unwatermarked image. */
const INDICATOR_CLASS = 'gv-watermark-indicator';
/** The class earlier versions gave the badge; replaced wherever a new one goes. */
const LEGACY_INDICATOR_SELECTOR = '.nanobanana-indicator';

/**
 * Preview writes and indicators share the preview observer while it runs. The caller
 * invalidates the generation/preview flag before stop; pending images then release
 * their queue slots and retry only when the latest state still enables previews.
 * watchIndicators runs before engine readiness; start upgrades to preview processing.
 */
export function createWatermarkPreviews({
  getState,
  fetchImage,
  health,
}: {
  getState: () => {
    engine: WatermarkEngine | null;
    generation: number;
    previewEnabled: boolean;
    downloadEnabled: boolean;
  };
  fetchImage: (url: string) => Promise<HTMLImageElement>;
  health: { rememberPreview: (image: HTMLImageElement, sourceSrc: string) => void };
}) {
  const processingQueue = new Set<HTMLImageElement>();
  const replacements = new Map<
    HTMLImageElement,
    {
      originalSrc: string | null;
      originalSrcset: string | null;
      processedUrl: string;
    }
  >();
  let previewObserver: MutationObserver | null = null;
  let indicatorObserver: MutationObserver | null = null;
  const previewTimeouts = new Set<ReturnType<typeof setTimeout>>();
  const indicatorTimeouts = new Set<ReturnType<typeof setTimeout>>();

  /**
   * Debounce function to limit execution frequency
   */
  const debounce = <T extends (...args: unknown[]) => void>(
    func: T,
    wait: number,
    pendingDebounceTimeouts: Set<ReturnType<typeof setTimeout>>,
  ): T => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    return ((...args: unknown[]) => {
      if (timeout) {
        clearTimeout(timeout);
        pendingDebounceTimeouts.delete(timeout);
      }
      timeout = setTimeout(() => {
        if (timeout) pendingDebounceTimeouts.delete(timeout);
        timeout = null;
        func(...args);
      }, wait);
      pendingDebounceTimeouts.add(timeout);
    }) as T;
  };

  /**
   * Convert canvas to blob
   */
  const canvasToBlob = (canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> =>
    new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to convert canvas to blob'));
      }, type);
    });

  const isValidGeminiImage = (img: HTMLImageElement): boolean =>
    findGeneratedImageOwner(img) !== null;

  /**
   * Find all Gemini-generated images on the page
   */
  const findGeminiImages = (): HTMLImageElement[] =>
    findGeneratedPreviewImages(document).filter((img) => img.dataset.watermarkProcessed !== 'true');

  /** Restore only attributes still owned by this runtime; never overwrite Gemini's newer image. */
  const restorePreview = (img: HTMLImageElement): void => {
    const replacement = replacements.get(img);
    if (replacement) {
      if (
        img.getAttribute('src') === replacement.processedUrl &&
        img.getAttribute('srcset') === null
      ) {
        if (replacement.originalSrc === null) img.removeAttribute('src');
        else img.setAttribute('src', replacement.originalSrc);
        if (img.getAttribute('srcset') === null && replacement.originalSrcset !== null) {
          img.setAttribute('srcset', replacement.originalSrcset);
        }
      }
      if (img.dataset.processedUrl === replacement.processedUrl) {
        delete img.dataset.watermarkProcessed;
        delete img.dataset.watermarkOriginalSrc;
        delete img.dataset.processedUrl;
      }
      // A host-owned srcset may still fall back to our src; keep that blob valid.
      if (img.getAttribute('src') !== replacement.processedUrl)
        URL.revokeObjectURL(replacement.processedUrl);
      replacements.delete(img);
    }
  };

  const restorePreviews = (): void => {
    for (const img of replacements.keys()) restorePreview(img);
    for (const img of processingQueue) {
      if (img.dataset.watermarkProcessed === 'processing') delete img.dataset.watermarkProcessed;
    }
  };

  /**
   * Replace image URL size parameter to get full resolution
   */
  const replaceWithNormalSize = (src: string): string => {
    // Use normal size image to fit watermark
    return src.replace(/=[swh]\d+(?:-[wh]\d+)*/, '=s0');
  };

  /**
   * Attach the 🍌 badge (`.gv-watermark-indicator`, styled in contentStyle)
   * to a download button. The badge lives INSIDE the button because Gemini wraps
   * it in `<gem-icon-button>` which has `overflow: hidden`, so any negative
   * offset overhanging the wrapper would be clipped.
   */
  function attachIndicatorToButton(nativeButton: HTMLButtonElement): void {
    // Idempotency: don't add a second indicator to the same button.
    if (nativeButton.querySelector(`.${INDICATOR_CLASS}`)) return;
    // A script orphaned by an extension update leaves its old badge behind.
    nativeButton.querySelector(LEGACY_INDICATOR_SELECTOR)?.remove();

    const indicator = document.createElement('span');
    indicator.className = INDICATOR_CLASS;
    indicator.textContent = '🍌';
    indicator.title =
      chrome.i18n.getMessage('nanobananaDownloadTooltip') || 'Download unwatermarked image';

    // mdc-icon-button is `position: relative` by default; guard against future
    // Gemini changes that might flip it to static.
    if (getComputedStyle(nativeButton).position === 'static') {
      nativeButton.style.position = 'relative';
    }
    nativeButton.appendChild(indicator);
  }

  /**
   * Add the 🍌 indicator to the native download button via the
   * preview-image path. Looks up the button through the generated-image
   * container; for the lightbox/expansion-dialog path, see
   * decorateDownloadButtons() which walks every `<download-generated-image-button>`
   * host (toolbar AND lightbox).
   */
  function addDownloadIndicator(imgElement: HTMLImageElement): void {
    const container = findGeneratedImageOwner(imgElement);
    if (!container) return;

    const nativeDownloadIcon = findGeneratedDownloadIcon(container);
    const nativeButton = nativeDownloadIcon?.closest('button');
    if (!nativeButton) return;

    attachIndicatorToButton(nativeButton as HTMLButtonElement);
  }

  /**
   * Process a single image to remove watermark (for preview images)
   */
  async function processImage(imgElement: HTMLImageElement): Promise<void> {
    const { engine, generation } = getState();
    if (!engine || processingQueue.has(imgElement)) return;
    let stale = false;
    const isStale = (): boolean => {
      const state = getState();
      stale =
        generation !== state.generation ||
        !state.previewEnabled ||
        !imgElement.isConnected ||
        imgElement.src !== originalSrc ||
        imgElement.getAttribute('srcset') !== originalSrcset;
      return stale;
    };

    processingQueue.add(imgElement);
    imgElement.dataset.watermarkProcessed = 'processing';

    const originalSrc = imgElement.src;
    const originalSrcAttribute = imgElement.getAttribute('src');
    const originalSrcset = imgElement.getAttribute('srcset');
    try {
      health.rememberPreview(imgElement, originalSrc);

      // Fetch full resolution image via background script (bypasses CORS)
      const normalSizeSrc = replaceWithNormalSize(originalSrc);
      const normalSizeImg = await fetchImage(normalSizeSrc);
      if (isStale()) return;

      // Process image to remove watermark
      const processedCanvas = await engine.removeWatermarkFromImage(normalSizeImg, (presence) => {
        if (!isStale()) void recordWatermarkPresence(presence);
      });
      if (isStale()) return;
      const processedBlob = await canvasToBlob(processedCanvas);
      if (isStale()) return;

      // Replace image source with processed blob URL
      const processedUrl = URL.createObjectURL(processedBlob);
      replacements.set(imgElement, {
        originalSrc: originalSrcAttribute,
        originalSrcset,
        processedUrl,
      });
      imgElement.dataset.watermarkOriginalSrc = originalSrc;
      // Native srcset would override the cleaned src; restore it only while still owned.
      imgElement.removeAttribute('srcset');
      imgElement.src = processedUrl;
      imgElement.dataset.watermarkProcessed = 'true';
      imgElement.dataset.processedUrl = processedUrl; // Store for reference

      logger.debug('[Gemini Voyager] Watermark removed from preview image');

      if (getState().downloadEnabled) {
        addDownloadIndicator(imgElement);
      }
    } catch (error) {
      if (isStale()) return;
      console.warn('[Gemini Voyager] Failed to process image for watermark removal:', error);
      imgElement.dataset.watermarkProcessed = 'failed';
    } finally {
      processingQueue.delete(imgElement);
      if (stale) {
        if (imgElement.dataset.watermarkProcessed === 'processing') {
          delete imgElement.dataset.watermarkProcessed;
        }
        // A full restart can invalidate this task while leaving preview removal
        // enabled (for example, when only the download toggle changed). Retry
        // after releasing the queue slot so the latest lifecycle owns the write.
        if (
          getState().previewEnabled &&
          imgElement.isConnected &&
          isValidGeminiImage(imgElement) &&
          imgElement.src.includes('googleusercontent.com')
        ) {
          void processImage(imgElement);
        }
      }
    }
  }

  /**
   * Process all Gemini-generated images on the page (preview path)
   */
  const processAllImages = (): void => {
    if (!getState().previewEnabled) return;
    // Gemini detaches old conversations; release their images and owned blobs promptly.
    for (const img of replacements.keys()) {
      if (!img.isConnected) restorePreview(img);
    }
    const images = findGeminiImages();
    images.forEach(processImage);

    if (getState().downloadEnabled) {
      // Re-run the indicator pass so blob-src previews and late-loading native
      // buttons still pick up the 🍌 badge (idempotent).
      decorateDownloadButtons();
    }
  };

  /**
   * Add the 🍌 indicator to every Gemini-generated image's download button.
   *
   * Walks `<download-generated-image-button>` hosts directly instead of going
   * through the img element. This covers:
   *  1. The in-message toolbar (host lives inside `<generated-image>`)
   *  2. The lightbox / `<expansion-dialog>` rendered into `cdk-overlay-container`
   *     — same custom element, but NOT inside any `generated-image` container.
   *
   * Also independent of the img src (blob: vs googleusercontent.com).
   */
  const decorateDownloadButtons = (): void => {
    if (!getState().downloadEnabled) return;
    const hosts = document.querySelectorAll<HTMLElement>(
      GENERATED_IMAGE_PACKAGED['generatedImage.downloadHost'],
    );
    hosts.forEach((host) => {
      const button = host.querySelector<HTMLButtonElement>(
        GENERATED_IMAGE_PACKAGED['generatedImage.button'],
      );
      if (button) attachIndicatorToButton(button);
    });
  };

  /**
   * Setup MutationObserver to watch for new images and run the preview pipeline.
   */
  const setupMutationObserver = (): void => {
    if (previewObserver) return;
    const debouncedProcess = debounce(processAllImages, 100, previewTimeouts);
    previewObserver = new MutationObserver(debouncedProcess);
    previewObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true, // Watch for attribute changes (like native buttons appearing)
      attributeFilter: ['class', 'src'],
    });
    logger.debug('[Gemini Voyager] Watermark remover MutationObserver active');
  };

  /**
   * Lighter MutationObserver that skips the canvas pipeline and only decorates
   * download buttons. It also covers the engine-loading window before the full
   * preview observer can take over.
   */
  const setupIndicatorObserver = (): void => {
    if (indicatorObserver || previewObserver) return;
    const debouncedDecorate = debounce(decorateDownloadButtons, 100, indicatorTimeouts);
    indicatorObserver = new MutationObserver(debouncedDecorate);
    indicatorObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'src'],
    });
    logger.debug('[Gemini Voyager] Watermark download-indicator observer active');
  };
  const watchIndicators = (): void => {
    decorateDownloadButtons();
    setupIndicatorObserver();
  };

  const stopIndicatorObserver = (): void => {
    indicatorObserver?.disconnect();
    indicatorObserver = null;
    for (const timeout of indicatorTimeouts) clearTimeout(timeout);
    indicatorTimeouts.clear();
  };

  const start = (): void => {
    // The preview pass decorates downloads too, so one body observer covers both controls.
    stopIndicatorObserver();
    processAllImages();
    setupMutationObserver();
  };

  const stopPreviews = (): void => {
    previewObserver?.disconnect();
    previewObserver = null;
    for (const timeout of previewTimeouts) clearTimeout(timeout);
    previewTimeouts.clear();
    restorePreviews();
    if (getState().downloadEnabled) watchIndicators();
  };

  const stopIndicators = (): void => {
    stopIndicatorObserver();
    document
      .querySelectorAll(`.${INDICATOR_CLASS}, ${LEGACY_INDICATOR_SELECTOR}`)
      .forEach((indicator) => indicator.remove());
  };

  return { watchIndicators, start, stopPreviews, stopIndicators };
}
