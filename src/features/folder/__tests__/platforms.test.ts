import { describe, expect, it } from 'vitest';

import {
  FOLDER_PLATFORMS,
  FOLDER_PLATFORM_IDS,
  getFolderPlatformForHost,
  isFolderPlatform,
} from '../platforms';

describe('folder platform map', () => {
  it('keeps the stored Gemini and AI Studio identifiers unchanged', () => {
    // Serialized names: changing any of these orphans existing user data or Drive files.
    expect(FOLDER_PLATFORMS).toMatchObject({
      gemini: {
        hosts: ['gemini.google.com', 'business.gemini.google'],
        folderStorageKey: 'gvFolderData',
        accountIsolationStorageKey: 'gvAccountIsolationEnabledGemini',
        driveFoldersFileName: 'gemini-voyager-folders.json',
        lastUploadTimeField: 'lastUploadTime',
        lastSyncTimeField: 'lastSyncTime',
      },
      aistudio: {
        hosts: ['aistudio.google.com', 'aistudio.google.cn'],
        folderStorageKey: 'gvFolderDataAIStudio',
        accountIsolationStorageKey: 'gvAccountIsolationEnabledAIStudio',
        driveFoldersFileName: 'gemini-voyager-aistudio-folders.json',
        lastUploadTimeField: 'lastUploadTimeAIStudio',
        lastSyncTimeField: 'lastSyncTimeAIStudio',
      },
      chatgpt: {
        hosts: ['chatgpt.com'],
        folderStorageKey: 'gvFolderDataChatGPT',
        accountIsolationStorageKey: null,
        driveFoldersFileName: 'gemini-voyager-chatgpt-folders.json',
        lastUploadTimeField: 'lastUploadTimeChatGPT',
        lastSyncTimeField: 'lastSyncTimeChatGPT',
      },
    });
    expect(FOLDER_PLATFORM_IDS).toEqual(['gemini', 'aistudio', 'chatgpt']);
  });

  it('never lets two platforms share a host, bucket, Drive file or sync timestamp', () => {
    const fields = [
      'folderStorageKey',
      'accountIsolationStorageKey',
      'driveFoldersFileName',
      'lastUploadTimeField',
      'lastSyncTimeField',
    ] as const;
    for (const field of fields) {
      const values = FOLDER_PLATFORM_IDS.map((platform) => FOLDER_PLATFORMS[platform][field]);
      expect(new Set(values).size, field).toBe(values.length);
    }
    const hosts = FOLDER_PLATFORM_IDS.flatMap((platform) => FOLDER_PLATFORMS[platform].hosts);
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  it('resolves only native hosts and leaves every other site without a folder bucket', () => {
    expect(getFolderPlatformForHost('gemini.google.com')).toBe('gemini');
    expect(getFolderPlatformForHost('BUSINESS.GEMINI.GOOGLE')).toBe('gemini');
    expect(getFolderPlatformForHost('aistudio.google.cn')).toBe('aistudio');
    expect(getFolderPlatformForHost('chatgpt.com')).toBe('chatgpt');
    for (const host of ['claude.ai', 'chat.deepseek.com', 'google.com', '']) {
      expect(getFolderPlatformForHost(host), host).toBeNull();
    }
    expect(getFolderPlatformForHost(null)).toBeNull();
  });

  it('accepts only known platform identifiers', () => {
    expect(isFolderPlatform('gemini')).toBe(true);
    expect(isFolderPlatform('aistudio')).toBe(true);
    expect(isFolderPlatform('chatgpt')).toBe(true);
    expect(isFolderPlatform('toString')).toBe(false);
    expect(isFolderPlatform(undefined)).toBe(false);
  });
});
