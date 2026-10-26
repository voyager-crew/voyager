import { getSiteSelectorView, pageSemanticSelector } from '@/core/selectors';
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

/** A repair that cannot yet be proved may become usable after the native thread mounts. */
export function hasNotificationSelectorFixes(): boolean {
  const { remoteKeys } = getSiteSelectorView('chatgpt');
  return KEYS.some((key) => remoteKeys.has(key));
}
