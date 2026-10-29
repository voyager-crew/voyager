import { FOLDER_PLATFORMS, FOLDER_PLATFORM_IDS } from '@/features/folder/platforms';

import {
  FORKS_FILE_NAME,
  HIGHLIGHTS_FILE_NAME,
  PLUGINS_FILE_NAME,
  PROMPTS_FILE_NAME,
  SETTINGS_FILE_NAME,
  STARRED_FILE_NAME,
  STARS_FILE_NAME,
  TIMELINE_HIERARCHY_FILE_NAME,
} from './GoogleDriveSyncFileNames';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function emptyRecord(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 0;
}

function emptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

function emptyBuckets(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(emptyArray);
}

function emptyOutline(value: unknown): boolean {
  return (
    isRecord(value) &&
    emptyRecord(value.conversations) &&
    (value.deleted === undefined || emptyRecord(value.deleted)) &&
    Object.keys(value).every((key) => key === 'conversations' || key === 'deleted')
  );
}

/** Only known empty shapes are settled without a cloud file; unknown content remains pending. */
export function isEmptySyncFileContent(name: string, content: unknown): boolean {
  const base = name.replace(/\.acct-[a-z0-9]+(?=\.json$)/, '');
  if (base === PROMPTS_FILE_NAME)
    return (
      emptyArray(content) ||
      (isRecord(content) &&
        content.format === 'gemini-voyager.prompts.v1' &&
        emptyArray(content.items))
    );
  if (base === SETTINGS_FILE_NAME || base === PLUGINS_FILE_NAME) return emptyRecord(content);
  if (base === STARS_FILE_NAME || /^gemini-voyager-stars\.site-[a-z0-9-]+\.json$/.test(base))
    return (
      isRecord(content) &&
      content.format === 'gemini-voyager.stars.v2' &&
      emptyArray(content.items) &&
      emptyArray(content.tombstones)
    );
  if (base === HIGHLIGHTS_FILE_NAME)
    return (
      isRecord(content) &&
      content.format === 'gemini-voyager.annotations.v1' &&
      emptyArray(content.items) &&
      content.clearMarker === undefined
    );
  if (base === STARRED_FILE_NAME)
    return isRecord(content) && Object.keys(content).length === 1 && emptyBuckets(content.messages);
  if (base === FORKS_FILE_NAME)
    return (
      isRecord(content) &&
      Object.keys(content).length === 2 &&
      emptyBuckets(content.nodes) &&
      emptyBuckets(content.groups)
    );
  if (base === TIMELINE_HIERARCHY_FILE_NAME) return emptyOutline(content);
  if (/^gemini-voyager-timeline-hierarchy\.site-[a-z0-9-]+\.json$/.test(base))
    return isRecord(content) && Object.values(content).every(emptyOutline);
  if (
    FOLDER_PLATFORM_IDS.some((platform) => FOLDER_PLATFORMS[platform].driveFoldersFileName === base)
  )
    return (
      isRecord(content) &&
      Object.keys(content).length === 2 &&
      emptyArray(content.folders) &&
      emptyBuckets(content.folderContents)
    );
  return false;
}
