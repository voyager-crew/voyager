import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GoogleDriveBackupFolder } from '../GoogleDriveBackupFolder';
import { GoogleDriveFiles } from '../GoogleDriveFiles';
import { GoogleDriveSyncPayloads } from '../GoogleDriveSyncPayloads';

const promptsName = 'gemini-voyager-prompts.json';
const mimeType = 'application/vnd.google-apps.folder';

interface Folder {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  appProperties?: Record<string, string>;
}

function legacyDrive(options: { canonicalConflict?: boolean; deniedMigration?: boolean } = {}) {
  const folders = new Map<string, Folder>([
    [
      'legacy-folder',
      { id: 'legacy-folder', name: 'Gemini Voyager Data', mimeType, parents: ['nested-parent'] },
    ],
  ]);
  if (options.canonicalConflict) {
    folders.set('canonical-folder', {
      id: 'canonical-folder',
      name: 'Voyager Data',
      mimeType,
      parents: ['root'],
    });
  }
  const promptFile = { id: 'prompts-file', name: promptsName, parents: ['legacy-folder'] };
  const media = new Map([
    [
      promptFile.id,
      JSON.stringify({
        format: 'gemini-voyager.prompts.v1',
        exportedAt: '2026-10-28T00:00:00.000Z',
        items: [],
      }),
    ],
  ]);
  let failMedia = false;
  let denyDiscovery = false;
  const writes: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      if (method !== 'GET') writes.push(`${method} ${url.pathname}`);
      if (url.pathname === '/drive/v3/files') {
        if (method === 'POST') {
          const created: Folder = { id: 'duplicate', name: 'Voyager Data', mimeType, parents: [] };
          folders.set(created.id, created);
          return Response.json(created);
        }
        const query = url.searchParams.get('q') ?? '';
        if (denyDiscovery && (query.includes('mimeType=') || query.startsWith('('))) {
          throw new Error('Discovery is unavailable after the folder was cached');
        }
        if (query.includes('mimeType=')) {
          const candidates = [...folders.values()].filter((folder) =>
            query.includes('appProperties has')
              ? folder.appProperties?.voyagerDataFolder === '1'
              : folder.name === 'Voyager Data' || folder.name === 'Gemini Voyager Data',
          );
          return Response.json({ files: candidates });
        }
        if (query.includes(`name='${promptsName}'`)) return Response.json({ files: [promptFile] });
        return Response.json({ files: [] });
      }
      const id = url.pathname.split('/').at(-1) ?? '';
      const folder = folders.get(id);
      if (folder) {
        if (method === 'PATCH') {
          if (options.deniedMigration)
            return Response.json({ error: 'forbidden' }, { status: 403 });
          Object.assign(folder, JSON.parse(String(init?.body)));
        }
        return Response.json(folder);
      }
      if (id === promptFile.id) {
        if (url.pathname.startsWith('/upload/')) {
          media.set(id, String(init?.body));
          return Response.json({ id });
        }
        if (url.searchParams.get('alt') === 'media')
          return failMedia ? new Response(null, { status: 503 }) : new Response(media.get(id));
        return Response.json({ parents: promptFile.parents, trashed: false });
      }
      throw new Error(`Unexpected Drive request: ${url}`);
    }),
  );
  const backupFolder = new GoogleDriveBackupFolder([promptsName]);
  const files = new GoogleDriveFiles(backupFolder, {
    getProvider: () => 'googleDrive',
    onAuthLost: () => {},
  });
  return {
    folders,
    media,
    writes,
    backupFolder,
    files,
    fail: () => {
      failMedia = true;
    },
    blockDiscovery: () => {
      denyDiscovery = true;
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('backup folder discovery during sync reads', () => {
  it('migrates legacy metadata during a download while retaining the folder ID and parent', async () => {
    const drive = legacyDrive();

    await expect(
      new GoogleDriveSyncPayloads(drive.files).downloadPrompts('token', null),
    ).resolves.toMatchObject({ kind: 'found', value: { items: [] } });

    expect(drive.backupFolder.id).toBe('legacy-folder');
    expect(drive.folders).toEqual(
      new Map([
        [
          'legacy-folder',
          {
            id: 'legacy-folder',
            name: 'Voyager Data',
            mimeType,
            parents: ['nested-parent'],
            appProperties: { voyagerDataFolder: '1' },
          },
        ],
      ]),
    );
    expect(drive.writes).toEqual(['PATCH /drive/v3/files/legacy-folder']);
  });

  it.each([
    { kind: 'marked legacy name retained for a canonical conflict', canonicalConflict: true },
    { kind: 'unmarked legacy folder after a denied migration', deniedMigration: true },
  ])('keeps a cached $kind usable without repeating discovery or migration', async (options) => {
    const drive = legacyDrive(options);
    await drive.files.prepareDownload('token');
    const afterDiscovery = structuredClone(drive.folders);
    const discoveryWrites = [...drive.writes];
    drive.blockDiscovery();

    await expect(drive.files.ensure('token', promptsName)).resolves.toBe('prompts-file');
    await expect(drive.files.ensure('token', promptsName)).resolves.toBe('prompts-file');

    expect(drive.folders).toEqual(afterDiscovery);
    expect(drive.writes).toEqual(discoveryWrites);
    expect(drive.folders.get('legacy-folder')).toMatchObject({
      name: 'Gemini Voyager Data',
      parents: ['nested-parent'],
    });
  });

  it('shares an in-flight discovery between a download and an upload without creating another folder', async () => {
    const drive = legacyDrive();
    await expect(
      Promise.all([
        drive.backupFolder.resolve('token', false),
        drive.backupFolder.resolve('token', true),
      ]),
    ).resolves.toEqual(['legacy-folder', 'legacy-folder']);
    expect(drive.folders.get('legacy-folder')).toMatchObject({
      name: 'Voyager Data',
      appProperties: { voyagerDataFolder: '1' },
      parents: ['nested-parent'],
    });
    expect(drive.folders.size).toBe(1);
  });

  it('keeps the established metadata migration but does not upload content when a prompts read fails', async () => {
    const drive = legacyDrive();
    drive.fail();
    const beforeContent = new Map(drive.media);
    const downloaded = new GoogleDriveSyncPayloads(drive.files).downloadPrompts('token', null);
    await vi.runAllTimersAsync();

    await expect(downloaded).resolves.toMatchObject({ kind: 'failed' });
    expect(drive.media).toEqual(beforeContent);
    expect(drive.folders.get('legacy-folder')).toMatchObject({
      name: 'Voyager Data',
      appProperties: { voyagerDataFolder: '1' },
    });
    expect(drive.writes).toEqual(['PATCH /drive/v3/files/legacy-folder']);
  });
});
