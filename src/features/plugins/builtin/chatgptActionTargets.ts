import { hasVoyagerOwner } from '@/core/gemini/composer/ownedInput';
import { getBundledSiteSelectorView, getSiteSelectorView } from '@/core/selectors';
import { sameItems } from '@/core/utils/array';

import { chatgptPageData } from './chatgptPageData';

export type ChatgptActionKey =
  | 'actions.temporaryToggle'
  | 'actions.newChat'
  | 'actions.shareButton'
  | 'actions.homeLink';

function expectedHome(doc: Document): string {
  const prefix = /^\/u\/[^/]+/.exec(doc.location.pathname)?.[0] ?? '';
  const custom = /^(?:\/u\/[^/]+)?\/g\/[^/]+/.exec(doc.location.pathname)?.[0];
  return custom ? `${custom}/` : `${prefix}/`;
}

function provesAction(element: Element, key: ChatgptActionKey, doc: Document): boolean {
  if (
    hasVoyagerOwner(element) ||
    element.closest(
      '[data-turn-key], [data-message-role], [data-message-author-role], [role="dialog"]',
    )
  )
    return false;
  if (key === 'actions.newChat' || key === 'actions.homeLink') {
    if (!(element instanceof HTMLAnchorElement)) return false;
    const url = new URL(element.href, doc.location.href);
    return (
      url.origin === doc.location.origin &&
      url.pathname === (key === 'actions.homeLink' ? '/' : expectedHome(doc)) &&
      !url.search &&
      !url.hash &&
      !!element.closest('nav, aside, header, [role="navigation"]')
    );
  }
  if (!element.matches('button, [role="button"]')) return false;
  const label =
    `${element.getAttribute('aria-label') ?? ''} ${element.textContent ?? ''}`.toLowerCase();
  if (key === 'actions.temporaryToggle') {
    return (
      element.hasAttribute('aria-pressed') &&
      chatgptPageData.temporaryOffLabels.some((text) => label.includes(text))
    );
  }
  return (
    !!element.closest('header, [role="banner"], [data-app-shell-header-obstacle]') &&
    /^(share|分享|共享|共有|공유|partager|compartir|compartilhar|поделиться|مشاركة)(\s|$)/i.test(
      label.trim(),
    )
  );
}

/** Only a unique original native action is returned; URL and interaction protocol stay packaged. */
export function chatgptActionSelector(key: ChatgptActionKey, doc: Document = document): string {
  const bundle = getBundledSiteSelectorView('chatgpt').profiles[key].join(',');
  const view = getSiteSelectorView('chatgpt');
  if (!view.remoteKeys.has(key)) return bundle;
  try {
    const selector = view.profiles[key].join(',');
    const candidates = Array.from(doc.querySelectorAll(selector));
    const native = Array.from(doc.querySelectorAll(bundle));
    if (native.length) return sameItems(candidates, native) ? selector : bundle;
    return candidates.length === 1 && provesAction(candidates[0], key, doc) ? selector : bundle;
  } catch {
    return bundle;
  }
}
