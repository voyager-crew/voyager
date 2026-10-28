import { getPageSelectorSiteId, getSiteSelectorView } from '@/core/selectors';
import { readInputPlacement } from '@/core/services/composer/inputPlacement';
import { SiteRegistry } from '@/features/plugins/sites/registry';
import type { PromptSiteAdapter, PromptTriggerSpot } from '@/features/prompt/PromptSiteAdapter';

import { insertTextIntoChatInput } from '../chatInput/index';
import { expandInputCollapseIfNeeded } from '../inputCollapse/index';
import { getScheme } from '../platformTheme/scheme';
import { detectPageScheme } from './pageScheme';

/**
 * Beside the Angular Material button nearest the bottom-right corner: Gemini's
 * and AI Studio's floating action button, when the page has one.
 */
function besideMaterialFab(ballHeight: number): PromptTriggerSpot | null {
  const fab = readInputPlacement(
    'input.fab',
    (selector) => Array.from(document.querySelectorAll(selector)),
    document,
    false,
  )
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0)
    .sort((a, b) => a.bottom + a.right - (b.bottom + b.right))
    .at(-1);
  if (!fab) return null;
  const gap = 10;
  return {
    right: Math.max(6, Math.round(window.innerWidth - fab.left + gap)),
    bottom: Math.max(
      6,
      Math.round(window.innerHeight - (fab.top + fab.height / 2 + ballHeight / 2)),
    ),
  };
}

/** A website without a bundled adapter keeps Prompt Manager's generic page behavior. */
const CUSTOM_WEBSITE: PromptSiteAdapter = {
  slash: false,
  insert: insertTextIntoChatInput,
  scheme: detectPageScheme,
  defaultTriggerSpot: besideMaterialFab,
  highlightPlatform: 'gemini',
};

/** Catalog adapters require a published FAB locator before using that placement. */
function besidePublishedFab(height: number): PromptTriggerSpot | null {
  const site = getPageSelectorSiteId();
  return site && getSiteSelectorView(site).remoteKeys.has('input.fab')
    ? besideMaterialFab(height)
    : null;
}

function insertIntoCollapsedComposer(text: string): boolean {
  // A folded composer has no height for insertion until input collapse expands it.
  expandInputCollapseIfNeeded();
  return insertTextIntoChatInput(text);
}

export function resolvePromptSiteAdapter(url: string): PromptSiteAdapter {
  // The default registry contains bundled adapters only, never remote site overrides.
  const adapter = SiteRegistry.createDefault().resolveByUrl(url);
  if (!adapter) return { ...CUSTOM_WEBSITE };
  const prompt = adapter.prompt;
  return {
    slash: prompt?.slash ?? false,
    insert: prompt?.expandCollapsedComposer ? insertIntoCollapsedComposer : insertTextIntoChatInput,
    scheme: prompt?.scheme === 'page' ? detectPageScheme : getScheme,
    defaultTriggerSpot: prompt?.triggerSpot === 'fab' ? besideMaterialFab : besidePublishedFab,
    highlightPlatform: prompt?.highlightScope ?? 'gemini',
  };
}
