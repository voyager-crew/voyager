import { getPageSelectorSiteId, getSiteSelectorView } from '@/core/selectors';
import { placementSelector } from '@/core/selectors/placement';
import { resolvePlacementListOperation } from '@/core/selectors/placement';
import aistudio from '@/features/plugins/catalog/sites/aistudio/selector-data/export-layout-packaged.json';
import chatgpt from '@/features/plugins/catalog/sites/chatgpt/selector-data/export-layout-packaged.json';
import claude from '@/features/plugins/catalog/sites/claude/selector-data/export-layout-packaged.json';
import deepseek from '@/features/plugins/catalog/sites/deepseek/selector-data/export-layout-packaged.json';
import gemini from '@/features/plugins/catalog/sites/gemini/selector-data/export-layout-packaged.json';
import kimi from '@/features/plugins/catalog/sites/kimi/selector-data/export-layout-packaged.json';
import type { SiteAdapter } from '@/features/plugins/types';

import generic from './generic-layout.json';

export type ExportLayout = typeof gemini;

const LAYOUTS: Readonly<Record<string, ExportLayout>> = {
  gemini,
  aistudio,
  chatgpt,
  claude,
  deepseek,
  kimi,
};

/** Packaged placement policy and host locators belong to the current site alone. */
export function bundledExportLayoutData(root?: HTMLElement): ExportLayout {
  const siteId =
    root?.dataset.gvPlatform || getPageSelectorSiteId(root?.ownerDocument) || 'generic';
  return Object.hasOwn(LAYOUTS, siteId) ? LAYOUTS[siteId] : generic;
}

/** Closest/matches reads need their own fallback; a match elsewhere cannot satisfy this operation. */
export function readExportLayout<T extends Element | readonly Element[] | null>(
  key: keyof ExportLayout,
  read: (selector: string) => T,
  root?: HTMLElement,
): T {
  const fallback = bundledExportLayoutData(root)[key];
  const list = typeof fallback === 'string' ? [fallback] : fallback;
  const site = root?.dataset.gvPlatform || getPageSelectorSiteId(root?.ownerDocument);
  return site && Object.hasOwn(LAYOUTS, site)
    ? resolvePlacementListOperation(
        getSiteSelectorView(site),
        `exportLayout.${key}`,
        (selectors) => read(selectors.join(',')),
        { fallback: list, mount: false },
      )
    : read(list.join(','));
}

/** One read session per measurement: each field is proved at most once in that frame. */
export function exportLayoutData(root?: HTMLElement): ExportLayout {
  const fallback = bundledExportLayoutData(root);
  const doc = root?.ownerDocument ?? document;
  const siteId = root?.dataset.gvPlatform || getPageSelectorSiteId(doc);
  if (!siteId || !Object.hasOwn(LAYOUTS, siteId)) return fallback;
  const view = getSiteSelectorView(siteId);
  if (view.remoteKeys.size === 0) return fallback;
  if (!Object.keys(fallback).some((key) => view.remoteKeys.has(`exportLayout.${key}`)))
    return fallback;
  const result = { ...fallback };
  for (const key of Object.keys(fallback) as (keyof typeof fallback)[]) {
    const original = fallback[key];
    let value: string | string[] | undefined;
    Object.defineProperty(result, key, {
      enumerable: true,
      get: () => {
        if (value === undefined) {
          const selected = placementSelector(view, `exportLayout.${key}`, doc, { mount: false });
          value = Array.isArray(original) ? [selected] : selected;
        }
        return value;
      },
    });
  }
  return result;
}

/** Prefilter only: a candidate mutation schedules the guarded measurement, never placement. */
export function exportLayoutMutationData(root?: HTMLElement): ExportLayout {
  const fallback = bundledExportLayoutData(root);
  const site = root?.dataset.gvPlatform || getPageSelectorSiteId(root?.ownerDocument);
  if (!site || !Object.hasOwn(LAYOUTS, site)) return fallback;
  const view = getSiteSelectorView(site);
  if (!Object.keys(fallback).some((key) => view.remoteKeys.has(`exportLayout.${key}`)))
    return fallback;
  const result = { ...fallback };
  for (const key of Object.keys(fallback) as (keyof typeof fallback)[]) {
    const original = fallback[key];
    if (!view.remoteKeys.has(`exportLayout.${key}`)) continue;
    const candidates = [
      ...(Array.isArray(original) ? original : [original]),
      ...view.profiles[`exportLayout.${key}`],
    ];
    Object.defineProperty(result, key, {
      enumerable: true,
      value: Array.isArray(original) ? candidates : candidates.join(','),
    });
  }
  return result;
}

/**
 * The site's own conversation turns, appended to the layout's `turns`: the
 * export's message-key holders, which on a virtualized host (Claude) wrap a
 * turn's per-message controls too, and its user and assistant turn selectors.
 * Undefined when the site describes none.
 *
 * The toolbar tests this with `closest()` on every page mutation while a reply
 * streams, so a turn selector using `:has()` is left out: it would scan the
 * streaming message's subtree on each one (DeepSeek, ChatGPT's user turn).
 */
export function siteTurnSelector(site: SiteAdapter): string | undefined {
  const messageKey = site.export?.messageKey;
  const parts = [
    messageKey ? `[${messageKey}]` : undefined,
    site.selectors.userTurn,
    site.selectors.assistantTurn,
  ].filter((part): part is string => Boolean(part) && !part?.includes(':has('));
  return parts.length > 0 ? parts.join(', ') : undefined;
}

let lastTurns: { layout: string; site?: string; combined: string } | null = null;

/**
 * Conversation turns whose controls the toolbar never avoids: the layout's
 * `turns` plus `siteTurns` (see `siteTurnSelector`). A site selector this
 * browser cannot parse falls back to the layout's. It must match messages
 * only: one that matched a header ancestor would put every header control
 * "inside a turn", switching avoidance off for that site.
 */
export function toolbarTurnSelector(layoutTurns: string, siteTurns?: string): string {
  if (!siteTurns) return layoutTurns;
  if (lastTurns?.layout === layoutTurns && lastTurns.site === siteTurns) return lastTurns.combined;
  let combined = `${layoutTurns}, ${siteTurns}`;
  try {
    document.createDocumentFragment().querySelector(combined);
  } catch {
    combined = layoutTurns;
  }
  lastTurns = { layout: layoutTurns, site: siteTurns, combined };
  return combined;
}
