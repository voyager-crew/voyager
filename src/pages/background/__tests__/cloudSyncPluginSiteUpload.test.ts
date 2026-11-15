import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { createScopeSyncDevice, syncTestFolders } from './cloudSyncScopeHarness';

const EMPTY_FOLDERS = { folders: [], folderContents: {} };
const CHATGPT_FILE = 'gemini-voyager-chatgpt-folders.json';
const CLAUDE_FILE = 'gemini-voyager-claude-folders.json';
const GEMINI_FILE = 'gemini-voyager-folders.json';

function folderData(files: Map<string, string>, name: string): unknown {
  const raw = files.get(name);
  return raw === undefined ? undefined : (JSON.parse(raw) as { data?: unknown }).data;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T12:00:00.000Z'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('popup upload when a plugin site has never saved folders', () => {
  it.each([
    ['chatgpt', StorageKeys.FOLDER_DATA_CHATGPT, CHATGPT_FILE],
    ['claude', StorageKeys.FOLDER_DATA_CLAUDE, CLAUDE_FILE],
  ] as const)(
    'uploads an empty %s folder set instead of failing the local read',
    async (platform, key, file) => {
      const d = await createScopeSyncDevice();
      expect(d.values[key]).toBeUndefined();

      await expect(
        d.request('gv.sync.upload', { platform, selection: 'all' }),
      ).resolves.toMatchObject({ ok: true });

      expect(folderData(d.drive.files, file)).toEqual(EMPTY_FOLDERS);
      expect(d.drive.files.has(GEMINI_FILE)).toBe(false);
      expect(d.drive.files.has('gemini-voyager-prompts.json')).toBe(false);
      expect(d.values[key]).toBeUndefined();
    },
  );

  it('still uploads Gemini folders from the same popup when that key exists', async () => {
    const d = await createScopeSyncDevice();

    await expect(
      d.request('gv.sync.upload', { platform: 'gemini', selection: 'all' }),
    ).resolves.toMatchObject({ ok: true });

    expect(folderData(d.drive.files, GEMINI_FILE)).toEqual(syncTestFolders('Local'));
  });

  it('uploads the ChatGPT folders that were saved, not an empty stand-in', async () => {
    const d = await createScopeSyncDevice();
    const saved = syncTestFolders('ChatGPT');
    d.values[StorageKeys.FOLDER_DATA_CHATGPT] = saved;

    await expect(
      d.request('gv.sync.upload', { platform: 'chatgpt', selection: 'all' }),
    ).resolves.toMatchObject({ ok: true });

    expect(folderData(d.drive.files, CHATGPT_FILE)).toEqual(saved);
  });

  it('still refuses a ChatGPT folder value that is present but unreadable', async () => {
    const d = await createScopeSyncDevice();
    d.values[StorageKeys.FOLDER_DATA_CHATGPT] = { folders: 'garbage' };
    const before = new Map(d.drive.files);

    await expect(
      d.request('gv.sync.upload', { platform: 'chatgpt', selection: 'all' }),
    ).resolves.toEqual({ ok: false, error: 'local_read_failed' });

    expect(d.drive.files).toEqual(before);
    expect(d.values[StorageKeys.FOLDER_DATA_CHATGPT]).toEqual({ folders: 'garbage' });
  });
});
