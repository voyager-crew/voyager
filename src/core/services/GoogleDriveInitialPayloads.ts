import type {
  FolderExportPayload,
  PromptExportPayload,
  SettingsExportPayload,
  PluginStateExportPayload,
} from '@/core/types/sync';
import { EXTENSION_VERSION } from '@/core/utils/version';
import { FOLDER_PLATFORMS } from '@/features/folder/platforms';

import type { GoogleDriveUploadSnapshot } from './GoogleDriveSyncPayloads';

export function createDriveInitialPayloads(snapshot: GoogleDriveUploadSnapshot, now: Date) {
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
