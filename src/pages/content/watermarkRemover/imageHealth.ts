import { GENERATED_IMAGE_PACKAGED, findGeneratedPreviewForButton } from './generatedImageTargets';
import {
  IMAGE_HEALTH_SAMPLE_SIZE,
  type ImageHealthFingerprint,
  createImageHealthFingerprint,
  detectCorruptedGeminiDownload,
} from './imageHealthDetector';

/** Source-aware preview sampling and comparison with the native downloaded image. */
export function createImageHealthMonitor(fetchImage: (url: string) => Promise<HTMLImageElement>) {
  const previewFingerprintsByImage = new WeakMap<
    HTMLImageElement,
    { sourceSrc: string; fingerprint: ImageHealthFingerprint }
  >();
  const captureImageFingerprint = (
    image: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number },
  ): ImageHealthFingerprint | null => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = IMAGE_HEALTH_SAMPLE_SIZE;
      canvas.height = IMAGE_HEALTH_SAMPLE_SIZE;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return null;

      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      return createImageHealthFingerprint(
        imageData.data,
        canvas.width,
        canvas.height,
        image.naturalWidth || canvas.width,
        image.naturalHeight || canvas.height,
      );
    } catch {
      // A tainted cross-origin preview cannot be sampled safely. In that case we
      // skip the warning instead of risking a false positive.
      return null;
    }
  };

  const findPreviewImageForDownloadButton = (
    button: HTMLButtonElement,
  ): HTMLImageElement | null => {
    const inlineImage = findGeneratedPreviewForButton(button);
    if (inlineImage) return inlineImage;

    const dialog = button.closest(GENERATED_IMAGE_PACKAGED['generatedImage.dialog']);
    return (
      dialog?.querySelector<HTMLImageElement>(
        GENERATED_IMAGE_PACKAGED['generatedImage.dialogImage'],
      ) ?? null
    );
  };

  const capturePreviewFingerprint = async (
    button: HTMLButtonElement,
  ): Promise<ImageHealthFingerprint | null> => {
    const image = findPreviewImageForDownloadButton(button);
    if (!image) return null;
    const cached = previewFingerprintsByImage.get(image);
    const isCurrentSource = cached?.sourceSrc === image.src;
    const isProcessedFromCachedSource =
      image.dataset.watermarkProcessed === 'true' &&
      image.dataset.processedUrl === image.src &&
      cached?.sourceSrc === image.dataset.watermarkOriginalSrc;
    if (cached && (isCurrentSource || isProcessedFromCachedSource)) return cached.fingerprint;

    const fingerprint = captureImageFingerprint(image);
    if (fingerprint) {
      previewFingerprintsByImage.set(image, { sourceSrc: image.src, fingerprint });
      return fingerprint;
    }

    // Gemini preview images normally come from googleusercontent.com without a
    // crossorigin attribute. Drawing those DOM images taints the canvas, so
    // pixel readback above fails even though the image is visibly loaded. Reuse
    // the extension-runtime fetch path to obtain an origin-clean copy while the
    // native download intent remains synchronous.
    const sourceSrc = image.src;
    if (!/^https?:/i.test(sourceSrc)) return null;
    try {
      const cleanImage = await fetchImage(sourceSrc);
      const fetchedFingerprint = captureImageFingerprint(cleanImage);
      if (fetchedFingerprint && image.src === sourceSrc) {
        previewFingerprintsByImage.set(image, {
          sourceSrc,
          fingerprint: fetchedFingerprint,
        });
      }
      return fetchedFingerprint;
    } catch (error) {
      console.warn('[Gemini Voyager] Failed to capture preview fingerprint:', error);
      return null;
    }
  };

  const rememberPreview = (image: HTMLImageElement, sourceSrc: string): void => {
    const fingerprint = captureImageFingerprint(image);
    if (fingerprint) previewFingerprintsByImage.set(image, { sourceSrc, fingerprint });
  };

  const compare = (preview: ImageHealthFingerprint, image: HTMLImageElement) => {
    const downloaded = captureImageFingerprint(image);
    return downloaded ? detectCorruptedGeminiDownload(preview, downloaded) : null;
  };

  return { rememberPreview, capturePreview: capturePreviewFingerprint, compare };
}
