import {
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  type GeminiSelectorView,
} from '@/core/gemini/selectors';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/generated-image-packaged.json';

export const GENERATED_IMAGE_PACKAGED = packaged;
const NATIVE_DOWNLOAD_ICON = '[fonticon="download"], [data-mat-icon-name="download"]';

/** Only Google-hosted previews enter the owner walk, as on the original bundled path. */
export function findGeneratedPreviewImages(doc: Document): HTMLImageElement[] {
  return Array.from(
    doc.querySelectorAll<HTMLImageElement>(packaged['generatedImage.previewSource']),
  ).filter((image) => findGeneratedImageOwner(image) !== null);
}

export function findGeneratedImageOwner(image: HTMLImageElement): Element | null {
  return image.closest(packaged['generatedImage.container']);
}

export function findGeneratedPreviewForButton(button: HTMLButtonElement): HTMLImageElement | null {
  return (
    button
      .closest(packaged['generatedImage.container'])
      ?.querySelector<HTMLImageElement>(packaged['generatedImage.image']) ?? null
  );
}

/** Keep the original clicked button; an icon locator never chooses a neighbouring control. */
export function findGeneratedDownloadIcon(
  root: Element,
  view = getGeminiSelectorView(),
): Element | null {
  const bundle = getBundledGeminiSelectorView();
  const read = (selected: GeminiSelectorView) =>
    root.querySelector(selected.profiles['generatedImage.downloadIcon'].join(', '));
  const bundled = read(bundle);
  if (
    root.ownerDocument.defaultView?.location.hostname !== 'gemini.google.com' ||
    !view.remoteKeys.has('generatedImage.downloadIcon')
  )
    return bundled;
  try {
    const candidate = read(view);
    const native = root.querySelector(NATIVE_DOWNLOAD_ICON);
    if (
      candidate &&
      candidate === (bundled ?? native) &&
      root.contains(candidate.closest('button'))
    )
      return candidate;
  } catch {
    // A rejected icon cannot decorate or identify another download button.
  }
  return bundled;
}
