import { readChatInput } from '@/core/gemini/composer/inputs';
import { hasVoyagerOwner } from '@/core/gemini/composer/ownedInput';
import {
  getBundledSiteSelectorView,
  getSiteSelectorView,
  resolveSiteSelectorOperationInView,
  type SiteSelectorView,
} from '@/core/selectors';
import { hasForeignPageOwner } from '@/core/selectors/pageProofBoundary';

import { isEditable, type FindComposerOptions } from './find';
import { packagedSiteInputSelectors, type InputSiteId } from './siteInputData';

const NATIVE_EDITABLE = 'textarea, [contenteditable="true"], [contenteditable="plaintext-only"]';
const OTHER_OWNER =
  '[data-message-author-role], [data-conversation-role], [data-gv-plugin], [data-turn-role], [data-turn-key], [data-chatgpt-search-unit-key]';

export function inputCandidates(doc: Document, selectors: readonly string[]): HTMLElement[] {
  return [
    ...new Set(
      selectors.flatMap((selector) =>
        Array.from(doc.querySelectorAll<HTMLElement>(selector)).filter(isEditable),
      ),
    ),
  ];
}

/** Reply/turn/canvas ownership is checked against installed data, never a remote alias. */
export function hasSiteContentOwner(siteId: string, field: HTMLElement): boolean {
  const profiles = getBundledSiteSelectorView(siteId).profiles;
  const owners = ['userTurn', 'assistantTurn', 'sidePanel']
    .flatMap((key) => profiles[key] ?? [])
    .join(',');
  return Boolean(owners && field.closest(owners));
}

/** A reply/editor plus a Send label is not proof of the site's main composer. */
export function nativeSiteComposerRoot(siteId: string, field: HTMLElement): Element | null {
  const root = getBundledSiteSelectorView(siteId).profiles.composerRoot?.join(',');
  const native = packagedSiteInputSelectors(siteId as InputSiteId, 'input.nativeOwner').join(',');
  return (root ? field.closest(root) : null) ?? field.closest(native);
}

/** An app form cannot lend composer ownership to its sidebar, turns or modal controls. */
export function hasSiteComposerForeignOwner(siteId: string, element: HTMLElement): boolean {
  return (
    element.closest(OTHER_OWNER) !== null ||
    hasForeignPageOwner(
      element,
      'dialog, [role="dialog"], [role="alertdialog"], nav, aside, [role="navigation"]',
    ) ||
    hasSiteContentOwner(siteId, element) ||
    hasVoyagerOwner(element)
  );
}

/** Native ownership uses the installed site's owner and HTML editing protocol, never remote data. */
export function ownedSiteInputs(siteId: string, doc: Document): HTMLElement[] {
  return Array.from(doc.querySelectorAll<HTMLElement>(NATIVE_EDITABLE)).filter(
    (field) =>
      isEditable(field) &&
      Boolean(nativeSiteComposerRoot(siteId, field)) &&
      !hasSiteComposerForeignOwner(siteId, field),
  );
}

export function acceptsSiteInputs(
  siteId: string,
  doc: Document,
  actual: readonly HTMLElement[],
  bundled: readonly HTMLElement[],
): boolean {
  // A partial list can pick the same first field today but another draft after a remount.
  if (bundled.length)
    return actual.length === bundled.length && actual.every((field, i) => field === bundled[i]);
  const native = ownedSiteInputs(siteId, doc);
  return actual.length === 1 && native.length === 1 && actual[0] === native[0];
}

export const CHAT_INPUT_LOCATOR_KEY = 'input.candidates';

export function findSiteChatInput(
  siteId: string,
  options: FindComposerOptions = {},
): HTMLElement | null {
  const doc = options.doc ?? document;
  const bundle = getBundledSiteSelectorView(siteId);
  const view = getSiteSelectorView(siteId);
  const key = CHAT_INPUT_LOCATOR_KEY;
  const read = (candidate: SiteSelectorView) => readChatInput(candidate.profiles[key], options);
  if (!view.remoteKeys.has(key)) return read(bundle);
  const expected = inputCandidates(doc, bundle.profiles[key]);
  return resolveSiteSelectorOperationInView(
    view,
    (candidate) => ({
      field: read(candidate),
      candidates: inputCandidates(doc, candidate.profiles[key]),
    }),
    (result) => acceptsSiteInputs(siteId, doc, result.candidates, expected),
  ).value.field;
}
