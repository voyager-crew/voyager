import {
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  resolveGeminiSelectorOperationInView,
} from '@/core/gemini/selectors';
import type { GeminiSelectorView } from '@/core/gemini/selectors';
import usage from '@/features/plugins/catalog/sites/gemini/selector-data/usage-packaged.json';

import { isUsagePathname, usageAccountKeyFromPathname } from './usageSnapshot';

type RootRead = 'scrape' | 'observe';

/** These locators identify the metric protocol, and have no safe remote repair witness. */
export const GEMINI_USAGE_CONTENT = usage;

const EXCLUDED =
  'model-response, user-query, bard-sidenav, [role="dialog"], [role="menu"], [contenteditable="true"], #gv-usage-pill';

class UsageRootOwnershipService {
  private readonly accounts = new WeakMap<Element, string | null>();

  accepts(root: Element, accountKey: string): boolean {
    const owner = this.accounts.get(root);
    if (owner === undefined || owner === accountKey) return true;
    // Once reused under another account, the same node cannot prove its original content either.
    this.accounts.set(root, null);
    return false;
  }

  remember(root: Element, accountKey: string): void {
    this.accounts.set(root, accountKey);
  }
}

const ownership = new UsageRootOwnershipService();

/** Bind an already rendered repair before startup storage reads can outlive its account route. */
export function rememberGeminiUsageRootAtStartup(doc: Document = document): void {
  if (getGeminiSelectorView().remoteKeys.has('usage.root')) resolveGeminiUsageRoot(doc);
}

function readRoot(doc: Document, view: GeminiSelectorView, operation: RootRead): Element | null {
  const selectors = view.profiles['usage.root'];
  if (operation === 'observe') return doc.querySelector(selectors.join(','));
  for (const selector of selectors) {
    const root = doc.querySelector(selector);
    if (root) return root;
  }
  return null;
}

function nativeRoot(doc: Document): Element | null {
  const headers = [...doc.querySelectorAll(usage.header)];
  const daily = [...doc.querySelectorAll(usage.daily)];
  const weekly = [...doc.querySelectorAll(usage.weekly)];
  // One header's own region must contain every bucket: never combine separate usage panels.
  if (headers.length !== 1 || daily.length > 1 || weekly.length > 1) return null;
  const root = headers[0].parentElement;
  const buckets = [...daily, ...weekly];
  if (!root || root === doc.body || root === doc.documentElement || buckets.length === 0)
    return null;
  if (!buckets.every((bucket) => root.contains(bucket) && !bucket.closest(EXCLUDED))) return null;
  return root;
}

/** The observer and scraper retain their original bundled root ordering. */
export function resolveGeminiUsageRoot(
  doc: Document = document,
  operation: RootRead = 'scrape',
): Element | null {
  const view = getGeminiSelectorView();
  const bundle = getBundledGeminiSelectorView();
  if (!view.remoteKeys.has('usage.root')) return readRoot(doc, bundle, operation);

  const bundled = readRoot(doc, bundle, operation);
  const pathname = doc.location?.pathname ?? '';
  const accountKey = usageAccountKeyFromPathname(pathname);
  const resolved = resolveGeminiSelectorOperationInView(
    view,
    (candidate) => readRoot(doc, candidate, operation),
    (root) => {
      // A nonempty online match cannot substitute another account/panel for the bundled root.
      if (bundled) return root === bundled;
      if (!isUsagePathname(pathname)) return false;
      // Angular can retain the previous account's usage DOM after the URL already changed.
      return root !== null && root === nativeRoot(doc) && ownership.accepts(root, accountKey);
    },
  );
  if (!bundled && resolved.value && resolved.view === view) {
    ownership.remember(resolved.value, accountKey);
  }
  return resolved.value;
}
