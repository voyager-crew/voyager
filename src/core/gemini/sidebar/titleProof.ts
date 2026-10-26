import { hasVoyagerOwner } from '../composer/ownedInput';
import { getBundledGeminiSelectorView, getGeminiSelectorView } from '../selectors';

export type GeminiTitleKey =
  | 'title.export'
  | 'title.active'
  | 'title.activeExport'
  | 'title.activeResearch'
  | 'sidebar.pageTitle';

const normalize = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim();

/** The URL and native sidebar link, not the proposed title node, identify the saved chat. */
export function currentGeminiSidebarTitle(doc: Document): string | null {
  const location = doc.defaultView?.location;
  if (!location) return null;
  const match = location.pathname.match(/^(\/u\/\d+)?\/(?:app|gem\/[^/]+)\/([^/?#]+)/);
  if (!match) return null;
  const titles = new Set<string>();
  for (const link of doc.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (
      hasVoyagerOwner(link) ||
      !link.closest('bard-sidenav, side-nav, side-navigation-content, nav, [role="navigation"]') ||
      link.closest('main, model-response, user-query, [role="dialog"]')
    )
      continue;
    const url = new URL(link.href, location.href);
    const linked = url.pathname.match(/^(\/u\/\d+)?\/(?:app|gem\/[^/]+)\/([^/?#]+)/);
    if (
      url.origin !== location.origin ||
      !linked ||
      linked[1] !== match[1] ||
      linked[2] !== match[2]
    )
      continue;
    const title = normalize(
      link.getAttribute('aria-label') ||
        link.getAttribute('title') ||
        link.querySelector(
          '[data-test-id="conversation-title"], .conversation-title, .title-text, [mat-line]',
        )?.textContent ||
        link.textContent,
    );
    if (title) titles.add(title);
  }
  return titles.size === 1 ? [...titles][0] : null;
}

/** Preserve each caller's ordered/joined read and avoid all proof work on the bundled path. */
export function geminiTitleSelectors(
  key: GeminiTitleKey,
  root: ParentNode = document,
): readonly string[] {
  const view = getGeminiSelectorView();
  const bundle = getBundledGeminiSelectorView().profiles[key];
  if (!view.remoteKeys.has(key)) return bundle;
  const doc = root instanceof Document ? root : root.ownerDocument;
  const expected = doc && currentGeminiSidebarTitle(doc);
  if (!expected) return bundle;
  const candidates = view.profiles[key];
  const nodes = candidates.flatMap((selector) => Array.from(root.querySelectorAll(selector)));
  // A title repair must never save another conversation's label or a partial heading.
  return nodes.length &&
    nodes.every((node) => !hasVoyagerOwner(node) && normalize(node.textContent) === expected)
    ? candidates
    : bundle;
}
