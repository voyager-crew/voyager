import type { AccountScope } from '@/core/services/AccountIsolationService';

import type { TimelineMarker } from './types';

/** Captured site storage/identity facts; the engine owns all mutable timeline state. */
export interface TimelineStoragePolicy {
  readonly conversationId: string;
  readonly url: string;
  readonly settingsPrefix: string;
  readonly stars: {
    readonly matchLegacyConversations: boolean;
    readonly resolveAccount: () => Promise<string | undefined>;
  };
  readonly hierarchy: {
    readonly extensionKey: string;
    readonly legacyLevelsKey: string | null;
    readonly legacyCollapsedKey: string | null;
    /** Gemini only: a missing scoped blob adopts the pre-isolation unscoped blob once. */
    readonly adoptUnscopedHierarchy: boolean;
    /** Page attributes naming the account; a change rehydrates the outline from the new account. */
    readonly accountAttributes: readonly string[];
    /** null stores unscoped; 'unknown' shows and accepts no outline until the account is known. */
    readonly resolveAccountScope: () => Promise<
      Pick<AccountScope, 'accountKey' | 'routeUserId'> | null | 'unknown'
    >;
    /** Narrows `isCurrent` for outline work, when star presses may finish on a captured route. */
    readonly isCurrent?: () => boolean;
  };
  /** Full-history aliases belong to stored records, never to DOM-window positions. */
  readonly resolveMountedTurnId: (id: string) => string | null;
  readonly resolveStoredTurnId: (id: string) => string | null;
  readonly getStoredTurnIdAliases: (id: string) => string[];
  readonly canEdit: (marker: TimelineMarker | undefined, id: string) => boolean;
  readonly isCurrent: () => boolean;
  readonly getConversationTitle: (markers: readonly TimelineMarker[]) => string;
}
