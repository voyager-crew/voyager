/** Historical unknown-host title/URL protocol, independent of named-site catalog snapshots. */
export function extractGenericConversationId(): string | null {
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
  ) {
    return false;
  }
  return !(title.startsWith('Gemini -') || title.startsWith('Google AI Studio -'));
}

function escapeCss(value: string): string {
  return globalThis.CSS?.escape?.(value) ?? value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function extractTitleFromConversationElement(element: HTMLElement): string | null {
  const scope = (element.closest('[data-test-id="conversation"]') as HTMLElement) || element;
  const heading = scope.querySelector(
    '.gds-label-l, .conversation-title-text, [data-test-id="conversation-title"], h3',
  );
  const headingText = heading?.textContent?.trim();
  if (isMeaningfulTitle(headingText)) return headingText;

  const link = scope.querySelector(
    'a[href*="/app/"], a[href*="/gem/"]',
  ) as HTMLAnchorElement | null;
  const ariaLabel = link?.getAttribute('aria-label')?.trim();
  if (isMeaningfulTitle(ariaLabel)) return ariaLabel;
  const linkTitle = link?.getAttribute('title')?.trim();
  return isMeaningfulTitle(linkTitle) ? linkTitle : null;
}

export function extractGenericConversationTitle(): string {
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
    const conversationId = extractGenericConversationId();
    if (conversationId) {
      const escapedId = escapeCss(conversationId);
      const element =
        (document.querySelector(
          `[data-test-id="conversation"][jslog*="c_${escapedId}"]`,
        ) as HTMLElement) ||
        (document.querySelector(
          `[data-test-id="conversation"] a[href*="${escapedId}"]`,
        ) as HTMLElement);
      if (element) {
        const title = extractTitleFromConversationElement(element);
        if (title) return title;
      }
    }
  } catch {
    /* ignore */
  }

  const pageTitle = document.title?.trim();
  if (isMeaningfulTitle(pageTitle)) return pageTitle;

  try {
    for (const selector of [
      'mat-list-item.mdc-list-item--activated [mat-line]',
      'mat-list-item[aria-current="page"] [mat-line]',
    ]) {
      const title = document.querySelector(selector)?.textContent?.trim();
      if (isMeaningfulTitle(title)) return title;
    }
  } catch {
    /* ignore */
  }

  const conversationId = extractGenericConversationId();
  return conversationId ? `Conversation ${conversationId.slice(0, 8)}` : 'Untitled Conversation';
}
