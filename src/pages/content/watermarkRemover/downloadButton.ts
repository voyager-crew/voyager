import bundled from '@/features/plugins/catalog/sites/gemini/selector-data/generated-image.json';

import { GENERATED_IMAGE_PACKAGED, findGeneratedDownloadIcon } from './generatedImageTargets';

export const DOWNLOAD_ICON_SELECTOR = bundled['generatedImage.downloadIcon'].join(', ');

/**
 * Selector for an ancestor that proves the button belongs to a Gemini-generated
 * image. Two cases:
 *  - `<generated-image>` / `.generated-image-container` — the in-message toolbar
 *  - `<download-generated-image-button>` — the same component is reused inside
 *    the lightbox (`<expansion-dialog>` rendered into `cdk-overlay-container`),
 *    where neither of the above ancestors is present. The custom element name
 *    is Gemini-specific so user-uploaded image previews still won't match.
 */
const GENERATED_IMAGE_CONTAINER_SELECTOR = GENERATED_IMAGE_PACKAGED['generatedImage.downloadOwner'];

/**
 * Check if an element is within a generated image container (toolbar or lightbox).
 */
function isWithinGeneratedImageContainer(element: Element): boolean {
  return element.closest(GENERATED_IMAGE_CONTAINER_SELECTOR) !== null;
}

export function findNativeDownloadButton(target: EventTarget | null): HTMLButtonElement | null {
  if (!(target instanceof Element)) return null;

  // First check: must be within a generated-image container
  // This prevents triggering on user-uploaded image previews or other download buttons
  if (!isWithinGeneratedImageContainer(target)) return null;

  const dataTestButton = target.closest(
    GENERATED_IMAGE_PACKAGED['generatedImage.downloadDataButton'],
  );
  if (dataTestButton) return dataTestButton as HTMLButtonElement;

  const hostButton = target.closest(GENERATED_IMAGE_PACKAGED['generatedImage.downloadHostButton']);
  if (hostButton) return hostButton as HTMLButtonElement;

  const icon = target.closest(DOWNLOAD_ICON_SELECTOR);
  const buttonFromIcon = icon?.closest('button');
  if (buttonFromIcon) return buttonFromIcon as HTMLButtonElement;

  const button = target.closest(GENERATED_IMAGE_PACKAGED['generatedImage.button']);
  if (button && findGeneratedDownloadIcon(button)) {
    return button as HTMLButtonElement;
  }

  return null;
}
