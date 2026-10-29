import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GoogleDriveBackupFolder } from '../GoogleDriveBackupFolder';
import { GoogleDriveFiles } from '../GoogleDriveFiles';
import { GoogleDriveUploadFiles } from '../GoogleDriveUploadFiles';
import { FakeSyncDrive } from './fixtures/fakeSyncDrive';

vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'chrome',
  isSafari: () => false,
  isBrave: () => false,
}));

const source = 'gemini-voyager-prompts.json';
const payload = (id: string) => ({
  format: 'gemini-voyager.prompts.v1',
  items: [{ id, text: id, tags: [], createdAt: 1 }],
});

function fixture() {
  const drive = new FakeSyncDrive();
  vi.stubGlobal('fetch', drive.fetch);
  const files = new GoogleDriveFiles(new GoogleDriveBackupFolder([source]), {
    getProvider: () => 'googleDrive',
    onAuthLost: () => {},
  });
  return { drive, upload: new GoogleDriveUploadFiles(files) };
}

function isMediaWrite(input: RequestInfo | URL, init?: RequestInit): boolean {
  return (
    new URL(String(input)).pathname === `/upload/drive/v3/files/${source}` &&
    init?.method === 'PATCH'
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T12:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('upload receipt completeness through the real Drive transport', () => {
  it('keeps an unchanged existing file out of Undo without making the receipt incomplete', async () => {
    const d = fixture();
    d.drive.put(source, payload('same'));

    await d.upload.write('token', source, payload('same'));

    expect(d.drive.payload(source)).toEqual(payload('same'));
    expect(d.drive.writes).toEqual([]);
    expect(d.upload.getReceipt()).toEqual({ complete: true, files: [] });
  });

  it('does not offer complete Undo when a creation response is lost after the file was created', async () => {
    const d = fixture();
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await d.drive.fetch(input, init);
      if (new URL(String(input)).pathname === '/drive/v3/files' && init?.method === 'POST') {
        const metadata: unknown = JSON.parse(String(init.body));
        if (
          metadata &&
          typeof metadata === 'object' &&
          'name' in metadata &&
          metadata.name === source
        )
          throw new Error('Creation response lost');
      }
      return response;
    });

    await expect(d.upload.write('token', source, payload('created'))).rejects.toThrow(
      'Creation response lost',
    );

    expect(d.drive.files.has(source)).toBe(true);
    expect(d.upload.getReceipt()).toEqual({ complete: false, files: [] });
  });

  it('keeps Undo incomplete when a retry sees the bytes of its own unreceipted write', async () => {
    const d = fixture();
    d.drive.put(source, payload('original'));
    let loseResponse = true;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await d.drive.fetch(input, init);
      if (isMediaWrite(input, init) && loseResponse) {
        loseResponse = false;
        throw new Error('Media response lost');
      }
      return response;
    });

    const writing = d.upload.write('token', source, payload('uploaded'));
    await vi.runAllTimersAsync();
    await writing;

    expect(d.drive.payload(source)).toEqual(payload('uploaded'));
    expect(d.drive.histories(source).map(({ id }) => d.drive.payload(id))).toContainEqual(
      payload('original'),
    );
    expect(d.upload.getReceipt()).toEqual({ complete: false, files: [] });
  });

  it('does not turn malformed success metadata into a new upload or a complete receipt', async () => {
    const d = fixture();
    d.drive.put(source, payload('original'));
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await d.drive.fetch(input, init);
      return isMediaWrite(input, init) ? Response.json({ id: source }) : response;
    });

    await expect(d.upload.write('token', source, payload('uploaded'))).rejects.toThrow(
      'invalid_drive_metadata',
    );

    expect(d.drive.payload(source)).toEqual(payload('uploaded'));
    expect(d.drive.writes.filter((name) => name === source)).toEqual([source]);
    expect(d.upload.getReceipt()).toEqual({ complete: false, files: [] });
  });

  it('archives stable current bytes when another device changes away and back during the media read', async () => {
    const d = fixture();
    d.drive.put(source, payload('prepared'));
    d.upload.register(source);
    await d.upload.prepare('token');
    d.drive.put(source, payload('current'));
    let changeDuringRead = true;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (
        url.pathname === `/drive/v3/files/${source}` &&
        url.searchParams.get('alt') === 'media' &&
        changeDuringRead
      ) {
        changeDuringRead = false;
        d.drive.put(source, payload('transient'));
        const response = await d.drive.fetch(input, init);
        d.drive.put(source, payload('current'));
        const metadata = d.drive.metadata.get(source);
        if (!metadata) throw new Error('Missing returned cloud version');
        metadata.modifiedTime = '2026-10-29T12:01:00.000Z';
        return response;
      }
      return d.drive.fetch(input, init);
    });

    await d.upload.write('token', source, payload('uploaded'));

    expect(d.drive.histories(source).map(({ id }) => d.drive.payload(id))).toContainEqual(
      payload('current'),
    );
    const [written] = d.upload.getReceipt().files;
    expect(written?.replaced.kind).toBe('history');
    if (written?.replaced.kind !== 'history') throw new Error('Missing exact undo target');
    expect(d.drive.payload(written.replaced.historyId)).toEqual(payload('current'));
  });
});
