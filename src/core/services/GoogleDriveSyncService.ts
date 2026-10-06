/** Coordinates cloud sync state and account-scoped payload transfers. */
import type { FolderData } from '@/core/types/folder';
import type {
  ForkNodesDataSync,
  HighlightExportPayload,
  PromptExportPayload,
  PromptItem,
  StarredMessagesDataSync,
  SyncAccountScope,
  SyncMode,
  SyncPlatform,
  SyncProvider,
  SyncState,
  TimelineHierarchyDataSync,
} from '@/core/types/sync';
import { DEFAULT_SYNC_STATE } from '@/core/types/sync';
import {
  FOLDER_PLATFORMS,
  FOLDER_PLATFORM_IDS,
  type SyncTimeField,
} from '@/features/folder/platforms';
import type { PluginStateMap } from '@/features/plugins/storage/pluginState';
import { catalogStarSites } from '@/features/savedLibrary/starSitePolicy';
import type { StarStore } from '@/features/savedLibrary/starStore';
import type { StarsExportPayloadV2 } from '@/features/savedLibrary/starSyncPayload';
import type { CatalogTimelineBuckets } from '@/features/timeline/catalogHierarchySync';

import { GoogleDriveAuth, isSafariRuntime } from './GoogleDriveAuth';
import { GoogleDriveBackupFolder } from './GoogleDriveBackupFolder';
import { GoogleDriveCatalogTimeline } from './GoogleDriveCatalogTimeline';
import { GoogleDriveFiles } from './GoogleDriveFiles';
import {
  BACKUP_FOLDER_RECOVERY_FILE_NAMES,
  GoogleDriveSyncPayloads,
  assertHighlightPayloadForScope,
  type GoogleDriveDownload,
} from './GoogleDriveSyncPayloads';
import { logger } from './LoggerService';
import { StarDriveSyncCoordinator } from './StarDriveSyncCoordinator';
import { createStarTransferSession } from './StarTransferSession';

/** Every platform's transfer times with their persisted keys, in registry order. */
const SYNC_TIME_STORAGE = FOLDER_PLATFORM_IDS.flatMap((platform) => {
  const definition = FOLDER_PLATFORMS[platform];
  return [
    { field: definition.lastSyncTimeField, storageKey: definition.lastSyncTimeStorageKey },
    { field: definition.lastUploadTimeField, storageKey: definition.lastUploadTimeStorageKey },
  ] satisfies { field: SyncTimeField; storageKey: string }[];
});

interface CatalogSession {
  revision: number;
  provider: SyncProvider;
  assertActive(): void;
}

function getStringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function getNumberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export class GoogleDriveSyncService {
  private sessionRevision = 0;
  private readonly starCoordinator = new StarDriveSyncCoordinator();
  private state: SyncState = { ...DEFAULT_SYNC_STATE };
  private stateChangeCallback: ((state: SyncState) => void) | null = null;
  private readonly stateLoadPromise: Promise<void>;

  private readonly auth = new GoogleDriveAuth(() => this.state.provider);
  private readonly files = new GoogleDriveFiles(
    new GoogleDriveBackupFolder(BACKUP_FOLDER_RECOVERY_FILE_NAMES),
    {
      getProvider: () => this.state.provider,
      onAuthLost: () => this.updateState({ isAuthenticated: false }),
    },
  );

  private readonly payloads = new GoogleDriveSyncPayloads(this.files);
  private readonly catalogTimeline = new GoogleDriveCatalogTimeline(this.files);

  constructor() {
    this.stateLoadPromise = this.loadState();
  }

  onStateChange(callback: (state: SyncState) => void): void {
    this.stateChangeCallback = callback;
  }

  /**
   * Ensure state is loaded before returning
   */
  async getState(): Promise<SyncState> {
    await this.stateLoadPromise;
    return { ...this.state };
  }

  async setMode(mode: SyncMode): Promise<void> {
    this.state.mode = mode;
    await this.saveState();
    this.notifyStateChange();
  }

  async setProvider(provider: SyncProvider): Promise<void> {
    if (provider === 'icloud' && !isSafariRuntime()) {
      throw new Error('iCloud sync is available only in Safari');
    }
    if (provider === this.state.provider) return;

    this.sessionRevision += 1;
    await this.auth.clear();
    this.state.provider = provider;
    this.state.isAuthenticated = false;
    this.state.error = null;
    this.files.reset();
    await this.saveState();
    this.notifyStateChange();
  }

  async authenticate(interactive: boolean = true): Promise<boolean> {
    try {
      this.updateState({ isSyncing: true, error: null });
      const token = await this.auth.getToken(interactive);
      if (!token) {
        // If not interactive and no token, just return false silently
        if (!interactive) {
          this.updateState({ isAuthenticated: false, isSyncing: false });
          return false;
        }
        throw new Error('Failed to obtain auth token');
      }
      this.updateState({ isAuthenticated: true, isSyncing: false });
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
      console.error('[GoogleDriveSyncService] Authentication failed:', error);
      this.updateState({ isAuthenticated: false, isSyncing: false, error: errorMessage });
      return false;
    }
  }

  async signOut(): Promise<void> {
    this.sessionRevision += 1;
    if (this.state.provider === 'icloud') {
      this.updateState({ isAuthenticated: false, error: null });
      await this.saveState();
      return;
    }

    await this.auth.signOutGoogle();
    await this.auth.clear();
    this.files.reset();
    this.updateState({ isAuthenticated: false, lastSyncTime: null, error: null });
    await this.saveState();
  }

  /**
   * Upload folders, prompts, and timeline data as separate files to Google Drive
   * @param folders Folder data to upload
   * @param prompts Prompt items shared by Gemini and AI Studio
   * @param starred Starred messages (only for Gemini platform)
   * @param interactive Whether to show auth prompt if needed
   * @param platform Platform to upload for ('gemini' | 'aistudio')
   */
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

      await this.stateLoadPromise;
      const session = this.sessionRevision;
      const provider = this.state.provider;
      const token = await this.auth.getToken(interactive);
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

      const { payloads, port, catalogPort } = this.starSession(
        token,
        capturedScope,
        session,
        provider,
      );
      const { syncsConversationExtras } = FOLDER_PLATFORMS[platform];
      if (syncsConversationExtras && starred && !starStore)
        throw new Error('Star uploads require the queued store');
      const fileCount = await payloads.upload(token, {
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

      if (syncsConversationExtras && starStore) {
        await this.starCoordinator.push(starStore, port, capturedScope);
        // Catalog-site stars ride along with every star sync, in their own per-site files.
        for (const site of await this.localCatalogStarSites(starStore)) {
          port.assertActive();
          await this.starCoordinator.push(starStore, catalogPort(site), null);
        }
      }
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
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      console.error('[GoogleDriveSyncService] Upload failed:', error);
      this.updateState({ isSyncing: false, error: errorMessage });
      return false;
    }
  }

  /**
   * Upload ONLY the account-scoped prompts file, leaving folders / settings /
   * starred untouched. Used by the popup "cloud merge" buttons, which merge
   * cloud + local locally first and upload the union so both sides converge
   * without data loss.
   */
  async uploadPromptsOnly(
    prompts: PromptItem[],
    accountScope: SyncAccountScope | null = null,
    interactive: boolean = true,
  ): Promise<boolean> {
    try {
      this.updateState({ isSyncing: true, error: null });

      const token = await this.auth.getToken(interactive);
      if (!token) {
        if (!interactive) {
          this.updateState({ isSyncing: false, isAuthenticated: false });
          return false;
        }
        throw new Error('Not authenticated');
      }

      await this.payloads.uploadPrompts(token, prompts, accountScope);

      this.updateState({ isSyncing: false, error: null });
      await this.saveState();
      logger.info('[GoogleDriveSyncService] Prompts-only upload successful');
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      console.error('[GoogleDriveSyncService] Prompts-only upload failed:', error);
      this.updateState({ isSyncing: false, error: errorMessage });
      return false;
    }
  }

  /**
   * Download ONLY the account-scoped prompts file. Returns the payload, or null
   * when no file exists or the user is not authenticated. The caller is
   * responsible for merging the result into local data.
   */
  async downloadPromptsOnly(
    accountScope: SyncAccountScope | null = null,
    interactive: boolean = true,
  ): Promise<PromptExportPayload | null> {
    try {
      this.updateState({ isSyncing: true, error: null });

      const token = await this.auth.getToken(interactive);
      if (!token) {
        if (!interactive) {
          this.updateState({ isSyncing: false, isAuthenticated: false });
          return null;
        }
        throw new Error('Not authenticated');
      }

      const prompts = await this.payloads.downloadPrompts(token, accountScope);

      this.updateState({ isSyncing: false, error: null });
      return prompts;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Download failed';
      console.error('[GoogleDriveSyncService] Prompts-only download failed:', error);
      this.updateState({ isSyncing: false, error: errorMessage });
      return null;
    }
  }

  /**
   * Upload only the account-scoped highlight payload. Highlights intentionally
   * live in their own file and are never added to the legacy SyncData aggregate.
   *
   * This primitive is last-write-wins. Drive v3's documented media-update API
   * does not expose a reliable compare-and-swap revision contract here, so
   * callers must download/merge before uploading when concurrent edits matter.
   */
  async uploadHighlightsOnly(
    payload: HighlightExportPayload,
    accountScope: SyncAccountScope,
    interactive: boolean = true,
  ): Promise<boolean> {
    try {
      this.updateState({ isSyncing: true, error: null });
      assertHighlightPayloadForScope(payload, accountScope);

      const token = await this.auth.getToken(interactive);
      if (!token) {
        if (!interactive) {
          this.updateState({ isSyncing: false, isAuthenticated: false });
          return false;
        }
        throw new Error('Not authenticated');
      }

      await this.payloads.uploadHighlights(token, payload, accountScope);

      this.updateState({ isSyncing: false, error: null });
      await this.saveState();
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      console.error('[GoogleDriveSyncService] Highlights-only upload failed:', error);
      this.updateState({ isSyncing: false, error: errorMessage });
      return false;
    }
  }

  /**
   * Download only the exact account-scoped highlight file. Unlike older sync
   * payloads, there is deliberately no fallback to an unscoped legacy file:
   * highlights have been account-isolated since their first Drive format.
   */
  async downloadHighlightsOnly(
    accountScope: SyncAccountScope,
    interactive: boolean = true,
  ): Promise<HighlightExportPayload | null> {
    try {
      this.updateState({ isSyncing: true, error: null });

      const token = await this.auth.getToken(interactive);
      if (!token) {
        if (!interactive) {
          this.updateState({ isSyncing: false, isAuthenticated: false });
          return null;
        }
        throw new Error('Not authenticated');
      }

      const downloaded = await this.payloads.downloadHighlights(token, accountScope);
      this.updateState({ isSyncing: false, error: null });
      return downloaded;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Download failed';
      console.error('[GoogleDriveSyncService] Highlights-only download failed:', error);
      this.updateState({ isSyncing: false, error: errorMessage });
      return null;
    }
  }

  /**
   * Download folders, prompts, and timeline data from separate files in Google Drive
   * Returns all available payloads or null if no files exist
   * @param interactive Whether to show auth prompt if needed
   * @param platform Platform to download for ('gemini' | 'aistudio')
   */
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

      await this.stateLoadPromise;
      const session = this.sessionRevision;
      const provider = this.state.provider;
      const token = await this.auth.getToken(interactive);
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

      const { payloads } = this.starSession(token, capturedScope, session, provider);
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
      const errorMessage = error instanceof Error ? error.message : 'Download failed';
      console.error('[GoogleDriveSyncService] Download failed:', error);
      this.updateState({ isSyncing: false, error: errorMessage });
      return null;
    }
  }

  /**
   * Merge-upload catalog-site timeline outlines, one Drive file per site (`bySite` maps a site id
   * to its local buckets). Never touches the folder, star or Gemini hierarchy files.
   */
  async uploadCatalogTimeline(
    bySite: Record<string, CatalogTimelineBuckets>,
    interactive: boolean = true,
  ): Promise<boolean> {
    return this.catalogTransfer(
      'Timeline outline upload',
      interactive,
      false,
      async (token, session) => {
        await this.catalogTimeline.upload(token, bySite, session.assertActive);
        return true;
      },
    );
  }

  /** The cloud timeline outlines of the listed catalog sites, or null when the download failed. */
  async downloadCatalogTimeline(
    sites: readonly string[],
    interactive: boolean = true,
  ): Promise<CatalogTimelineBuckets | null> {
    return this.catalogTransfer(
      'Timeline outline download',
      interactive,
      null,
      async (token, session) => {
        const buckets = await this.catalogTimeline.download(token, sites);
        session.assertActive();
        return buckets;
      },
    );
  }

  /**
   * Two-way sync of the listed catalog sites' star files, like a Gemini star upload: the cloud
   * stars merge into `store`, then each file is rewritten with the site's merged stars.
   */
  async syncCatalogStars(
    store: StarStore,
    sites: readonly string[],
    interactive: boolean = true,
  ): Promise<boolean> {
    return this.catalogTransfer('Catalog star sync', interactive, false, async (token, session) => {
      const { catalogPort } = this.starSession(token, null, session.revision, session.provider);
      for (const site of sites) {
        session.assertActive();
        await this.starCoordinator.push(store, catalogPort(site), null);
      }
      return true;
    });
  }

  /** The cloud star files of the listed catalog sites, by site; null when the download failed. */
  async downloadCatalogStars(
    sites: readonly string[],
    interactive: boolean = true,
  ): Promise<Record<string, StarsExportPayloadV2> | null> {
    return this.catalogTransfer(
      'Catalog star download',
      interactive,
      null,
      async (token, session) => {
        const bySite = await this.payloads.downloadCatalogStars(token, sites);
        session.assertActive();
        return bySite;
      },
    );
  }

  /** The catalog sites with local stars or deletions, in a stable order. */
  private async localCatalogStarSites(store: StarStore): Promise<string[]> {
    return [...catalogStarSites(await store.getSyncSnapshot(null))].sort();
  }

  /**
   * Runs one catalog-site transfer with a token. These never change the per-platform sync
   * times: those record the folder sync the user ran.
   */
  private async catalogTransfer<T>(
    label: string,
    interactive: boolean,
    fallback: T,
    run: (token: string, session: CatalogSession) => Promise<T>,
  ): Promise<T> {
    try {
      this.updateState({ isSyncing: true, error: null });
      await this.stateLoadPromise;
      // Captured before auth: a provider switch or sign-out meanwhile ends the transfer.
      const revision = this.sessionRevision;
      const provider = this.state.provider;
      const session: CatalogSession = {
        revision,
        provider,
        assertActive: () => {
          if (revision !== this.sessionRevision || provider !== this.state.provider) {
            throw new Error('Cloud session changed during transfer');
          }
        },
      };
      const token = await this.auth.getToken(interactive);
      if (!token) {
        if (!interactive) {
          this.updateState({ isSyncing: false, isAuthenticated: false });
          return fallback;
        }
        throw new Error('Not authenticated');
      }
      const result = await run(token, session);
      this.updateState({ isSyncing: false, error: null });
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : `${label} failed`;
      console.error(`[GoogleDriveSyncService] ${label} failed:`, error);
      this.updateState({ isSyncing: false, error: errorMessage });
      return fallback;
    }
  }

  private starSession(
    token: string,
    scope: SyncAccountScope | null,
    revision: number,
    provider: SyncProvider,
  ) {
    // A switch can advance its revision before publishing the new provider during auth cleanup.
    const assertActive = () => {
      if (revision !== this.sessionRevision || provider !== this.state.provider) {
        throw new Error('Cloud session changed during transfer');
      }
    };
    assertActive();
    return createStarTransferSession(
      token,
      provider,
      JSON.stringify([provider, revision, scope?.accountKey ?? null]),
      scope,
      assertActive,
      () => {
        if (revision !== this.sessionRevision || provider !== this.state.provider) return;
        this.sessionRevision += 1;
        this.updateState({ isAuthenticated: false });
      },
    );
  }

  private async loadState(): Promise<void> {
    try {
      const result = await chrome.storage.local.get([
        'gvSyncMode',
        'gvSyncProvider',
        ...SYNC_TIME_STORAGE.map(({ storageKey }) => storageKey),
        'gvSyncError',
      ]);
      const times = Object.fromEntries(
        SYNC_TIME_STORAGE.map(({ field, storageKey }) => [
          field,
          getNumberValue(result[storageKey]),
        ]),
      ) as Record<SyncTimeField, number | null>;
      this.state = {
        provider:
          result.gvSyncProvider === 'icloud' && isSafariRuntime() ? 'icloud' : 'googleDrive',
        mode: (result.gvSyncMode as SyncMode) || 'disabled',
        ...times,
        error: getStringValue(result.gvSyncError),
        isSyncing: false,
        isAuthenticated: false,
      };
      if (this.state.mode !== 'disabled') {
        const token = await this.auth.getToken(false);
        this.state.isAuthenticated = !!token;
      }
    } catch (error) {
      console.error('[GoogleDriveSyncService] Failed to load state:', error);
    }
  }

  private async saveState(): Promise<void> {
    try {
      await chrome.storage.local.set({
        gvSyncMode: this.state.mode,
        gvSyncProvider: this.state.provider,
        ...Object.fromEntries(
          SYNC_TIME_STORAGE.map(({ field, storageKey }) => [storageKey, this.state[field]]),
        ),
        gvSyncError: this.state.error,
      });
    } catch (error) {
      console.error('[GoogleDriveSyncService] Failed to save state:', error);
    }
  }

  private updateState(partial: Partial<SyncState>): void {
    this.state = { ...this.state, ...partial };
    this.notifyStateChange();
  }

  private notifyStateChange(): void {
    if (this.stateChangeCallback) {
      this.stateChangeCallback({ ...this.state });
    }
  }
}

export const googleDriveSyncService = new GoogleDriveSyncService();
