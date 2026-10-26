/** Title policy shared by Gemini and the historical unknown-host export dialect. */
export interface ConversationTitleProfile {
  readonly heading: string;
  readonly links: string;
  readonly active: readonly string[];
}

export function extractAppConversationId(): string | null {
  const appMatch = window.location.pathname.match(/\/app\/([^/?#]+)/);
  if (appMatch?.[1]) return appMatch[1];
  return window.location.pathname.match(/\/gem\/[^/]+\/([^/?#]+)/)?.[1] ?? null;
}

function isMeaningfulTitle(value: string | null | undefined): value is string {
  const title = (value || '').trim();
  if (!title) return false;
  if (
    ['Untitled Conversation', 'Gemini', 'Google Gemini', 'Google AI Studio', 'New chat'].includes(
      title,
    )
  )
    return false;
  return !(title.startsWith('Gemini -') || title.startsWith('Google AI Studio -'));
}

function escapeCss(value: string): string {
  return globalThis.CSS?.escape?.(value) ?? value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function readConversationRowTitle(
  element: HTMLElement,
  profile: ConversationTitleProfile,
): string | null {
  // Row identity is a packaged protocol even when a site repairs its descendant link.
  const scope = element.closest('[data-test-id="conversation"]') || element;
  const heading = scope.querySelector(profile.heading)?.textContent?.trim();
  if (isMeaningfulTitle(heading)) return heading;

  const candidate = scope.querySelector(profile.links);
  const link = candidate instanceof HTMLAnchorElement ? candidate : null;
  const ariaLabel = link?.getAttribute('aria-label')?.trim();
  if (isMeaningfulTitle(ariaLabel)) return ariaLabel;
  const linkTitle = link?.getAttribute('title')?.trim();
  return isMeaningfulTitle(linkTitle) ? linkTitle : null;
}

export function readConversationTitle(
  profile: ConversationTitleProfile,
  readRow = (element: HTMLElement) => readConversationRowTitle(element, profile),
): string {
  try {
    const active =
      document.querySelector(
        '.gv-folder-conversation.gv-folder-conversation-selected .gv-conversation-title',
      ) || document.querySelector('.gv-folder-conversation-selected .gv-conversation-title');
    if (active?.textContent?.trim()) return active.textContent.trim();
  } catch {
    /* ignore */
  }

  try {
    const conversationId = extractAppConversationId();
    if (conversationId) {
      const escapedId = escapeCss(conversationId);
      const element =
        document.querySelector<HTMLElement>(
          `[data-test-id="conversation"][jslog*="c_${escapedId}"]`,
        ) ||
        document.querySelector<HTMLElement>(
          `[data-test-id="conversation"] a[href*="${escapedId}"]`,
        );
      const title = element ? readRow(element) : null;
      if (title) return title;
    }
  } catch {
    /* ignore */
  }

  const pageTitle = document.title?.trim();
  if (isMeaningfulTitle(pageTitle)) return pageTitle;

  try {
    for (const selector of profile.active) {
      const title = document.querySelector(selector)?.textContent?.trim();
      if (isMeaningfulTitle(title)) return title;
    }
  } catch {
    /* ignore */
  }

  const conversationId = extractAppConversationId();
  return conversationId ? `Conversation ${conversationId.slice(0, 8)}` : 'Untitled Conversation';
}
