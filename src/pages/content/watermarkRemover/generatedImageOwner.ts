import { hasVoyagerOwner } from '@/core/gemini/composer/ownedInput';
import { getBundledGeminiSelectorView, getGeminiSelectorView } from '@/core/gemini/selectors';
import { acceptsGeminiTurnView, readGeminiTurnCollection } from '@/core/gemini/turnIntegrity';
import { locatorSiteForHost } from '@/core/selectors/sites';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/generated-image-packaged.json';

const KEY = 'generatedImage.container';
const DOWNLOAD =
  'download-generated-image-button button, button[data-test-id="download-generated-image-button"]';
const FOREIGN =
  'user-query, input-area, rich-textarea, form, dialog, [role="dialog"], [contenteditable]';

/** A lookalike hostname must not turn an upload or page image into generated output. */
function isGoogleImage(image: HTMLImageElement): boolean {
  try {
    const source = new URL(image.src);
    return (
      source.protocol === 'https:' &&
      !source.port &&
      (source.hostname === 'googleusercontent.com' ||
        source.hostname.endsWith('.googleusercontent.com'))
    );
  } catch {
    return false;
  }
}

export function generatedImageOwner(node: Element): Element | null {
  const fallback = node.closest(packaged[KEY]);
  const view = getGeminiSelectorView();
  const doc = node.ownerDocument;
  if (
    locatorSiteForHost(doc.defaultView?.location.hostname ?? '') !== 'gemini' ||
    !view.remoteKeys.has(KEY)
  )
    return fallback;
  try {
    const candidate = node.closest(view.profiles[KEY].join(','));
    if (!candidate || fallback) return candidate === fallback ? candidate : fallback;
    if (candidate.closest(FOREIGN) || hasVoyagerOwner(candidate)) return fallback;
    const images = Array.from(candidate.querySelectorAll('img'));
    const buttons = Array.from(candidate.querySelectorAll(DOWNLOAD));
    // The preview and native download must be a single pair; another image cannot borrow this control.
    if (images.length !== 1 || buttons.length !== 1 || !isGoogleImage(images[0])) return fallback;
    if (node instanceof HTMLImageElement ? images[0] !== node : buttons[0] !== node)
      return fallback;
    const turns = readGeminiTurnCollection(
      acceptsGeminiTurnView(view, doc) ? view : getBundledGeminiSelectorView(),
      doc,
      true,
    );
    return turns.assistants.some((turn) => turn !== candidate && turn.contains(candidate))
      ? candidate
      : fallback;
  } catch {
    return fallback;
  }
}
