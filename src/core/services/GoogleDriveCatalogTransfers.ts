/** Catalog operations share the service's queue and prepare every site's files before writes. */
import type { SyncState } from '@/core/types/sync';
import type { StarStore } from '@/features/savedLibrary/starStore';
import type { StarsExportPayloadV2 } from '@/features/savedLibrary/starSyncPayload';
import type { CatalogTimelineBuckets } from '@/features/timeline/catalogHierarchySync';

import type { GoogleDriveCatalogTimeline } from './GoogleDriveCatalogTimeline';
import type { GoogleDriveSyncPayloads } from './GoogleDriveSyncPayloads';
import { SyncSessionEndedError } from './GoogleDriveSyncSession';
import type { StarDriveSyncCoordinator, StarTransferPort } from './StarDriveSyncCoordinator';

export interface CatalogSession {
  assertActive(): void;
}

type RunCatalogTransfer = <T>(
  label: string,
  interactive: boolean,
  fallback: T,
  run: (token: string, session: CatalogSession) => Promise<T>,
) => Promise<T>;

export class GoogleDriveCatalogTransfers {
  constructor(
    private readonly run: RunCatalogTransfer,
    private readonly timeline: GoogleDriveCatalogTimeline,
    private readonly payloads: GoogleDriveSyncPayloads,
    private readonly stars: StarDriveSyncCoordinator,
    private readonly catalogPortFor: (
      token: string,
      session: CatalogSession,
    ) => (site: string) => StarTransferPort,
  ) {}

  /** Catalog outlines and stars are one upload: prepare both before writing either kind. */
  async uploadCatalogData(
    bySite: Record<string, CatalogTimelineBuckets>,
    store: StarStore | undefined,
    starSites: readonly string[],
    interactive: boolean = true,
  ): Promise<boolean> {
    return this.run('Timeline outline upload', interactive, false, async (token, session) => {
      const timeline = await this.timeline.planUpload(token, bySite);
      const catalogPort = this.catalogPortFor(token, session);
      const commitStars = store
        ? await this.stars.prepare(
            store,
            starSites.map((site) => ({ port: catalogPort(site), scope: null })),
          )
        : undefined;
      await this.timeline.uploadPlan(token, timeline, () => session.assertActive());
      await commitStars?.();
      return true;
    });
  }

  /** The cloud timeline outlines of the listed catalog sites, or null when the download failed. */
  async downloadCatalogTimeline(
    sites: readonly string[],
    interactive: boolean = true,
  ): Promise<CatalogTimelineBuckets | null> {
    return this.run('Timeline outline download', interactive, null, async (token, session) => {
      const buckets = await this.timeline.download(token, sites);
      session.assertActive();
      return buckets;
    });
  }

  /** The cloud star files of the listed catalog sites, by site; null when the download failed. */
  async downloadCatalogStars(
    sites: readonly string[],
    interactive: boolean = true,
  ): Promise<Record<string, StarsExportPayloadV2> | null> {
    return this.run('Catalog star download', interactive, null, async (token, session) => {
      const bySite = await this.payloads.downloadCatalogStars(token, sites);
      session.assertActive();
      return bySite;
    });
  }
}

interface CatalogTransferOptions {
  getSession(): CatalogSession;
  getToken(interactive: boolean): Promise<string | null>;
  updateState(state: Partial<SyncState>): void;
}

/** Catalog transfers retain their existing error results and do not change folder sync times. */
export function createCatalogTransferRunner(options: CatalogTransferOptions): RunCatalogTransfer {
  return async <T>(
    label: string,
    interactive: boolean,
    fallback: T,
    run: (token: string, session: CatalogSession) => Promise<T>,
  ): Promise<T> => {
    try {
      options.updateState({ isSyncing: true, error: null });
      const session = options.getSession();
      const token = await options.getToken(interactive);
      if (!token) {
        if (!interactive) {
          options.updateState({ isSyncing: false, isAuthenticated: false });
          return fallback;
        }
        throw new Error('Not authenticated');
      }
      const result = await run(token, session);
      options.updateState({ isSyncing: false, error: null });
      return result;
    } catch (error) {
      if (error instanceof SyncSessionEndedError) throw error;
      const errorMessage = error instanceof Error ? error.message : `${label} failed`;
      console.error(`[GoogleDriveSyncService] ${label} failed:`, error);
      options.updateState({ isSyncing: false, error: errorMessage });
      return fallback;
    }
  };
}
