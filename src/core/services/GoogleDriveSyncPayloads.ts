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
import type { GuardedUploadKind, UploadGuardOptions } from '@/core/types/syncUploadGuard';
import {
  type DriveReadResult,
  readDriveValue,
  UnrecognizedDriveFileError,
} from '@/core/utils/driveReadResult';
import { hashString } from '@/core/utils/hash';
import { EXTENSION_VERSION } from '@/core/utils/version';
import { FOLDER_PLATFORMS } from '@/features/folder/platforms';
import type { PluginStateMap } from '@/features/plugins/storage/pluginState';
import { catalogStarsFileName } from '@/features/savedLibrary/starSitePolicy';
import {
  decodeStarsV2,
  type StarsExportPayloadV2,
  type StarSyncSources,
} from '@/features/savedLibrary/starSyncPayload';

import type { DriveFileMetadata } from './CloudSyncBookkeeping';
import type { DriveFilesPort } from './GoogleDriveFiles';
import { GoogleDriveIdentity } from './GoogleDriveIdentity';
import { createDriveInitialPayloads } from './GoogleDriveInitialPayloads';
import { GoogleDriveScopedFiles } from './GoogleDriveScopedFiles';
import {
  PROMPTS_FILE_NAME,
  SETTINGS_FILE_NAME,
  PLUGINS_FILE_NAME,
  STARRED_FILE_NAME,
  STARS_FILE_NAME,
  FORKS_FILE_NAME,
  TIMELINE_HIERARCHY_FILE_NAME,
  HIGHLIGHTS_FILE_NAME,
} from './GoogleDriveSyncFileNames';
export { BACKUP_FOLDER_RECOVERY_FILE_NAMES } from './GoogleDriveSyncFileNames';
import { readDownloadKind, type DriveDownloadStatuses } from './GoogleDriveDownloadKinds';
import { filterDownloadedStarScopes } from './GoogleDriveStarScope';
import type { DriveTransferSelection } from './GoogleDriveTransferSelection';
import { GoogleDriveUploadFiles } from './GoogleDriveUploadFiles';
import { guardDriveUpload } from './GoogleDriveUploadGuard';
import { mergeLegacyUploadSnapshot } from './GoogleDriveUploadSnapshot';
import { decodePromptDrivePayload } from './drivePromptPayload';

export interface DriveUploadFile {
  name: string;
  payload: unknown;
}

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
  selection?: DriveTransferSelection;
}

export interface GoogleDriveDownload {
  kindStatus?: DriveDownloadStatuses;
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
    private readonly files: DriveFilesPort,
    private readonly uploads = new GoogleDriveUploadFiles(files),
    identity = new GoogleDriveIdentity(),
    onLegacyRead?: (metadata: DriveFileMetadata, target: string) => void,
  ) {
    this.scoped = new GoogleDriveScopedFiles(files, identity, onLegacyRead);
  }
  private readonly scoped: GoogleDriveScopedFiles;

  async captureScopes(...scopes: (SyncAccountScope | null | undefined)[]): Promise<void> {
    await this.scoped.identity.capture(...scopes);
  }

  beforeFirstWrite(callback: () => Promise<void>): void {
    this.uploads.setBeforeFirstWrite(callback);
  }

  async prepareUpload(token: string): Promise<void> {
    await this.uploads.prepare(token);
  }

  prepareSnapshot(
    token: string,
    snapshot: GoogleDriveUploadSnapshot,
  ): Promise<GoogleDriveUploadSnapshot> {
    return mergeLegacyUploadSnapshot(token, snapshot, this.scoped);
  }

  async guardUpload(
    token: string,
    snapshot: GoogleDriveUploadSnapshot,
    options: UploadGuardOptions,
  ) {
    await this.files.prepareDownload(token);
    const definition = FOLDER_PLATFORMS[snapshot.platform];
    const names: Record<GuardedUploadKind, string> = {
      folders: definition.driveFoldersFileName,
      prompts: PROMPTS_FILE_NAME,
      plugins: PLUGINS_FILE_NAME,
      forks: FORKS_FILE_NAME,
      timelineHierarchy: TIMELINE_HIERARCHY_FILE_NAME,
    };
    return guardDriveUpload(snapshot, options, (kind) => {
      const scope =
        kind === 'plugins' || (kind === 'folders' && definition.accountIsolationStorageKey === null)
          ? null
          : kind === 'timelineHierarchy'
            ? (snapshot.timelineHierarchyAccountScope ?? snapshot.accountScope)
            : snapshot.accountScope;
      return this.readScopedFile<unknown>(token, names[kind], scope);
    });
  }

  /** Materialize every file before ensure/upload can mutate Drive. */
  planUpload(snapshot: GoogleDriveUploadSnapshot): DriveUploadFile[] {
    const {
      platform,
      prompts,
      forks,
      timelineHierarchy,
      accountScope,
      timelineHierarchyAccountScope,
      selection = {},
    } = snapshot;
    const now = new Date();
    const initial = createDriveInitialPayloads(snapshot, now);
    const definition = FOLDER_PLATFORMS[platform];
    const plan: DriveUploadFile[] = [];
    const add = (baseName: string, payload: unknown, scope: SyncAccountScope | null = null) => {
      // A later payload that cannot serialize must not leave earlier files overwritten.
      JSON.stringify(payload);
      const name = this.scoped.name(baseName, scope);
      this.uploads.register(name);
      plan.push({ name, payload: this.scoped.withSources(name, payload) });
    };
    if (selection.site !== false)
      add(
        definition.driveFoldersFileName,
        initial.folderPayload,
        definition.accountIsolationStorageKey === null ? null : accountScope,
      );
    if (definition.syncsSharedData && selection.shared !== false && prompts.length > 0)
      add(PROMPTS_FILE_NAME, initial.promptPayload, accountScope);
    if (definition.syncsSharedData && selection.shared !== false && initial.settingsPayload)
      add(SETTINGS_FILE_NAME, initial.settingsPayload);
    if (definition.syncsSharedData && selection.shared !== false && initial.pluginsPayload)
      add(PLUGINS_FILE_NAME, initial.pluginsPayload);
    if (
      definition.syncsConversationExtras &&
      selection.site !== false &&
      selection.conversationExtras !== false &&
      forks
    ) {
      const payload: ForkExportPayload = {
        format: 'gemini-voyager.forks.v1',
        exportedAt: now.toISOString(),
        version: EXTENSION_VERSION,
        data: forks,
      };
      add(FORKS_FILE_NAME, payload, accountScope);
    }
    if (
      definition.syncsConversationExtras &&
      selection.site !== false &&
      selection.timelineHierarchy !== false &&
      timelineHierarchy
    ) {
      const payload: TimelineHierarchyExportPayload = {
        format: 'gemini-voyager.timeline-hierarchy.v1',
        exportedAt: now.toISOString(),
        version: EXTENSION_VERSION,
        data: timelineHierarchy,
      };
      add(TIMELINE_HIERARCHY_FILE_NAME, payload, timelineHierarchyAccountScope ?? accountScope);
    }
    return plan;
  }

  async uploadPlan(token: string, plan: readonly DriveUploadFile[]): Promise<number> {
    this.uploads.register(...plan.map(({ name }) => name));
    await this.uploads.prepare(token);
    for (const { name, payload } of plan) await this.uploads.write(token, name, payload);
    return plan.length;
  }

  async download(
    token: string,
    platform: SyncPlatform,
    accountScope: SyncAccountScope | null,
    timelineHierarchyAccountScope: SyncAccountScope | null,
    selection: DriveTransferSelection = {},
  ): Promise<GoogleDriveDownload | null> {
    const definition = FOLDER_PLATFORMS[platform];
    await this.files.prepareDownload(token);
    const kindStatus: DriveDownloadStatuses = {};
    const read = <
      K extends Exclude<keyof GoogleDriveDownload, 'kindStatus' | 'starredAccountHash'>,
    >(
      kind: K,
      name: string,
      scope: SyncAccountScope | null,
    ) =>
      readDownloadKind(
        kind,
        platform,
        () => this.readScopedFile<NonNullable<GoogleDriveDownload[K]>>(token, name, scope),
        kindStatus,
      );
    const site = selection.site !== false;
    const shared = definition.syncsSharedData && selection.shared !== false;
    const extras =
      site && definition.syncsConversationExtras && selection.conversationExtras !== false;
    const folders = site
      ? await read(
          'folders',
          definition.driveFoldersFileName,
          definition.accountIsolationStorageKey === null ? null : accountScope,
        )
      : null;
    const prompts = shared ? await read('prompts', PROMPTS_FILE_NAME, accountScope) : null;
    const settings = shared ? await read('settings', SETTINGS_FILE_NAME, null) : null;
    const plugins = shared ? await read('plugins', PLUGINS_FILE_NAME, null) : null;
    let starredAccountHash: string | undefined;
    const starred = extras
      ? await readDownloadKind(
          'starred',
          platform,
          async () => {
            const source = await this.readStarred(token, accountScope);
            starredAccountHash = source.v1AccountHash;
            return source.v1;
          },
          kindStatus,
        )
      : null;
    const stars = extras
      ? await readDownloadKind(
          'stars',
          platform,
          () => this.downloadStarsV2(token, accountScope),
          kindStatus,
        )
      : null;
    const forks = extras ? await read('forks', FORKS_FILE_NAME, accountScope) : null;
    const timelineHierarchy =
      site && definition.syncsConversationExtras && selection.timelineHierarchy !== false
        ? await read(
            'timelineHierarchy',
            TIMELINE_HIERARCHY_FILE_NAME,
            timelineHierarchyAccountScope ?? accountScope,
          )
        : null;
    // Even an entirely absent/unrecognized set carries a useful per-kind apply report.
    return filterDownloadedStarScopes(
      {
        folders,
        prompts,
        settings,
        plugins,
        starred,
        ...(starredAccountHash !== undefined ? { starredAccountHash } : {}),
        stars,
        forks,
        timelineHierarchy,
        kindStatus,
      },
      accountScope,
      selection.includedCatalogSites,
    );
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
    const promptsFileName = this.scoped.name(PROMPTS_FILE_NAME, accountScope);
    const merged = await this.scoped.mergeForUpload(
      token,
      PROMPTS_FILE_NAME,
      accountScope,
      promptPayload,
    );
    await this.uploads.write(
      token,
      promptsFileName,
      this.scoped.withSources(promptsFileName, merged),
    );
  }

  async downloadPrompts(
    token: string,
    accountScope: SyncAccountScope | null,
  ): Promise<DriveReadResult<PromptExportPayload>> {
    return readDriveValue(async () => {
      await this.files.prepareDownload(token);
      const raw = await this.readScopedFile<unknown>(token, PROMPTS_FILE_NAME, accountScope);
      if (raw === null) return null;
      const payload = decodePromptDrivePayload(raw);
      if (!payload) throw new UnrecognizedDriveFileError();
      return payload;
    });
  }

  async uploadHighlights(
    token: string,
    payload: HighlightExportPayload,
    accountScope: SyncAccountScope,
  ): Promise<void> {
    const fileName = this.scoped.name(HIGHLIGHTS_FILE_NAME, accountScope);
    // Exact quotes are needed for anchor recovery; upload the canonical payload verbatim.
    await this.uploads.write(
      token,
      fileName,
      this.scoped.withSources(fileName, this.scoped.toCloud(payload, accountScope)),
    );
  }

  /** Highlights have always been isolated; never read an unscoped legacy file. */
  async downloadHighlights(
    token: string,
    accountScope: SyncAccountScope,
  ): Promise<HighlightExportPayload | null> {
    await this.files.prepareDownload(token);
    const fileName = this.scoped.name(HIGHLIGHTS_FILE_NAME, accountScope);
    this.uploads.register(fileName);
    const downloaded = await this.scoped.read(token, HIGHLIGHTS_FILE_NAME, accountScope, false);
    if (downloaded === null) return null;
    try {
      assertHighlightPayloadForScope(downloaded, accountScope);
    } catch {
      throw new UnrecognizedDriveFileError();
    }
    return downloaded;
  }

  private async readStarred(
    token: string,
    scope: SyncAccountScope | null,
  ): Promise<{ v1: StarredExportPayload | null; v1AccountHash?: string }> {
    const { value: payload, authorized } = await this.scoped.readWithAuthority(
      token,
      STARRED_FILE_NAME,
      scope,
    );
    return {
      v1: payload as StarredExportPayload | null,
      ...(payload && scope && authorized ? { v1AccountHash: hashString(scope.accountKey) } : {}),
    };
  }

  async readStars(token: string, scope: SyncAccountScope | null): Promise<StarSyncSources> {
    this.uploads.register(
      this.scoped.name(STARS_FILE_NAME, scope),
      this.scoped.name(STARRED_FILE_NAME, scope),
    );
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
    const name = this.scoped.name(v2 ? STARS_FILE_NAME : STARRED_FILE_NAME, scope);
    await this.uploads.write(
      token,
      name,
      this.scoped.withSources(name, this.scoped.toCloud(payload, scope)),
    );
  }

  /** A catalog site's own star file, which has no account scope and no legacy v1 twin. */
  async readCatalogStars(token: string, site: string): Promise<StarSyncSources> {
    this.uploads.register(catalogStarsFileName(site));
    await this.files.prepareDownload(token);
    return { v2: await this.downloadCatalogStarsV2(token, site) };
  }

  async writeCatalogStars(token: string, site: string, payload: unknown): Promise<void> {
    await this.uploads.write(token, catalogStarsFileName(site), payload);
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
    if (payload !== null) {
      try {
        decodeStarsV2(payload, null);
      } catch {
        throw new UnrecognizedDriveFileError();
      }
    }
    return payload;
  }

  private async downloadStarsV2(
    token: string,
    scope: SyncAccountScope | null,
  ): Promise<StarsExportPayloadV2 | null> {
    const payload = await this.scoped.read(token, STARS_FILE_NAME, scope, false);
    if (payload !== null) {
      try {
        decodeStarsV2(payload, scope);
      } catch {
        throw new UnrecognizedDriveFileError();
      }
    }
    return payload as StarsExportPayloadV2 | null;
  }

  private async readScopedFile<T>(
    token: string,
    baseFileName: string,
    scope: SyncAccountScope | null,
  ): Promise<T | null> {
    return (await this.scoped.read(token, baseFileName, scope)) as T | null;
  }
}
