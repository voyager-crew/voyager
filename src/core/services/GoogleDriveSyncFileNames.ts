import { FOLDER_PLATFORMS, FOLDER_PLATFORM_IDS } from '@/features/folder/platforms';

export const PROMPTS_FILE_NAME = 'gemini-voyager-prompts.json';
export const SETTINGS_FILE_NAME = 'gemini-voyager-settings.json';
export const PLUGINS_FILE_NAME = 'gemini-voyager-plugins.json';
export const STARRED_FILE_NAME = 'gemini-voyager-starred.json';
export const STARS_FILE_NAME = 'gemini-voyager-stars.json';
export const FORKS_FILE_NAME = 'gemini-voyager-forks.json';
export const TIMELINE_HIERARCHY_FILE_NAME = 'gemini-voyager-timeline-hierarchy.json';
export const HIGHLIGHTS_FILE_NAME = 'gemini-voyager-highlights.json';

export const BACKUP_FOLDER_RECOVERY_FILE_NAMES = [
  ...FOLDER_PLATFORM_IDS.map((platform) => FOLDER_PLATFORMS[platform].driveFoldersFileName),
  PROMPTS_FILE_NAME,
  SETTINGS_FILE_NAME,
  PLUGINS_FILE_NAME,
  STARRED_FILE_NAME,
  STARS_FILE_NAME,
] as const;
