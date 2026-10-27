import {
  detectAccountContextFromDocument,
  type AccountContext,
} from '@/core/services/AccountIsolationService';

export function isCurrentCapture(path: string, account: AccountContext): boolean {
  const currentAccount = detectAccountContextFromDocument(window.location.href, document);
  if (account.routeUserId !== currentAccount.routeUserId) return false;
  // A late account control identifies the same send; only two known emails prove a switch.
  if (account.email && currentAccount.email && account.email !== currentAccount.email) return false;
  const current = window.location.pathname;
  // The first send creates its conversation before the account read can finish.
  return (
    current === path ||
    (/^(?:\/u\/\d+)?\/(?:app|gem\/[^/]+)\/?$/.test(path) &&
      current.startsWith(`${path.replace(/\/$/, '')}/`))
  );
}

/** Explicit same-tab navigation distinguishes leaving New chat from Gemini completing its send. */
export function watchCaptureNavigation(invalidate: () => void): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0)
      return;
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(anchor instanceof HTMLAnchorElement) || (anchor.target && anchor.target !== '_self'))
      return;
    try {
      const target = new URL(anchor.href, window.location.href);
      if (
        target.origin === window.location.origin &&
        target.pathname !== window.location.pathname &&
        /^(?:\/u\/\d+)?\/(?:app|gem\/[^/]+)\//.test(target.pathname)
      ) {
        // A pending New-chat capture must not mistake this deliberate navigation for its own send.
        invalidate();
      }
    } catch {
      // An invalid link cannot supply a conversation navigation destination.
    }
  };
  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}
