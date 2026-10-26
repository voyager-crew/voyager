import { hasVoyagerOwner } from '@/core/gemini/composer/ownedInput';
import {
  getBundledSiteSelectorView,
  getSiteSelectorView,
  type SiteSelectorView,
} from '@/core/selectors';
import { chatgptSignalSelector } from '@/core/selectors/chatgptSignals';
import { preservesCompleteContent } from '@/core/selectors/contentIntegrity';
import { sameItems } from '@/core/utils/array';

const MESSAGE = '[data-message-role="user"], [data-message-role="assistant"]';
const ASSISTANT = '[data-message-role="assistant"]';
const THREAD_KEY = 'export.loggedOutThread';
const BODY_KEY = 'export.loggedOutAssistant';

export function chatgptStreamingSelector(loggedOut = false, root: ParentNode = document): string {
  return chatgptSignalSelector(loggedOut ? 'export.loggedOutStreaming' : 'export.streaming', root);
}

/** Logged-out role/ID attributes remain native; only their containing page wrapper can be repaired. */
function provesThread(doc: Document, view: SiteSelectorView, bundle: SiteSelectorView): boolean {
  const candidates = Array.from(doc.querySelectorAll(view.profiles[THREAD_KEY].join(',')));
  const native = Array.from(doc.querySelectorAll(bundle.profiles[THREAD_KEY].join(',')));
  if (native.length) return sameItems(candidates, native);
  const candidate = candidates[0];
  const messages = Array.from(doc.querySelectorAll(MESSAGE));
  return (
    candidates.length === 1 &&
    messages.length > 0 &&
    !hasVoyagerOwner(candidate) &&
    !candidate.closest('form, [role="dialog"], [role="alertdialog"]') &&
    !candidate.matches('main, body, html') &&
    !!candidate.closest('main, [role="main"]') &&
    !candidate.querySelector('form, nav, aside, [role="dialog"]') &&
    messages.every((node) => candidate.contains(node))
  );
}

/** One complete body per original role wrapper; broad, partial and foreign bodies all fall back. */
function provesBodies(doc: Document, view: SiteSelectorView, bundle: SiteSelectorView): boolean {
  const candidates = Array.from(doc.querySelectorAll(view.profiles[BODY_KEY].join(',')));
  const native = Array.from(doc.querySelectorAll(bundle.profiles[BODY_KEY].join(',')));
  if (native.length) return sameItems(candidates, native);
  const owners = Array.from(doc.querySelectorAll(ASSISTANT));
  return (
    candidates.length === owners.length &&
    candidates.every(
      (node, index) =>
        !hasVoyagerOwner(node) &&
        !node.closest('form, [role="dialog"], [role="alertdialog"]') &&
        node.closest(ASSISTANT) === owners[index] &&
        preservesCompleteContent(node, owners[index]),
    )
  );
}

/** A repaired thread and its bodies are one read: no accepted wrapper can drop a rejected reply. */
function loggedOutView(doc: Document): SiteSelectorView {
  const bundle = getBundledSiteSelectorView('chatgpt');
  const view = getSiteSelectorView('chatgpt');
  if (!view.remoteKeys.has(THREAD_KEY) && !view.remoteKeys.has(BODY_KEY)) return bundle;
  try {
    if (view.remoteKeys.has(THREAD_KEY) && !provesThread(doc, view, bundle)) return bundle;
    if (view.remoteKeys.has(BODY_KEY) && !provesBodies(doc, view, bundle)) return bundle;
    return view;
  } catch {
    return bundle;
  }
}

export function chatgptLoggedOutThreadSelector(doc: Document = document): string {
  return loggedOutView(doc).profiles[THREAD_KEY].join(',');
}

export function chatgptLoggedOutAssistantSelector(root: ParentNode = document): string {
  const doc = root instanceof Document ? root : (root.ownerDocument ?? document);
  return loggedOutView(doc).profiles[BODY_KEY].join(',');
}
