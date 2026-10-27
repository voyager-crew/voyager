// Resolves the anchor element for the inline export dropdown (Gemini's logo).
//
// Why this exists: the lr26 UI refresh removed `[data-test-id="logo"]` entirely
// (see persistentExportToolbar.ts). The old code waited out the full 6s + 2s
// `waitForElement` timeout for a logo that will never appear, which delayed the
// fallback persistent export toolbar by several seconds on every conversation
// load. Short-circuit to `null` immediately on the logoless layout so the
// toolbar mounts right away, while keeping the original wait for older layouts
// where the logo may mount slightly after navigation.

import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/export-entry-packaged.json';

export type WaitForElement = (selector: string, timeoutMs?: number) => Promise<Element | null>;

const LOGO_SELECTORS = packaged['exportEntry.logo'];
const LOGO_SELECTOR = LOGO_SELECTORS.join(', ');

export async function resolveExportLogoAnchor(
  waitForElement: WaitForElement,
  doc: Document = document,
): Promise<Element | null> {
  // Already in the DOM (typical on older layouts) — use it, no waiting.
  const present = doc.querySelector(LOGO_SELECTOR);
  if (present) return present;

  // lr26 (and later) refresh removed the logo for good. Don't wait for what
  // won't come; fall straight through to the persistent-toolbar fallback.
  if (doc.body?.classList.contains('lr26')) return null;

  // Older layout where the logo may still mount post-navigation: keep waiting.
  return (
    (await waitForElement(LOGO_SELECTORS[0], 6000)) ||
    (await waitForElement(LOGO_SELECTORS[1], 2000))
  );
}
