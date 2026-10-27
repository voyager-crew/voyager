import {
  getBundledGeminiSelectorView,
  resolveGeminiSelectorOperation,
} from '@/core/gemini/selectors';
import { geminiSidebarSelector } from '@/core/gemini/sidebar/queries';

/** Discover first, then let the navigation owner dispatch its packaged event sequence. */
export function findForkSidebarLink(accepts: (url: URL) => boolean): HTMLAnchorElement | null {
  const bundle = getBundledGeminiSelectorView();
  return resolveGeminiSelectorOperation(
    (view) => {
      const candidates = document.querySelectorAll(geminiSidebarSelector('sidebar.links', view));
      for (const candidate of candidates) {
        if (!(candidate instanceof HTMLAnchorElement) || !candidate.isConnected) continue;
        if (!candidate.closest(geminiSidebarSelector('sidebar.forkRoots', view))) continue;
        // Online discovery cannot turn an arbitrary same-URL control into a native chat link.
        if (!candidate.matches(geminiSidebarSelector('sidebar.links', bundle))) continue;
        if (!candidate.closest(geminiSidebarSelector('sidebar.forkRoots', bundle))) continue;
        if (candidate.closest('.gv-folder-container, .gv-folder-conversation')) continue;
        try {
          if (accepts(new URL(candidate.href, window.location.origin))) return candidate;
        } catch {
          // A malformed href cannot become navigation evidence.
        }
      }
      return null;
    },
    (link) => link !== null,
  ).value;
}
