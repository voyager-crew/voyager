import type { FolderData } from '@/core/types/folder';
import { isHighlightExportPayloadV1 } from '@/core/types/highlight';
import type {
  FolderExportPayload,
  ForkExportPayload,
  ForkNodesDataSync,
  HighlightExportPayload,
  PluginStateExportPayload,
  PromptExportPayload,
  PromptItem,
  SettingsExportPayload,
  StarredExportPayload,
  StarredMessagesDataSync,
  SyncAccountScope,
  SyncPlatform,
  TimelineHierarchyDataSync,
  TimelineHierarchyExportPayload,
} from '@/core/types/sync';
import { hashString } from '@/core/utils/hash';
import { EXTENSION_VERSION } from '@/core/utils/version';
import { FOLDER_PLATFORMS, FOLDER_PLATFORM_IDS } from '@/features/folder/platforms';
import type { PluginStateMap } from '@/features/plugins/storage/pluginState';
import { catalogStarsFileName } from '@/features/savedLibrary/starSitePolicy';
import {
  decodeStarsV2,
  type StarsExportPayloadV2,
  type StarSyncSources,
} from '@/features/savedLibrary/starSyncPayload';

import type { GoogleDriveFiles } from './GoogleDriveFiles';
import { logger } from './LoggerService';

const PROMPTS_FILE_NAME = 'gemini-voyager-prompts.json';
const SETTINGS_FILE_NAME = 'gemini-voyager-settings.json';
const PLUGINS_FILE_NAME = 'gemini-voyager-plugins.json';
const STARRED_FILE_NAME = 'gemini-voyager-starred.json';
const STARS_FILE_NAME = 'gemini-voyager-stars.json';
const FORKS_FILE_NAME = 'gemini-voyager-forks.json';
const TIMELINE_HIERARCHY_FILE_NAME = 'gemini-voyager-timeline-hierarchy.json';
const HIGHLIGHTS_FILE_NAME = 'gemini-voyager-highlights.json';

export const BACKUP_FOLDER_RECOVERY_FILE_NAMES = [
  ...FOLDER_PLATFORM_IDS.map((platform) => FOLDER_PLATFORMS[platform].driveFoldersFileName),
  PROMPTS_FILE_NAME,
  SETTINGS_FILE_NAME,
  PLUGINS_FILE_NAME,
  STARRED_FILE_NAME,
  STARS_FILE_NAME,
] as const;

export interface GoogleDriveUploadSnapshot {
  folders: FolderData;
  prompts: PromptItem[];
  starred: StarredMessagesDataSync | null;
  platform: SyncPlatform;
  forks: ForkNodesDataSync | null;
  timelineHierarchy: TimelineHierarchyDataSync | null;
  accountScope: SyncAccountScope | null;
  timelineHierarchyAccountScope: SyncAccountScope | null;
  settings: Record<string, unknown> | null;
  plugins: PluginStateMap | null;
}

export interface GoogleDriveDownload {
  folders: FolderExportPayload | null;
  prompts: PromptExportPayload | null;
  settings: SettingsExportPayload | null;
  plugins: PluginStateExportPayload | null;
  starred: StarredExportPayload | null;
  starredAccountHash?: string;
  stars?: StarsExportPayloadV2 | null;
  forks: ForkExportPayload | null;
  timelineHierarchy: TimelineHierarchyExportPayload | null;
}

export function assertHighlightPayloadForScope(
  value: unknown,
  accountScope: SyncAccountScope,
): asserts value is HighlightExportPayload {
  if (!isHighlightExportPayloadV1(value)) {
    throw new Error('Invalid highlight sync payload');
  }

  const expectedAccountHash = hashString(accountScope.accountKey);
  if (
    value.accountScope.accountHash !== expectedAccountHash ||
    value.items.some(
      (item) =>
        item.accountHash !== expectedAccountHash || item.platform !== value.accountScope.platform,
    )
  ) {
    throw new Error('Highlight sync payload does not match the requested account scope');
  }
}

/** Owns export envelopes, platform file selection and account-scoped compatibility reads. */
export class GoogleDriveSyncPayloads {
  constructor(
    private readonly files: Pick<
      GoogleDriveFiles,
      'ensure' | 'find' | 'upload' | 'download' | 'prepareDownload'
    >,
  ) {}

  async upload(token: string, snapshot: GoogleDriveUploadSnapshot): Promise<number> {
    const {
      prompts,
      platform,
      forks,
      timelineHierarchy,
      accountScope,
      timelineHierarchyAccountScope,
    } = snapshot;
    const now = new Date();

    const { folderPayload, promptPayload, settingsPayload, pluginsPayload } = this.initialPayloads(
      snapshot,
      now,
    );

    // Upload folders file (platform-specific)
    const definition = FOLDER_PLATFORMS[platform];
    const foldersFileName = this.getFileNameForScope(
      definition.driveFoldersFileName,
      definition.accountIsolationStorageKey === null ? null : accountScope,
    );
    const foldersFileIdToUse = await this.files.ensure(token, foldersFileName);
    await this.files.upload(token, foldersFileIdToUse, folderPayload);
    logger.info(`[GoogleDriveSyncService] ${platform} folders uploaded successfully`);
    if (!definition.syncsSharedData) return 1;

    // Upload prompts file (shared between Gemini and AI Studio)
    if (prompts.length > 0) {
      const promptsFileName = this.getFileNameForScope(PROMPTS_FILE_NAME, accountScope);
      const promptsFileId = await this.files.ensure(token, promptsFileName);
      await this.files.upload(token, promptsFileId, promptPayload);
      logger.info('[GoogleDriveSyncService] Prompts uploaded successfully');
    }

    if (settingsPayload) {
      const settingsFileId = await this.files.ensure(token, SETTINGS_FILE_NAME);
      await this.files.upload(token, settingsFileId, settingsPayload);
      logger.info('[GoogleDriveSyncService] Settings uploaded successfully');
    }

    if (pluginsPayload) {
      const pluginsFileId = await this.files.ensure(token, PLUGINS_FILE_NAME);
      await this.files.upload(token, pluginsFileId, pluginsPayload);
    }

    const extras = definition.syncsConversationExtras;
    if (extras && forks) {
      await this.uploadForks(token, forks, accountScope, now);
    }
    if (extras && timelineHierarchy) {
      await this.uploadHierarchy(
        token,
        timelineHierarchy,
        timelineHierarchyAccountScope ?? accountScope,
        now,
      );
    }

    const fileCount =
      1 +
      (prompts.length > 0 ? 1 : 0) +
      (settingsPayload ? 1 : 0) +
      (pluginsPayload ? 1 : 0) +
      (extras && forks ? 1 : 0) +
      (extras && timelineHierarchy ? 1 : 0);
    return fileCount;
  }

  async download(
    token: string,
    platform: SyncPlatform,
    accountScope: SyncAccountScope | null,
    timelineHierarchyAccountScope: SyncAccountScope | null,
  ): Promise<GoogleDriveDownload | null> {
    const definition = FOLDER_PLATFORMS[platform];
    await this.files.prepareDownload(token);
    const folders = await this.readFile<FolderExportPayload>(
      token,
      definition.driveFoldersFileName,
      definition.accountIsolationStorageKey === null ? null : accountScope,
      `[GoogleDriveSyncService] ${platform} folders downloaded`,
    );
    if (!definition.syncsSharedData) {
      return folders
        ? {
            folders,
            prompts: null,
            settings: null,
            plugins: null,
            starred: null,
            forks: null,
            timelineHierarchy: null,
          }
        : null;
    }
    const prompts = await this.readFile<PromptExportPayload>(
      token,
      PROMPTS_FILE_NAME,
      accountScope,
      '[GoogleDriveSyncService] Prompts downloaded',
    );
    const settings = await this.readFile<SettingsExportPayload>(
      token,
      SETTINGS_FILE_NAME,
      null,
      '[GoogleDriveSyncService] Settings downloaded',
    );
    const plugins = await this.readFile<PluginStateExportPayload>(token, PLUGINS_FILE_NAME, null);
    let starred: StarredExportPayload | null = null;
    let starredAccountHash: string | undefined;
    const extras = definition.syncsConversationExtras;
    if (extras) {
      const source = await this.readStarred(token, accountScope);
      starred = source.v1;
      starredAccountHash = source.v1AccountHash;
    }
    const stars = extras ? await this.downloadStarsV2(token, accountScope) : null;
    let forks: ForkExportPayload | null = null;
    if (extras) {
      forks = await this.readFile<ForkExportPayload>(
        token,
        FORKS_FILE_NAME,
        accountScope,
        '[GoogleDriveSyncService] Fork nodes downloaded',
      );
    }
    let timelineHierarchy: TimelineHierarchyExportPayload | null = null;
    if (extras) {
      timelineHierarchy = await this.readFile<TimelineHierarchyExportPayload>(
        token,
        TIMELINE_HIERARCHY_FILE_NAME,
        timelineHierarchyAccountScope ?? accountScope,
        '[GoogleDriveSyncService] Timeline hierarchy downloaded',
      );
    }

    if (
      !folders &&
      !prompts &&
      !settings &&
      !plugins &&
      !starred &&
      !stars &&
      !forks &&
      !timelineHierarchy
    ) {
      logger.info(`[GoogleDriveSyncService] No sync files found for ${platform}`);
      return null;
    }

    return {
      folders,
      prompts,
      settings,
      plugins,
      starred,
      ...(starredAccountHash !== undefined ? { starredAccountHash } : {}),
      stars,
      forks,
      timelineHierarchy,
    };
  }

  async uploadPrompts(
    token: string,
    prompts: PromptItem[],
    accountScope: SyncAccountScope | null,
  ): Promise<void> {
    const promptPayload: PromptExportPayload = {
      format: 'gemini-voyager.prompts.v1',
      exportedAt: new Date().toISOString(),
      version: EXTENSION_VERSION,
      items: prompts,
    };
    const promptsFileName = this.getFileNameForScope(PROMPTS_FILE_NAME, accountScope);
    const promptsFileId = await this.files.ensure(token, promptsFileName);
    await this.files.upload(token, promptsFileId, promptPayload);
  }

  async downloadPrompts(
    token: string,
    accountScope: SyncAccountScope | null,
  ): Promise<PromptExportPayload | null> {
    await this.files.prepareDownload(token);
    const promptsFileId = await this.findFileForScope(token, PROMPTS_FILE_NAME, accountScope);
    return promptsFileId ? this.files.download<PromptExportPayload>(token, promptsFileId) : null;
  }

  async uploadHighlights(
    token: string,
    payload: HighlightExportPayload,
    accountScope: SyncAccountScope,
  ): Promise<void> {
    const fileName = this.getFileNameForScope(HIGHLIGHTS_FILE_NAME, accountScope);
    const fileId = await this.files.ensure(token, fileName);
    // Exact quotes are needed for anchor recovery; upload the canonical payload verbatim.
    await this.files.upload(token, fileId, payload);
  }

  /** Highlights have always been isolated; never read an unscoped legacy file. */
  async downloadHighlights(
    token: string,
    accountScope: SyncAccountScope,
  ): Promise<HighlightExportPayload | null> {
    await this.files.prepareDownload(token);
    const fileName = this.getFileNameForScope(HIGHLIGHTS_FILE_NAME, accountScope);
    const fileId = await this.files.find(token, fileName);
    if (!fileId) return null;
    const downloaded = await this.files.download<unknown>(token, fileId);
    if (downloaded === null) return null;
    assertHighlightPayloadForScope(downloaded, accountScope);
    return downloaded;
  }

  private initialPayloads(snapshot: GoogleDriveUploadSnapshot, now: Date) {
    const { folderExport } = FOLDER_PLATFORMS[snapshot.platform];
    const folderPayload: FolderExportPayload = {
      format: 'gemini-voyager.folders.v1',
      exportedAt: now.toISOString(),
      version: EXTENSION_VERSION,
      data: snapshot.folders,
      ...(folderExport ? { platform: folderExport.platform } : {}),
    };

    const promptPayload: PromptExportPayload = {
      format: 'gemini-voyager.prompts.v1',
      exportedAt: now.toISOString(),
      version: EXTENSION_VERSION,
      items: snapshot.prompts,
    };

    const settingsPayload: SettingsExportPayload | null = snapshot.settings
      ? {
          format: 'gemini-voyager.settings.v1',
          exportedAt: now.toISOString(),
          version: EXTENSION_VERSION,
          data: snapshot.settings,
        }
      : null;

    const pluginsPayload: PluginStateExportPayload | null = snapshot.plugins
      ? {
          format: 'gemini-voyager.plugins.v1',
          exportedAt: now.toISOString(),
          version: EXTENSION_VERSION,
          data: snapshot.plugins,
        }
      : null;

    return { folderPayload, promptPayload, settingsPayload, pluginsPayload };
  }

  private async readStarred(
    token: string,
    scope: SyncAccountScope | null,
  ): Promise<{ v1: StarredExportPayload | null; v1AccountHash?: string }> {
    const name = this.getFileNameForScope(STARRED_FILE_NAME, scope);
    const id = await this.files.find(token, name);
    const payload = id ? await this.files.download<StarredExportPayload>(token, id) : null;
    if (payload || !scope) {
      return {
        v1: payload,
        ...(payload && scope ? { v1AccountHash: hashString(scope.accountKey) } : {}),
      };
    }
    const legacy = await this.files.find(token, STARRED_FILE_NAME);
    return { v1: legacy ? await this.files.download<StarredExportPayload>(token, legacy) : null };
  }

  async readStars(token: string, scope: SyncAccountScope | null): Promise<StarSyncSources> {
    await this.files.prepareDownload(token);
    const v2 = await this.downloadStarsV2(token, scope);
    const source = await this.readStarred(token, scope);
    return { ...source, v2 };
  }

  async writeStars(
    token: string,
    payload: unknown,
    scope: SyncAccountScope | null,
    v2: boolean,
  ): Promise<void> {
    const name = this.getFileNameForScope(v2 ? STARS_FILE_NAME : STARRED_FILE_NAME, scope);
    const id = await this.files.ensure(token, name);
    await this.files.upload(token, id, payload);
  }

  /** A catalog site's own star file, which has no account scope and no legacy v1 twin. */
  async readCatalogStars(token: string, site: string): Promise<StarSyncSources> {
    await this.files.prepareDownload(token);
    return { v2: await this.downloadCatalogStarsV2(token, site) };
  }

  async writeCatalogStars(token: string, site: string, payload: unknown): Promise<void> {
    const id = await this.files.ensure(token, catalogStarsFileName(site));
    await this.files.upload(token, id, payload);
  }

  /** The star files of the listed catalog sites that exist, by site. */
  async downloadCatalogStars(
    token: string,
    sites: readonly string[],
  ): Promise<Record<string, StarsExportPayloadV2>> {
    await this.files.prepareDownload(token);
    const bySite: Record<string, StarsExportPayloadV2> = {};
    for (const site of sites) {
      const payload = await this.downloadCatalogStarsV2(token, site);
      if (payload) bySite[site] = payload;
    }
    return bySite;
  }

  private async downloadCatalogStarsV2(
    token: string,
    site: string,
  ): Promise<StarsExportPayloadV2 | null> {
    const id = await this.files.find(token, catalogStarsFileName(site));
    if (!id) return null;
    const payload = await this.files.download<StarsExportPayloadV2>(token, id);
    if (payload !== null) decodeStarsV2(payload, null);
    return payload;
  }

  private async downloadStarsV2(
    token: string,
    scope: SyncAccountScope | null,
  ): Promise<StarsExportPayloadV2 | null> {
    const id = await this.files.find(token, this.getFileNameForScope(STARS_FILE_NAME, scope));
    if (!id) return null;
    const payload = await this.files.download<StarsExportPayloadV2>(token, id);
    if (payload !== null) decodeStarsV2(payload, scope);
    return payload;
  }

  private async uploadForks(
    token: string,
    forks: ForkNodesDataSync,
    accountScope: SyncAccountScope | null,
    now: Date,
  ): Promise<void> {
    const forksPayload: ForkExportPayload = {
      format: 'gemini-voyager.forks.v1',
      exportedAt: now.toISOString(),
      version: EXTENSION_VERSION,
      data: forks,
    };
    const forksFileName = this.getFileNameForScope(FORKS_FILE_NAME, accountScope);
    const forksFileId = await this.files.ensure(token, forksFileName);
    await this.files.upload(token, forksFileId, forksPayload);
    logger.info('[GoogleDriveSyncService] Fork nodes uploaded successfully');
  }

  private async uploadHierarchy(
    token: string,
    timelineHierarchy: TimelineHierarchyDataSync,
    accountScope: SyncAccountScope | null,
    now: Date,
  ): Promise<void> {
    const timelineHierarchyPayload: TimelineHierarchyExportPayload = {
      format: 'gemini-voyager.timeline-hierarchy.v1',
      exportedAt: now.toISOString(),
      version: EXTENSION_VERSION,
      data: timelineHierarchy,
    };
    const timelineHierarchyFileName = this.getFileNameForScope(
      TIMELINE_HIERARCHY_FILE_NAME,
      accountScope,
    );
    const timelineHierarchyFileId = await this.files.ensure(token, timelineHierarchyFileName);
    await this.files.upload(token, timelineHierarchyFileId, timelineHierarchyPayload);
    logger.info('[GoogleDriveSyncService] Timeline hierarchy uploaded successfully');
  }

  private async readFile<T>(
    token: string,
    baseFileName: string,
    accountScope: SyncAccountScope | null,
    message?: string,
  ): Promise<T | null> {
    const fileId = await this.findFileForScope(token, baseFileName, accountScope);
    if (!fileId) return null;
    const payload = await this.files.download<T>(token, fileId);
    if (message) logger.info(message);
    return payload;
  }

  private getFileNameForScope(baseFileName: string, accountScope: SyncAccountScope | null): string {
    if (!accountScope) return baseFileName;

    const suffix = `acct-${hashString(accountScope.accountKey)}`;
    const dotIndex = baseFileName.lastIndexOf('.');
    if (dotIndex <= 0) {
      return `${baseFileName}.${suffix}`;
    }
    return `${baseFileName.slice(0, dotIndex)}.${suffix}${baseFileName.slice(dotIndex)}`;
  }

  private async findFileForScope(
    token: string,
    baseFileName: string,
    accountScope: SyncAccountScope | null,
  ): Promise<string | null> {
    if (!accountScope) {
      return this.files.find(token, baseFileName);
    }

    const scopedFileName = this.getFileNameForScope(baseFileName, accountScope);
    const scopedFileId = await this.files.find(token, scopedFileName);
    if (scopedFileId) return scopedFileId;

    // Backward compatibility: allow reading legacy shared file before user uploads scoped data.
    return this.files.find(token, baseFileName);
  }
}
