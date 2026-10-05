/**
 * Auto-backup service with timestamp-based folder organization
 * Uses File System Access API for persistent backup storage
 * Follows enterprise best practices with comprehensive error handling
 */
import { AppError, ErrorCode } from '@/core/errors/AppError';
import { exportBackupableSyncSettings } from '@/core/services/SettingsBackupService';
import { type Result, StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import { EXTENSION_VERSION } from '@/core/utils/version';
import { FolderImportExportService } from '@/features/folder/services/FolderImportExportService';
import {
  EMPTY_TIMELINE_HIERARCHY_DATA,
  type TimelineHierarchyData,
  normalizeTimelineHierarchyData,
} from '@/features/timeline/hierarchyTypes';
import { mergeTimelineHierarchy } from '@/utils/merge';

import type {
  BackupConfig,
  BackupFile,
  BackupMetadata,
  BackupResult,
  IBackupService,
} from '../types/backup';
import { PromptImportExportService } from './PromptImportExportService';

/**
 * Core backup service implementation
 */
export class BackupService implements IBackupService {
  /**
   * Generate timestamp-based folder name
   * Format: backup-YYYYMMDD-HHMMSS
   */
  private static generateBackupFolderName(): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    const d = new Date();
    const y = d.getFullYear();
    const m = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());
    const ss = pad(d.getSeconds());
    return `backup-${y}${m}${day}-${hh}${mm}${ss}`;
  }

  /**
   * Check if File System Access API is supported
   */
  static isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'showDirectoryPicker' in window &&
      typeof (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker ===
        'function'
    );
  }

  /**
   * Request directory access from user
   * @returns FileSystemDirectoryHandle if granted, null if denied/cancelled
   */
  static async requestDirectoryAccess(): Promise<FileSystemDirectoryHandle | null> {
    try {
      if (!this.isSupported()) {
        throw new AppError(
          ErrorCode.UNKNOWN_ERROR,
          'File System Access API is not supported in this browser',
          {},
        );
      }

      console.log('[BackupService] Showing directory picker...');

      type WindowWithFilePicker = Window & {
        showDirectoryPicker: (options?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
      };
      const directoryHandle = await (window as unknown as WindowWithFilePicker).showDirectoryPicker(
        {
          mode: 'readwrite',
          // Remove startIn to avoid potential issues on some systems
        },
      );

      console.log('[BackupService] Directory selected:', directoryHandle?.name || 'null');

      if (!directoryHandle) {
        console.warn('[BackupService] showDirectoryPicker returned null/undefined');
        return null;
      }

      return directoryHandle;
    } catch (error) {
      console.log('[BackupService] Directory picker error:', error);

      // User cancelled the picker
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[BackupService] User cancelled directory selection');
        return null;
      }

      // Permission denied or restricted directory
      if (
        error instanceof Error &&
        (error.name === 'NotAllowedError' ||
          error.name === 'SecurityError' ||
          error.message.includes('not allowed') ||
          error.message.includes('permission'))
      ) {
        console.error('[BackupService] Permission denied:', error.message);
        throw new AppError(
          ErrorCode.UNKNOWN_ERROR,
          'Cannot access this directory. Please choose a different location (e.g., Documents, Downloads, or a custom folder on Desktop)',
          { originalError: error },
        );
      }

      console.error('[BackupService] Unexpected error:', error);
      throw error;
    }
  }

  /**
   * Generate backup files without writing to filesystem
   * Useful for testing or preview
   */
  async generateBackupFiles(config: BackupConfig): Promise<Result<BackupFile[]>> {
    try {
      const files: BackupFile[] = [];
      let settingsCount = 0;
      let promptCount = 0;
      let folderCount = 0;
      let conversationCount = 0;
      let timelineHierarchyConversationCount = 0;

      const settingsPayload = await exportBackupableSyncSettings();
      settingsCount = Object.keys(settingsPayload.data).length;
      files.push({
        name: 'settings.json',
        content: JSON.stringify(settingsPayload, null, 2),
      });

      // Generate prompt backup if enabled
      if (config.includePrompts) {
        const promptResult = await PromptImportExportService.exportToJSON();
        if (!promptResult.success) {
          return {
            success: false,
            error: promptResult.error,
          };
        }

        const promptPayload = JSON.parse(promptResult.data);
        promptCount = promptPayload.items?.length || 0;

        files.push({
          name: 'prompts.json',
          content: promptResult.data,
        });
      }

      // Generate folder backup if enabled
      if (config.includeFolders) {
        const folderResult = await this.loadFolderData();
        if (!folderResult.success) {
          return {
            success: false,
            error: folderResult.error,
          };
        }

        const folderData = folderResult.data;
        const folderPayload = FolderImportExportService.exportToPayload(folderData);

        folderCount = folderData.folders.length;
        conversationCount = Object.values(folderData.folderContents).reduce(
          (sum, convs) => sum + convs.length,
          0,
        );

        files.push({
          name: 'folders.json',
          content: JSON.stringify(folderPayload, null, 2),
        });
      }

      const timelineHierarchyResult = await this.loadTimelineHierarchyData();
      if (!timelineHierarchyResult.success) {
        return {
          success: false,
          error: timelineHierarchyResult.error,
        };
      }

      const timelineHierarchy = timelineHierarchyResult.data;
      timelineHierarchyConversationCount = Object.keys(timelineHierarchy.conversations).length;

      files.push({
        name: 'timeline-hierarchy.json',
        content: JSON.stringify(
          {
            format: 'gemini-voyager.timeline-hierarchy.v1',
            exportedAt: new Date().toISOString(),
            version: EXTENSION_VERSION,
            data: timelineHierarchy,
          },
          null,
          2,
        ),
      });

      const catalogHierarchyResult = await this.loadCatalogTimelineHierarchyBuckets();
      if (!catalogHierarchyResult.success) {
        return {
          success: false,
          error: catalogHierarchyResult.error,
        };
      }

      // Catalog buckets keep their storage key: a ChatGPT account hash exists nowhere else.
      files.push({
        name: 'catalog-timeline-hierarchy.json',
        content: JSON.stringify(
          {
            format: 'gemini-voyager.catalog-timeline-hierarchy.v1',
            exportedAt: new Date().toISOString(),
            version: EXTENSION_VERSION,
            data: catalogHierarchyResult.data,
          },
          null,
          2,
        ),
      });

      // Generate metadata file
      const metadata: BackupMetadata = {
        version: EXTENSION_VERSION,
        timestamp: new Date().toISOString(),
        includesSettings: true,
        includesPrompts: config.includePrompts,
        includesFolders: config.includeFolders,
        settingsCount,
        promptCount,
        folderCount,
        conversationCount,
        timelineHierarchyConversationCount,
      };

      files.push({
        name: 'metadata.json',
        content: JSON.stringify(metadata, null, 2),
      });

      return {
        success: true,
        data: files,
      };
    } catch (error) {
      return {
        success: false,
        error: new AppError(
          ErrorCode.UNKNOWN_ERROR,
          'Failed to generate backup files',
          { config },
          error instanceof Error ? error : undefined,
        ),
      };
    }
  }

  /**
   * Create a backup with timestamp-based folder
   */
  async createBackup(
    directoryHandle: FileSystemDirectoryHandle,
    config: BackupConfig,
  ): Promise<Result<BackupResult>> {
    try {
      // Generate backup files
      const filesResult = await this.generateBackupFiles(config);
      if (!filesResult.success) {
        return {
          success: false,
          error: filesResult.error,
        };
      }

      const files = filesResult.data;

      // Create timestamp-based subdirectory
      const backupFolderName = BackupService.generateBackupFolderName();
      const backupDirHandle = await directoryHandle.getDirectoryHandle(backupFolderName, {
        create: true,
      });

      // Write each file to the backup directory
      for (const file of files) {
        const fileHandle = await backupDirHandle.getFileHandle(file.name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(file.content);
        await writable.close();
      }

      // Parse metadata to extract counts
      const metadata = JSON.parse(
        files.find((f) => f.name === 'metadata.json')?.content || '{}',
      ) as BackupMetadata;

      const result: BackupResult = {
        timestamp: new Date().toISOString(),
        settingsCount: metadata.settingsCount || 0,
        promptCount: metadata.promptCount || 0,
        folderCount: metadata.folderCount || 0,
        conversationCount: metadata.conversationCount || 0,
        timelineHierarchyConversationCount: metadata.timelineHierarchyConversationCount || 0,
      };

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during backup';

      return {
        success: false,
        error: new AppError(
          ErrorCode.UNKNOWN_ERROR,
          'Backup operation failed',
          { config, error: errorMessage },
          error instanceof Error ? error : undefined,
        ),
      };
    }
  }

  /**
   * Check if backup is needed based on config
   */
  shouldBackup(config: BackupConfig): boolean {
    if (!config.enabled) {
      return false;
    }

    // Manual backup mode (intervalHours = 0)
    if (config.intervalHours === 0) {
      return false;
    }

    // No previous backup
    if (!config.lastBackupAt) {
      return true;
    }

    // Check if interval has elapsed
    const lastBackup = new Date(config.lastBackupAt);
    const now = new Date();
    const hoursSinceBackup = (now.getTime() - lastBackup.getTime()) / (1000 * 60 * 60);

    return hoursSinceBackup >= config.intervalHours;
  }

  /**
   * Load folder data from storage
   * Only loads Gemini data (AI Studio doesn't support import)
   */
  private async loadFolderData(): Promise<Result<FolderData>> {
    try {
      const geminiKey = 'gvFolderData';

      let folderData: FolderData = {
        folders: [],
        folderContents: {},
      };

      // Load Gemini data only
      const geminiRaw = localStorage.getItem(geminiKey);
      if (geminiRaw) {
        try {
          const geminiData = JSON.parse(geminiRaw) as FolderData;
          folderData = geminiData;
        } catch (e) {
          console.warn('Failed to parse Gemini folder data:', e);
        }
      }

      return {
        success: true,
        data: folderData,
      };
    } catch (error) {
      return {
        success: false,
        error: new AppError(
          ErrorCode.STORAGE_READ_FAILED,
          'Failed to load folder data',
          {},
          error instanceof Error ? error : undefined,
        ),
      };
    }
  }

  private async loadCatalogTimelineHierarchyBuckets(): Promise<
    Result<Record<string, TimelineHierarchyData>>
  > {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage?.local?.get) {
        return { success: true, data: {} };
      }
      const storageItems = (await chrome.storage.local.get(null)) as Record<string, unknown>;
      const buckets = Object.fromEntries(
        Object.entries(storageItems)
          .filter(([key]) => key.startsWith(StorageKeys.CATALOG_TIMELINE_HIERARCHY_PREFIX))
          .map(([key, value]) => [key, normalizeTimelineHierarchyData(value)]),
      );
      return { success: true, data: buckets };
    } catch (error) {
      return {
        success: false,
        error: new AppError(
          ErrorCode.STORAGE_READ_FAILED,
          'Failed to load catalog timeline hierarchy data',
          {},
          error instanceof Error ? error : undefined,
        ),
      };
    }
  }

  private async loadTimelineHierarchyData(): Promise<Result<TimelineHierarchyData>> {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage?.local?.get) {
        return {
          success: true,
          data: EMPTY_TIMELINE_HIERARCHY_DATA,
        };
      }

      const storageItems = (await chrome.storage.local.get(null)) as Record<string, unknown>;
      const hierarchyKeys = Object.keys(storageItems).filter(
        (key) =>
          key === StorageKeys.TIMELINE_HIERARCHY ||
          key.startsWith(`${StorageKeys.TIMELINE_HIERARCHY}:acct:`),
      );
      const timelineHierarchy = hierarchyKeys.reduce<TimelineHierarchyData>((merged, key) => {
        const next = normalizeTimelineHierarchyData(storageItems[key]);
        return mergeTimelineHierarchy(merged, next);
      }, EMPTY_TIMELINE_HIERARCHY_DATA);

      return {
        success: true,
        data: timelineHierarchy,
      };
    } catch (error) {
      return {
        success: false,
        error: new AppError(
          ErrorCode.STORAGE_READ_FAILED,
          'Failed to load timeline hierarchy data',
          {},
          error instanceof Error ? error : undefined,
        ),
      };
    }
  }
}

/**
 * Singleton instance
 */
export const backupService = new BackupService();
