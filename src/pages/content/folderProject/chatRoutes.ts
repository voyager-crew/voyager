/**
 * Gemini chat routes as Folder-as-Project reads them: the new-chat page, the
 * conversation a first send opens, and the sidebar title it gets filed under.
 */

// Sidebar conversation links: /app/<convId>, /u/0/app/<convId>, /gem/<gemId>/<convId>.
// Used by sidebarNavClickListener to cancel pendingSend before URL change.
export const CONVERSATION_HREF_PATTERN = /\/(u\/\d+\/)?(app|gem\/[^/]+)\/[^/?#]+/;

/**
 * Returns true when the current pathname is a new (empty) chat or gem page —
 * i.e., no conversation ID is present yet.
 *
 * Supports multi-profile paths like /u/0/app.
 *
 * @param path - `window.location.pathname` to test
 */
export function isNewChatPath(path: string): boolean {
  // Matches /app or /app/ but not /app/<convId>
  // Matches /gem/<gemId> or /gem/<gemId>/ but not /gem/<gemId>/<convId>
  return /^\/(u\/\d+\/)?(app\/?|gem\/[^/]+\/?)$/.test(path);
}

/**
 * Extracts the conversation ID from a Gemini chat or gem URL path.
 *
 * @param path - `window.location.pathname` to parse
 * @returns Conversation ID string, or null if none present
 */
export function extractConvId(path: string): string | null {
  const appMatch = path.match(/\/app\/([^/?#]+)/);
  if (appMatch?.[1]) return appMatch[1];
  const gemMatch = path.match(/\/gem\/[^/]+\/([^/?#]+)/);
  return gemMatch?.[1] ?? null;
}

/** Whether a conversation path is a Gem's, and which Gem. */
export function extractGemMetadata(path: string): { isGem: boolean; gemId?: string } {
  const gemMatch = path.match(/\/gem\/([^/]+)\/[^/?#]+/);
  if (!gemMatch?.[1]) {
    return { isGem: false };
  }

  return {
    isGem: true,
    gemId: gemMatch[1],
  };
}

/** The sidebar title of a just-opened conversation, else the page title. */
export function getConversationTitle(convId: string): string {
  const escapedId = convId.replace(/"/g, '\\"');
  const link = document.querySelector<HTMLAnchorElement>(
    `[data-test-id="conversation"][jslog*="c_${escapedId}"] a, a[href*="/app/${escapedId}"], a[href*="/gem/"][href$="/${escapedId}"]`,
  );
  return link?.textContent?.trim() || document.title || 'New Chat';
}
