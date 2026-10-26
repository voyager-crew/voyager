import { getPageSelectorSiteId } from '@/core/selectors';
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
export function exportLayoutData(root?: HTMLElement): typeof gemini {
  const siteId =
    root?.dataset.gvPlatform || getPageSelectorSiteId(root?.ownerDocument) || 'generic';
  return Object.hasOwn(LAYOUTS, siteId) ? LAYOUTS[siteId] : generic;
}

export function resolveExportToolbarControls(root?: HTMLElement): { readonly selector: string } {
  return { selector: exportLayoutData(root).controls.join(',') };
}

/** Measurements and mutation admission share the packaged control set. */
export function exportToolbarMutationControls(root?: HTMLElement): string {
  return exportLayoutData(root).controls.join(',');
}
