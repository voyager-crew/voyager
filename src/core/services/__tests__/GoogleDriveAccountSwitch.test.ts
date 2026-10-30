import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GoogleDriveSyncService } from '../GoogleDriveSyncService';
import { createTwoAccountSafariDrive } from './fixtures/twoAccountSafariDrive';

const native = vi.hoisted(() => vi.fn());
vi.mock('webextension-polyfill', () => ({ default: { runtime: { sendNativeMessage: native } } }));

const FOLDERS = 'gemini-voyager-folders.json';
const PROMPTS = 'gemini-voyager-prompts.json';
const exportedAt = '2026-10-29T00:00:00.000Z';
const folders = (name: string) => ({
  format: 'gemini-voyager.folders.v1',
  exportedAt,
  version: '2.2.1',
  data: {
    folders: [{ id: name, name, parentId: null, isExpanded: true, createdAt: 1, updatedAt: 1 }],
    folderContents: {},
  },
});
const prompt = (text: string) => ({ id: text, text, tags: [], createdAt: 1 });
const prompts = (text: string) => ({
  format: 'gemini-voyager.prompts.v1',
  exportedAt,
  items: [prompt(text)],
});

function twoAccounts() {
  const drive = createTwoAccountSafariDrive({
    a: { [FOLDERS]: folders('A'), [PROMPTS]: prompts('A') },
    b: { [FOLDERS]: folders('B'), [PROMPTS]: prompts('B') },
  });
  native.mockImplementation(drive.sendNativeMessage);
  return drive;
}

async function startService() {
  const service = new GoogleDriveSyncService();
  await service.getState();
  return service;
}

beforeEach(() => {
  vi.stubEnv('VOYAGER_BUILD_TARGET', 'safari');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const values: Record<string, unknown> = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async () => structuredClone(values),
        set: async (items: Record<string, unknown>) => {
          Object.assign(values, structuredClone(items));
        },
        remove: async () => {},
      },
    },
  });
});

afterEach(() => {
  native.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Safari Drive account changed by the Voyager app during a sync', () => {
  it('returns nothing from a download whose next file would come from the new account', async () => {
    const drive = twoAccounts();
    const service = await startService();
    // Folders arrive from A; the app signs in B before prompts are read.
    drive.switchToBAfter('googleDriveDownloadFile');

    const mixed = service.runExclusive((port) => port.download(false, 'gemini', null, null));

    await expect(mixed).rejects.toMatchObject({ code: 'account_changed' });
    expect(drive.served.filter(({ account }) => account === 'b')).toEqual([]);
    // The next sync belongs to B from its first file.
    await expect(
      service.runExclusive((port) => port.download(false, 'gemini', null, null)),
    ).resolves.toMatchObject({ folders: folders('B'), prompts: prompts('B') });
  });

  it('writes nothing to the new account during an upload that read the old one', async () => {
    const drive = twoAccounts();
    const service = await startService();
    // A's prompts are read for the merge; the app signs in B before anything is written.
    drive.switchToBAfter('googleDriveDownloadFile');

    const mixed = service.runExclusive((port) =>
      port.uploadPromptsOnly([prompt('local')], null, false),
    );

    await expect(mixed).rejects.toMatchObject({ code: 'account_changed' });
    expect(drive.writes).toEqual([]);
    expect(drive.read('b', PROMPTS)).toEqual(prompts('B'));
    expect(drive.read('a', PROMPTS)).toEqual(prompts('A'));
  });

  it('runs the first sync after Change account on the new account once the popup has looked', async () => {
    const drive = twoAccounts();
    const service = await startService();
    await service.runExclusive((port) => port.download(false, 'gemini', null, null));

    drive.switchToB();
    await service.refreshNativeAuthorization();

    await expect(
      service.runExclusive((port) => port.download(false, 'gemini', null, null)),
    ).resolves.toMatchObject({ folders: folders('B'), prompts: prompts('B') });
  });
});
