import { StorageKeys } from '@/core/types/common';
import { hashValue } from '@/core/utils/canonicalHash';

import type { TimelineStoragePolicy } from '../../TimelineStoragePolicy';
import { timelineSettingsPrefix } from '../../timelineSettings';
import { CatalogTurnOwnership } from './CatalogTurnOwnership';
import type { CatalogTimelineConfig } from './config';
import { buildConversationId, starConversationId } from './conversationId';
import { extractTurnHash } from './turnHash';

/** Site-namespaced key for the signed-in account, or undefined when the site exposes none. */
async function resolveCatalogAccountKey(
  config: CatalogTimelineConfig,
): Promise<string | undefined> {
  const values = config.accountIdAttributes?.map((attribute) =>
    document.documentElement.getAttribute(attribute),
  );
  if (!values?.length || values.some((value) => !value)) return undefined;
  return `${config.siteId}:${await hashValue(values)}`;
}

export function createCatalogTimelineStoragePolicy(
  config: CatalogTimelineConfig,
  ownership: CatalogTurnOwnership,
  url = location.href.split('#')[0],
): TimelineStoragePolicy {
  const conversationId = starConversationId(config, url);
  const routeId = buildConversationId(config, url);
  return {
    conversationId: conversationId ?? '',
    url,
    settingsPrefix: timelineSettingsPrefix(config.siteId),
    stars: {
      matchLegacyConversations: false,
      resolveAccount: () => resolveCatalogAccountKey(config),
    },
    hierarchy: {
      // One blob per site keeps an account-scoped read from falling back into other sites' outlines.
      extensionKey: `${StorageKeys.CATALOG_TIMELINE_HIERARCHY_PREFIX}${config.siteId}`,
      legacyLevelsKey: null,
      legacyCollapsedKey: null,
      adoptUnscopedHierarchy: false,
      accountAttributes: config.accountIdAttributes ?? [],
      // A site with account attributes never stores an outline it cannot attribute to an account.
      resolveAccountScope: async () => {
        if (!config.accountIdAttributes?.length) return null;
        const accountKey = await resolveCatalogAccountKey(config);
        return accountKey ? { accountKey, routeUserId: null } : 'unknown';
      },
    },
    resolveMountedTurnId: extractTurnHash,
    resolveStoredTurnId: extractTurnHash,
    getStoredTurnIdAliases: (id) => [id],
    canEdit: (marker) => !!conversationId && !!marker && ownership.canStar(marker.element),
    // Hosts change their URL and thread DOM separately; neither old turns nor pending work may write into the next route.
    isCurrent: () => buildConversationId(config) === routeId && location.href.split('#')[0] === url,
    getConversationTitle: (markers) => {
      const title = document.title
        .replace(
          new RegExp(
            `\\s*[|-]\\s*${config.siteLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*$`,
            'i',
          ),
          '',
        )
        .trim();
      return title || markers[0]?.summary.slice(0, 50) || `${config.siteLabel} conversation`;
    },
  };
}
