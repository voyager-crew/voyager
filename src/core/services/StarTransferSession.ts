import type { SyncAccountScope } from '@/core/types/sync';
import {
  selectCatalogSiteStars,
  selectGeminiFileStars,
} from '@/features/savedLibrary/starSitePolicy';
import type { StarState } from '@/features/savedLibrary/starSyncData';
import { decodeStarSyncSources } from '@/features/savedLibrary/starSyncPayload';

import {
  retainExcludedStars,
  selectSyncScopeStars,
  selectSyncScopeStarSources,
} from './GoogleDriveStarScope';
import type { GoogleDriveSyncPayloads } from './GoogleDriveSyncPayloads';
import type { GoogleDriveSyncSession } from './GoogleDriveSyncSession';
import type { StarTransferPort } from './StarDriveSyncCoordinator';

export function createStarTransferSession(
  token: string,
  payloads: GoogleDriveSyncPayloads,
  scope: SyncAccountScope | null,
  session: GoogleDriveSyncSession,
  includedCatalogSites?: readonly string[],
): { port: StarTransferPort; catalogPort(site: string): StarTransferPort } {
  const assertActive = () => session.assertActive();
  let remote: StarState = { data: { messages: {} }, tombstones: [] };
  return {
    port: {
      assertActive,
      read: async () => {
        const sources = await payloads.readStars(token, scope);
        if (!includedCatalogSites) return sources;
        remote = decodeStarSyncSources(sources, scope);
        return selectSyncScopeStarSources(sources, scope, includedCatalogSites);
      },
      writeV2: (payload) =>
        payloads.writeStars(
          token,
          includedCatalogSites
            ? retainExcludedStars(payload, true, remote, scope, includedCatalogSites)
            : payload,
          scope,
          true,
        ),
      writeV1: (payload) =>
        payloads.writeStars(
          token,
          includedCatalogSites
            ? retainExcludedStars(payload, false, remote, scope, includedCatalogSites)
            : payload,
          scope,
          false,
        ),
      select: (local, held) => {
        const selected = selectGeminiFileStars(local, scope, held);
        return includedCatalogSites
          ? selectSyncScopeStars(selected, includedCatalogSites, true)
          : selected;
      },
    },
    catalogPort: (site) => ({
      assertActive,
      read: () => payloads.readCatalogStars(token, site),
      writeV2: (payload) => payloads.writeCatalogStars(token, site, payload),
      select: (local) => selectCatalogSiteStars(local, site),
    }),
  };
}
