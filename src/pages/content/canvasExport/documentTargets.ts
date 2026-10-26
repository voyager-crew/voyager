import { hasVoyagerOwner } from '@/core/gemini/composer/ownedInput';
import { getGeminiSelectorView } from '@/core/gemini/selectors';
import { locatorSiteForHost } from '@/core/selectors/sites';
import { sameItems } from '@/core/utils/array';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/canvas-packaged.json';
import entry from '@/features/plugins/catalog/sites/gemini/selector-data/export-entry-packaged.json';

const KEY = 'canvas.documentEditors';
const BUNDLED = packaged[KEY].join(', ');
const FOREIGN =
  'deep-research-immersive-panel, input-area, rich-textarea, form, dialog, [role="dialog"], button, a, input, textarea, [contenteditable]';

function remoteEnabled(doc: Document): boolean {
  return (
    locatorSiteForHost(doc.defaultView?.location.hostname ?? '') === 'gemini' &&
    getGeminiSelectorView().remoteKeys.has(KEY)
  );
}

/** Native ProseMirror sources identify one immediate shell per Canvas document. */
export function resolveCanvasDocumentRoots(doc: Document): HTMLElement[] {
  const native = Array.from(doc.querySelectorAll<HTMLElement>(BUNDLED));
  if (!remoteEnabled(doc)) return native;
  try {
    const candidates = Array.from(
      doc.querySelectorAll<HTMLElement>(getGeminiSelectorView().profiles[KEY].join(',')),
    );
    if (native.length) return sameItems(candidates, native) ? candidates : native;
    const sources = Array.from(
      doc.querySelectorAll<HTMLElement>(packaged['canvas.proseMirror']),
    ).filter((source) => !!source.closest(entry['canvasEntry.owner']));
    // A partial list or a shared ancestor must not merge two exported document titles and bodies.
    if (!sources.length || candidates.length !== sources.length) return native;
    return candidates.every((candidate, index) => {
      const source = sources[index];
      return (
        source.parentElement === candidate &&
        source.matches('[contenteditable="true"]') &&
        candidate !== source.closest(entry['canvasEntry.owner']) &&
        !candidate.closest(FOREIGN) &&
        !hasVoyagerOwner(candidate)
      );
    })
      ? candidates
      : native;
  } catch {
    return native;
  }
}

export function resolveFirstCanvasDocumentRoot(doc: Document): HTMLElement | null {
  return remoteEnabled(doc)
    ? (resolveCanvasDocumentRoots(doc)[0] ?? null)
    : doc.querySelector(BUNDLED);
}
