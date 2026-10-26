import { pageSemanticSelector } from '@/core/selectors';
import site from '@/features/plugins/catalog/sites/chatgpt/site.json';
import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';
import type { SiteAdapter } from '@/features/plugins/types';

const KEYS = ['userTurn', 'assistantTurn', 'composer', 'composerRoot', 'sendButton'] as const;
type Key = (typeof KEYS)[number];
export type ChatgptNotificationSelectors = Readonly<Record<Key, string>>;

export const BUNDLED_NOTIFICATION_SELECTORS: ChatgptNotificationSelectors = {
  userTurn: site.selectors.userTurn,
  assistantTurn: site.selectors.assistantTurn,
  composer: site.selectors.composer,
  composerRoot: site.selectors.composerRoot,
  sendButton: site.selectors.sendButton,
};

export function notificationSelectorsOf(adapter: SiteAdapter | null): ChatgptNotificationSelectors {
  const pick = (key: Key) =>
    pageSemanticSelector(adapter ?? chatgptAdapter, key) ?? site.selectors[key];
  return {
    userTurn: pick('userTurn'),
    assistantTurn: pick('assistantTurn'),
    composer: pick('composer'),
    composerRoot: pick('composerRoot'),
    sendButton: pick('sendButton'),
  };
}

/** Changed selectors are accepted as one complete page read, never a partial turn collection. */
export function acceptsNotificationSelectors(
  selected: ChatgptNotificationSelectors,
  doc: Document = document,
): boolean {
  try {
    for (const key of KEYS) {
      if (selected[key] === site.selectors[key]) continue;
      // Every consumer uses the shared turn/composer proof, including repairs with no bundled match.
      if (selected[key] !== pageSemanticSelector(chatgptAdapter, key, doc)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function hasChangedNotificationSelectors(selected: ChatgptNotificationSelectors): boolean {
  return KEYS.some((key) => selected[key] !== site.selectors[key]);
}
