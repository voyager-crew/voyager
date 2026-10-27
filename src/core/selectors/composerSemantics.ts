import { provesChatgptComposerRoot } from '../services/composer/chatgptRootProof';
import { isEditable } from '../services/composer/find';
import {
  resolveComposerOperation,
  type ComposerSelectors,
} from '../services/composer/siteComposerOperation';
import { nativeSiteComposerRoot, ownedSiteInputs } from '../services/composer/siteInputReads';
import { getBundledSiteSelectorView } from './bundle';
import type { SiteSelectorView } from './types';

const KEYS = ['composer', 'composerRoot', 'sendButton'] as const;
export type ComposerSemanticKey = (typeof KEYS)[number];

export function isComposerSemanticKey(key: string): key is ComposerSemanticKey {
  return KEYS.some((candidate) => candidate === key);
}

/** Semantic DOM operations obey the same original input/form/send ownership as native actions. */
export function guardedComposerSemanticSelector(
  key: ComposerSemanticKey,
  view: SiteSelectorView,
  doc: Document,
): string | undefined {
  const bundle = getBundledSiteSelectorView(view.siteId);
  const fallback = bundle.profiles[key]?.join(',');
  if (!KEYS.some((candidate) => view.remoteKeys.has(candidate))) return fallback;
  if (key === 'composerRoot' && view.siteId === 'chatgpt' && view.remoteKeys.has(key)) {
    try {
      const selector = view.profiles[key].join(',');
      const composer = guardedComposerSemanticSelector('composer', view, doc);
      const fields = composer ? Array.from(doc.querySelectorAll<HTMLElement>(composer)) : [];
      const root = fields[0]?.closest(selector);
      return fields.length === 1 &&
        root &&
        provesChatgptComposerRoot(doc, selector, fields[0], root)
        ? selector
        : fallback;
    } catch {
      return fallback;
    }
  }

  const select = (source: SiteSelectorView): ComposerSelectors => ({
    composer: source.profiles.composer?.join(',') ?? ':not(*)',
    composerRoot: bundle.profiles.composerRoot?.join(',') ?? ':not(*)',
    sendButton: source.profiles.sendButton?.join(',') ?? ':not(*)',
  });
  const original = select(bundle);
  try {
    const accepted = resolveComposerOperation(
      { id: view.siteId },
      doc,
      select(view),
      (selectors, prove) => {
        const fields = Array.from(doc.querySelectorAll<HTMLElement>(selectors.composer));
        const field = fields.find(isEditable) ?? null;
        const root = field ? nativeSiteComposerRoot(view.siteId, field) : null;
        const controls = Array.from(doc.querySelectorAll<HTMLElement>(selectors.sendButton));
        const control = controls.find((candidate) => root?.contains(candidate)) ?? null;
        if (prove) {
          const nativeFields = ownedSiteInputs(view.siteId, doc);
          // A selector used by declarative operations must not also name a foreign editor or button.
          if (
            !field ||
            fields.length !== 1 ||
            nativeFields.length !== 1 ||
            nativeFields[0] !== field ||
            controls.some((candidate) => candidate !== control) ||
            (view.remoteKeys.has('sendButton') && controls.length !== 1)
          ) {
            return { field: null, root: null, control: null, selectors: original };
          }
        }
        return { field, root, control, selectors };
      },
    );
    return accepted.selectors[key];
  } catch {
    return fallback;
  }
}
