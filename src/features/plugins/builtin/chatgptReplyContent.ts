import {
  getBundledSiteSelectorView,
  getSiteSelectorView,
  type SiteSelectorView,
} from '@/core/selectors';
import { preservesCompleteContent } from '@/core/selectors/contentIntegrity';

import { chatgptPageData } from './chatgptPageData';

const KEY = 'bridge.replyContent';

/** The role heading is stripped only after choosing a complete body, never during a remote probe. */
function withoutHeading(reply: HTMLElement): HTMLElement {
  if (!reply.querySelector(chatgptPageData.assistantHeading)) return reply;
  const copy = reply.cloneNode(true) as HTMLElement;
  copy.querySelectorAll(chatgptPageData.assistantHeading).forEach((heading) => heading.remove());
  return copy;
}

/** The bridge owns `reply`; no remote locator may substitute a fragment or another response. */
export function resolveChatgptReplyContent(
  reply: HTMLElement,
  view: SiteSelectorView = getSiteSelectorView('chatgpt'),
): HTMLElement {
  const bundle = getBundledSiteSelectorView('chatgpt');
  const read = (selected: SiteSelectorView) =>
    reply.querySelectorAll<HTMLElement>(selected.profiles[KEY].join(','));
  const native = read(bundle);
  const fallback = () => (native.length === 1 ? native[0] : withoutHeading(reply));
  if (!view.remoteKeys.has(KEY)) return fallback();
  try {
    const candidates = read(view);
    if (candidates.length !== 1) return fallback();
    const candidate = candidates[0];
    // Even an equal-looking body is wrong when the original bundled read names a different node.
    if (native.length > 0)
      return native.length === 1 && candidate === native[0] ? candidate : fallback();
    return preservesCompleteContent(candidate, reply, (node) =>
      node.matches(chatgptPageData.assistantHeading),
    )
      ? candidate
      : fallback();
  } catch {
    return fallback();
  }
}

/** Readiness notices must not reinterpret the repaired answer's own words as a page failure. */
export function touchesRepairedChatgptReplyContent(element: Element): boolean {
  const view = getSiteSelectorView('chatgpt');
  if (!view.remoteKeys.has(KEY)) return false;
  const owners = element.ownerDocument.querySelectorAll<HTMLElement>(
    '[data-chatgpt-selection-message-id], [data-chatgpt-search-unit-key$=":assistant"]',
  );
  for (const owner of owners) {
    const content = resolveChatgptReplyContent(owner, view);
    if (content.contains(element) || element.contains(content)) return true;
  }
  return false;
}
