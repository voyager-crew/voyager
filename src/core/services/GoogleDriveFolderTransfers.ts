/** Full platform transfers, run only through a captured sync session. */
import type { FolderData } from '@/core/types/folder';
import type {
  ForkNodesDataSync,
  PromptItem,
  StarredMessagesDataSync,
  SyncAccountScope,
  SyncPlatform,
  SyncState,
  TimelineHierarchyDataSync,
} from '@/core/types/sync';
import { FOLDER_PLATFORMS } from '@/features/folder/platforms';
import type { PluginStateMap } from '@/features/plugins/storage/pluginState';
import { catalogStarSites } from '@/features/savedLibrary/starSitePolicy';
import type { StarStore } from '@/features/savedLibrary/starStore';
import { decodeStarSyncSources } from '@/features/savedLibrary/starSyncPayload';

import type { GoogleDriveAuth } from './GoogleDriveAuth';
import { GoogleDriveSyncPayloads, type GoogleDriveDownload } from './GoogleDriveSyncPayloads';
import { GoogleDriveSyncSession, SyncSessionEndedError } from './GoogleDriveSyncSession';
import { logger } from './LoggerService';
import type { StarDriveSyncCoordinator } from './StarDriveSyncCoordinator';
import { createStarTransferSession } from './StarTransferSession';

export class GoogleDriveFolderTransfers {
  constructor(
    private readonly auth: Pick<GoogleDriveAuth, 'getToken'>,
    private readonly payloads: GoogleDriveSyncPayloads,
    private readonly starCoordinator: StarDriveSyncCoordinator,
    private readonly session: GoogleDriveSyncSession,
    private readonly updateState: (state: Partial<SyncState>) => void,
    private readonly saveState: () => Promise<void>,
  ) {}

  /** Upload the platform files and its shared data. */
  async upload(
    folders: FolderData,
    prompts: PromptItem[],
    starred: StarredMessagesDataSync | null = null,
    interactive: boolean = true,
    platform: SyncPlatform = 'gemini',
    forks: ForkNodesDataSync | null = null,
    timelineHierarchy: TimelineHierarchyDataSync | null = null,
    accountScope: SyncAccountScope | null = null,
    timelineHierarchyAccountScope: SyncAccountScope | null = null,
    settings: Record<string, unknown> | null = null,
    plugins: PluginStateMap | null = null,
    starStore?: StarStore,
  ): Promise<boolean> {
    const capturedScope = accountScope ? { ...accountScope } : null;
    const capturedHierarchyScope = timelineHierarchyAccountScope
      ? { ...timelineHierarchyAccountScope }
      : null;
    try {
      this.updateState({ isSyncing: true, error: null });

      const token = await this.session.run(() => this.auth.getToken(interactive));
      if (!token) {
        if (!interactive) {
          logger.info(
            '[GoogleDriveSyncService] Upload skipped: Not authenticated (non-interactive)',
          );
          this.updateState({ isSyncing: false, isAuthenticated: false });
          return false;
        }
        throw new Error('Not authenticated');
      }

      const payloads = this.payloads;
      const { port, catalogPort } = createStarTransferSession(
        token,
        payloads,
        capturedScope,
        this.session,
      );
      const { syncsConversationExtras } = FOLDER_PLATFORMS[platform];
      if (syncsConversationExtras && starred && !starStore)
        throw new Error('Star uploads require the queued store');
      const plan = payloads.planUpload({
        folders,
        prompts,
        starred,
        platform,
        forks,
        timelineHierarchy,
        accountScope: capturedScope,
        timelineHierarchyAccountScope: capturedHierarchyScope,
        settings,
        plugins,
      });
      let commitStars: (() => Promise<void>) | undefined;
      if (syncsConversationExtras && starStore) {
        const remote = await port.read();
        const remoteSites = catalogStarSites(decodeStarSyncSources(remote, capturedScope));
        const sites = [
          ...new Set([...(await this.localCatalogStarSites(starStore)), ...remoteSites]),
        ].sort();
        commitStars = await this.starCoordinator.prepare(starStore, [
          { port, scope: capturedScope, source: remote },
          ...sites.map((site) => ({ port: catalogPort(site), scope: null })),
        ]);
      }
      // All required reads and payloads are ready before any file can be created or replaced.
      const fileCount = await payloads.uploadPlan(token, plan);
      await commitStars?.();
      port.assertActive();
      const uploadTime = Date.now();
      // Update platform-specific upload time
      const uploadTimePatch: Partial<SyncState> = { isSyncing: false, error: null };
      uploadTimePatch[FOLDER_PLATFORMS[platform].lastUploadTimeField] = uploadTime;
      this.updateState(uploadTimePatch);
      await this.saveState();

      logger.info(
        `[GoogleDriveSyncService] Upload successful - ${fileCount + (syncsConversationExtras && starStore ? 2 : 0)} file(s) for ${platform}`,
      );
      return true;
    } catch (error) {
      if (error instanceof SyncSessionEndedError) throw error;
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      console.error('[GoogleDriveSyncService] Upload failed:', error);
      this.updateState({ isSyncing: false, error: errorMessage });
      return false;
    }
  }

  /** Download available platform files without applying them locally. */
  async download(
    interactive: boolean = true,
    platform: SyncPlatform = 'gemini',
    accountScope: SyncAccountScope | null = null,
    timelineHierarchyAccountScope: SyncAccountScope | null = null,
  ): Promise<GoogleDriveDownload | null> {
    const capturedScope = accountScope ? { ...accountScope } : null;
    const capturedHierarchyScope = timelineHierarchyAccountScope
      ? { ...timelineHierarchyAccountScope }
      : null;
    try {
      this.updateState({ isSyncing: true, error: null });

      const token = await this.session.run(() => this.auth.getToken(interactive));
      if (!token) {
        if (!interactive) {
          logger.info(
            '[GoogleDriveSyncService] Download skipped: Not authenticated (non-interactive)',
          );
          this.updateState({ isSyncing: false, isAuthenticated: false });
          return null;
        }
        throw new Error('Not authenticated');
      }

      const payloads = this.payloads;
      const data = await payloads.download(token, platform, capturedScope, capturedHierarchyScope);
      if (!data) {
        this.updateState({ isSyncing: false });
        return null;
      }

      const syncTime = Date.now();
      // Update platform-specific sync time
      const syncTimePatch: Partial<SyncState> = { isSyncing: false, error: null };
      syncTimePatch[FOLDER_PLATFORMS[platform].lastSyncTimeField] = syncTime;
      this.updateState(syncTimePatch);
      await this.saveState();

      return data;
    } catch (error) {
      if (error instanceof SyncSessionEndedError) throw error;
      const errorMessage = error instanceof Error ? error.message : 'Download failed';
      console.error('[GoogleDriveSyncService] Download failed:', error);
      this.updateState({ isSyncing: false, error: errorMessage });
      return null;
    }
  }

  /** The catalog sites with local stars or deletions, in a stable order. */
  private async localCatalogStarSites(store: StarStore): Promise<string[]> {
    return [...catalogStarSites(await store.getSyncSnapshot(null))].sort();
  }
}
