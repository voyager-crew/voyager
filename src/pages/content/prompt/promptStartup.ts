/**
 * What the Prompt Manager reads before it mounts: the user's display settings,
 * whether the release-notes badge is due, and the one-time move of panel
 * preferences out of localStorage. Each read falls back to its default alone.
 */
import browser from 'webextension-polyfill';

import { logger } from '@/core/services/LoggerService';
import { promptStorageService } from '@/core/services/StorageService';
import { StorageKeys } from '@/core/types/common';
import { migrateFromLocalStorage } from '@/core/utils/storageMigration';

import { isChangelogBadgeDue } from '../changelog/index';
import { mascotLogoFromRecord } from './triggerLogo';

const pmLogger = logger.createChild('PromptManager');

export interface PromptStartupSettings {
  hiddenByUser: boolean;
  insertOnClick: boolean;
  rowDrag: boolean;
  mascotLogo: boolean;
  changelogBadgeActive: boolean;
}

export async function readPromptStartupSettings(): Promise<PromptStartupSettings> {
  const settings: PromptStartupSettings = {
    hiddenByUser: false,
    insertOnClick: false,
    rowDrag: false,
    mascotLogo: false,
    changelogBadgeActive: false,
  };

  try {
    const result = await browser.storage.sync.get({ gvHidePromptManager: false });
    settings.hiddenByUser = result?.gvHidePromptManager === true;
  } catch (error) {
    pmLogger.warn('Failed to check hide prompt manager setting, continuing with default behavior', {
      error,
    });
  }

  try {
    const result = await browser.storage.sync.get({
      [StorageKeys.PROMPT_INSERT_ON_CLICK]: false,
      [StorageKeys.PROMPT_ROW_DRAG]: false,
      [StorageKeys.PROMPT_TRIGGER_MASCOT_LOGO]: false,
    });
    settings.insertOnClick = result?.[StorageKeys.PROMPT_INSERT_ON_CLICK] === true;
    settings.rowDrag = result?.[StorageKeys.PROMPT_ROW_DRAG] === true;
    settings.mascotLogo = mascotLogoFromRecord(result);
  } catch (error) {
    pmLogger.warn('Failed to check prompt click mode setting, falling back to copy behavior', {
      error,
    });
  }

  // Check changelog badge mode
  try {
    settings.changelogBadgeActive = await isChangelogBadgeDue();
  } catch {
    // Ignore errors
  }

  return settings;
}

/** Migrates panel preferences from localStorage to chrome.storage.local (one-time). */
export async function migratePromptPanelPrefs(): Promise<void> {
  try {
    // The prompt library itself is seeded through its owner.
    const keysToMigrate = [
      StorageKeys.PROMPT_PANEL_LOCKED,
      StorageKeys.PROMPT_PANEL_POSITION,
      StorageKeys.PROMPT_TRIGGER_POSITION,
    ];

    const migrationResult = await migrateFromLocalStorage(keysToMigrate, promptStorageService, {
      deleteAfterMigration: false, // Keep localStorage as backup
      skipExisting: true, // Skip if already migrated
    });

    if (migrationResult.migratedKeys.length > 0) {
      pmLogger.info('Migrated prompt data from localStorage to chrome.storage.local', {
        migratedKeys: migrationResult.migratedKeys,
      });
    }

    if (migrationResult.errors.length > 0) {
      pmLogger.warn('Some keys failed to migrate', { errors: migrationResult.errors });
    }
  } catch (migrationError) {
    pmLogger.error('Migration failed, continuing with current storage', { migrationError });
    // Continue even if migration fails - data will still work from current storage
  }
}
