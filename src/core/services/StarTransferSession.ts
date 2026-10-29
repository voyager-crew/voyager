import type { SyncAccountScope } from '@/core/types/sync';
import {
  selectCatalogSiteStars,
  selectGeminiFileStars,
} from '@/features/savedLibrary/starSitePolicy';

import type { GoogleDriveSyncPayloads } from './GoogleDriveSyncPayloads';
import type { GoogleDriveSyncSession } from './GoogleDriveSyncSession';
import type { StarTransferPort } from './StarDriveSyncCoordinator';

export function createStarTransferSession(
  token: string,
  payloads: GoogleDriveSyncPayloads,
  scope: SyncAccountScope | null,
  session: GoogleDriveSyncSession,
): { port: StarTransferPort; catalogPort(site: string): StarTransferPort } {
  const assertActive = () => session.assertActive();
  return {
    port: {
      assertActive,
      read: () => payloads.readStars(token, scope),
      writeV2: (payload) => payloads.writeStars(token, payload, scope, true),
      writeV1: (payload) => payloads.writeStars(token, payload, scope, false),
      select: (local, remote) => selectGeminiFileStars(local, scope, remote),
    },
    catalogPort: (site) => ({
      assertActive,
      read: () => payloads.readCatalogStars(token, site),
      writeV2: (payload) => payloads.writeCatalogStars(token, site, payload),
      select: (local) => selectCatalogSiteStars(local, site),
    }),
  };
}
