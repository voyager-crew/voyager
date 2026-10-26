import { getPageSelectorSiteId, getSiteSelectorView } from '@/core/selectors';
import { placementSelector } from '@/core/selectors/placement';
import { resolvePlacementListOperation } from '@/core/selectors/placement';
import aistudio from '@/features/plugins/catalog/sites/aistudio/selector-data/export-layout-packaged.json';
import chatgpt from '@/features/plugins/catalog/sites/chatgpt/selector-data/export-layout-packaged.json';
import claude from '@/features/plugins/catalog/sites/claude/selector-data/export-layout-packaged.json';
import deepseek from '@/features/plugins/catalog/sites/deepseek/selector-data/export-layout-packaged.json';
import gemini from '@/features/plugins/catalog/sites/gemini/selector-data/export-layout-packaged.json';
import kimi from '@/features/plugins/catalog/sites/kimi/selector-data/export-layout-packaged.json';

import generic from './generic-layout.json';

const LAYOUTS: Readonly<Record<string, typeof gemini>> = {
  gemini,
  aistudio,
  chatgpt,
  claude,
  deepseek,
  kimi,
};

/** Packaged placement policy and host locators belong to the current site alone. */
export function bundledExportLayoutData(root?: HTMLElement): typeof gemini {
  const siteId =
    root?.dataset.gvPlatform || getPageSelectorSiteId(root?.ownerDocument) || 'generic';
  return Object.hasOwn(LAYOUTS, siteId) ? LAYOUTS[siteId] : generic;
}

/** Closest/matches reads need their own fallback; a match elsewhere cannot satisfy this operation. */
export function readExportLayout<T extends Element | readonly Element[] | null>(
  key: Exclude<keyof typeof gemini, 'avoidRow'>,
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

/** Getters resolve only the field the current geometry operation reads. */
export function exportLayoutData(root?: HTMLElement): typeof gemini {
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
    if (typeof original === 'boolean') continue;
    Object.defineProperty(result, key, {
      enumerable: true,
      get: () => {
        const value = placementSelector(view, `exportLayout.${key}`, doc, { mount: false });
        return Array.isArray(original) ? [value] : value;
      },
    });
  }
  return result;
}

export function resolveExportToolbarControls(root?: HTMLElement): { readonly selector: string } {
  return { selector: exportLayoutData(root).controls.join(',') };
}

/** Measurements and mutation admission share the packaged control set. */
export function exportToolbarMutationControls(root?: HTMLElement): string {
  return exportLayoutData(root).controls.join(',');
}
