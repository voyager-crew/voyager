import { hasVoyagerOwner } from '@/core/gemini/composer/ownedInput';
import { hasGeminiBoundaryConflict } from '@/core/gemini/domBoundary';
import {
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  resolveGeminiSelectorOperationInView,
  type GeminiSelectorView,
} from '@/core/gemini/selectors';
import {
  GEMINI_GEMS_CATALOG_PROFILE_KEYS,
  type GeminiGemsProfileKey,
} from '@/core/gemini/selectors/gemsKeys';
import { sameItems } from '@/core/utils/array';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/gems-packaged.json';

import { parseGemHref, type GemMetadata } from './catalog';

export { packaged as gemsPackagedSelectors };

export interface GemRowRead {
  readonly row: Element;
  readonly anchor: HTMLAnchorElement;
  readonly metadata: GemMetadata | null;
}

export type GemsListSource = 'bundled' | 'remote';

export interface GemsListRead {
  readonly list: Element | null;
  readonly rows: readonly GemRowRead[];
  readonly source: GemsListSource;
}

export function gemsSelector(key: GeminiGemsProfileKey, view: GeminiSelectorView): string {
  return view.profiles[key].join(', ');
}

function first(
  root: ParentNode,
  key: GeminiGemsProfileKey,
  view: GeminiSelectorView,
): Element | null {
  for (const selector of view.profiles[key]) {
    const element = root.querySelector(selector);
    if (element) return element;
  }
  return null;
}

function text(element: Element | null): string | undefined {
  return element?.textContent?.trim() || undefined;
}

function nativeLinks(root: ParentNode): HTMLAnchorElement[] {
  return Array.from(root.querySelectorAll<HTMLAnchorElement>(packaged.nativeLink)).filter(
    (anchor) => parseGemHref(anchor.getAttribute('href') ?? '') !== null,
  );
}

function nativeNode(element: Element): boolean {
  const boundary =
    element.closest('bot-list-row, bard-sidenav, side-navigation-content, chat-window') ??
    element.querySelector(packaged.nativeRow);
  return (
    !hasGeminiBoundaryConflict(
      element,
      boundary,
      `${packaged.excluded}, dialog, [role="alertdialog"], [role="menu"]`,
    ) && !hasVoyagerOwner(element)
  );
}

function readList(doc: Document, view: GeminiSelectorView, remote: boolean): GemsListRead | null {
  const bundle = getBundledGeminiSelectorView();
  const list = doc.querySelector(gemsSelector('gems.list', view));
  if (!list) return { list: null, rows: [], source: remote ? 'remote' : 'bundled' };
  const rows = Array.from(list.querySelectorAll(gemsSelector('gems.row', view)));
  if (remote) {
    const bundledList = doc.querySelector(gemsSelector('gems.list', bundle));
    // A repaired list must cover the native catalog and agree with the bundled root.
    if (!nativeNode(list) || (bundledList && bundledList !== list)) return null;
    if (!bundledList) {
      const nativeRows = Array.from(doc.querySelectorAll(packaged.nativeRow)).filter(nativeNode);
      if (
        !nativeRows.length ||
        !sameItems(nativeRows, Array.from(list.querySelectorAll(packaged.nativeRow)))
      )
        return null;
    }
    const bundledRows = Array.from(list.querySelectorAll(gemsSelector('gems.row', bundle)));
    if (bundledRows.length && !sameItems(rows, bundledRows)) return null;
    const expectedLinks = nativeLinks(list);
    const rowLinks = rows.flatMap(nativeLinks);
    if (
      !expectedLinks.length ||
      !sameItems(rowLinks, expectedLinks) ||
      rows.some((row) => nativeLinks(row).length !== 1)
    )
      return null;
  }
  const reads: GemRowRead[] = [];
  for (const row of rows) {
    const anchor = row.querySelector<HTMLAnchorElement>(packaged.link);
    const parsed = parseGemHref(anchor?.getAttribute('href') ?? '');
    if (!anchor) continue;
    if (!parsed) {
      if (remote) return null;
      reads.push({ row, anchor, metadata: null });
      continue;
    }
    const name = text(first(anchor, 'gems.title', view));
    const description = text(first(anchor, 'gems.description', view));
    const iconLetter = text(first(anchor, 'gems.icon', view));
    if (remote) {
      // Remote metadata needs independent native evidence, including optional descriptions.
      for (const [key, evidence] of [
        ['gems.title', packaged.titleEvidence],
        ['gems.description', packaged.descriptionEvidence],
        ['gems.icon', packaged.iconEvidence],
      ] as const) {
        const candidate = first(anchor, key, view);
        const original = first(anchor, key, bundle);
        const expected = original ?? anchor.querySelector(evidence);
        if (
          text(candidate) !== text(expected) ||
          (original && candidate !== original) ||
          (candidate && (!expected?.contains(candidate) || !nativeNode(candidate)))
        )
          return null;
      }
    }
    reads.push({
      row,
      anchor,
      metadata: name ? { id: parsed.id, href: parsed.path, name, description, iconLetter } : null,
    });
  }
  return { list, rows: reads, source: remote ? 'remote' : 'bundled' };
}

/** One accepted view supplies the observer root, pins and all metadata in a scrape. */
export function readGemsList(doc: Document = document): GemsListRead {
  const view = getGeminiSelectorView();
  const remote = GEMINI_GEMS_CATALOG_PROFILE_KEYS.some((key) => view.remoteKeys.has(key));
  if (!remote) return readList(doc, getBundledGeminiSelectorView(), false)!;
  return (
    resolveGeminiSelectorOperationInView(
      view,
      (selected) => readList(doc, selected, selected === view),
      (read) => read !== null && read.list !== null,
    ).value ?? { list: null, rows: [], source: 'bundled' }
  );
}

/** A repaired nav entry must still be the native Gems navigation link. */
export function isNativeGemsNavEntry(element: Element): boolean {
  if (!nativeNode(element)) return false;
  const anchors =
    element instanceof HTMLAnchorElement
      ? [element]
      : Array.from(element.querySelectorAll<HTMLAnchorElement>(packaged.nativeLink));
  return (
    anchors.length === 1 &&
    (() => {
      try {
        const url = new URL(anchors[0].href, location.origin);
        return url.origin === location.origin && /^\/(?:u\/\d+\/)?gems(?:\/|$)/.test(url.pathname);
      } catch {
        return false;
      }
    })()
  );
}
