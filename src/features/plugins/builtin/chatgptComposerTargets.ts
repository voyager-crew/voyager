import { hasVoyagerOwner } from '@/core/gemini/composer/ownedInput';
import { pageSemanticSelector } from '@/core/selectors';
import { findComposer, isEditable } from '@/core/services/composer/find';
import site from '@/features/plugins/catalog/sites/chatgpt/site.json';
import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';
import type { SiteAdapter } from '@/features/plugins/types';

import { chatgptPageData } from './chatgptPageData';

// Legacy form ownership is broader than the semantic adapter and keeps the original OFF read.
const BUNDLED_ROOT = chatgptPageData.composerRootFallback;
const BUNDLED_SEND = site.selectors.sendButton;
// Protocol boundaries remain packaged: a remote candidate cannot turn a reply/editor/dialog into input.
const FOREIGN_INPUT =
  '[role="dialog"], [role="alertdialog"], [data-turn-key], [data-message-author-role], [data-chatgpt-selection-message-id]';

/** Closest composer owner, retaining legacy forms and the original event/field's ownership. */
export function chatgptComposerRootOf(
  field: Element,
  adapter?: SiteAdapter | null,
): HTMLElement | null {
  const selector = pageSemanticSelector(adapter ?? chatgptAdapter, 'composerRoot');
  if (!selector || selector === site.selectors.composerRoot) {
    return field.closest<HTMLElement>(BUNDLED_ROOT);
  }
  const bundled = field.closest<HTMLElement>(BUNDLED_ROOT);
  try {
    // A remote root may never move an operation to a sibling form or a broad ancestor.
    const candidate = field.closest<HTMLElement>(selector);
    return candidate === bundled ? candidate : bundled;
  } catch {
    return bundled;
  }
}

/** A repaired editor cannot borrow bundled owners after another member of its remote group fails. */
function acceptsRepairedComposerGroup(
  field: HTMLElement,
  root: HTMLElement,
  submit: HTMLButtonElement,
  adapter?: SiteAdapter | null,
): boolean {
  if (submit.form !== root) return false;
  const source = adapter ?? chatgptAdapter;
  const send = pageSemanticSelector(source, 'sendButton');
  try {
    // The native form is already proved above; legacy root overrides are not an admitted group member.
    if (send && send !== BUNDLED_SEND) {
      const controls = Array.from(field.ownerDocument.querySelectorAll(send));
      if (controls.length !== 1 || controls[0] !== submit) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Pure composer read: compare with the independent ordered legacy read before returning a target. */
export function resolveChatgptComposer(
  bundledRead: () => HTMLElement | null,
  adapter?: SiteAdapter | null,
): HTMLElement | null {
  const selector = pageSemanticSelector(adapter ?? chatgptAdapter, 'composer');
  if (!selector || selector === site.selectors.composer) return bundledRead();
  const bundled = bundledRead();
  const candidate = findComposer(selector);
  if (!candidate || candidate.closest(FOREIGN_INPUT) || hasVoyagerOwner(candidate)) return bundled;
  if (bundled) return candidate === bundled ? candidate : bundled;
  const root = chatgptComposerRootOf(candidate);
  if (!root || !isEditable(candidate)) return bundled;
  // A profile/settings form can also have one editor and Submit; only a known chat owner proves repair.
  if (
    candidate.closest(site.selectors.composerRoot) !== root &&
    !root.matches(chatgptPageData.composerNativeRoot)
  )
    return bundled;
  const fields = Array.from(
    root.querySelectorAll<HTMLElement>(chatgptPageData.composerNativeEditable),
  ).filter(isEditable);
  const submits = root.querySelectorAll<HTMLButtonElement>(chatgptPageData.submit);
  return fields.length === 1 &&
    fields[0] === candidate &&
    submits.length === 1 &&
    acceptsRepairedComposerGroup(candidate, root, submits[0], adapter)
    ? candidate
    : bundled;
}

/** The supplied field owns the send; a remote document query cannot send another composer's draft. */
export function resolveChatgptSend(
  field: HTMLElement,
  adapter: SiteAdapter | null,
  bundledRead: () => HTMLButtonElement | null,
): HTMLButtonElement | null {
  const selector = pageSemanticSelector(adapter ?? chatgptAdapter, 'sendButton');
  if (!selector || selector === BUNDLED_SEND) return bundledRead();
  const bundled = bundledRead();
  try {
    const found = Array.from(field.ownerDocument.querySelectorAll<HTMLButtonElement>(selector));
    const root = chatgptComposerRootOf(field);
    if (found.length !== 1 || !(found[0] instanceof HTMLButtonElement)) return bundled;
    const candidate = found[0];
    if (!root || !root.contains(candidate) || candidate.form !== field.closest('form'))
      return bundled;
    if (bundled) return candidate === bundled ? candidate : bundled;
    // Native form semantics identify the original field's only submit control independently.
    const native = Array.from(root.querySelectorAll<HTMLButtonElement>(chatgptPageData.submit));
    return native.length === 1 && native[0] === candidate ? candidate : bundled;
  } catch {
    return bundled;
  }
}
