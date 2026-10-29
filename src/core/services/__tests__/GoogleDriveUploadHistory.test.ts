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
const time = '2026-10-29T01:30:00.000Z';
const promptPayload = (text: string) => ({
  format: 'gemini-voyager.prompts.v1',
  exportedAt: time,
  items: [{ id: text, text, tags: [], createdAt: 1 }],
});

function fixture() {
  const drive = new FakeSyncDrive();
  vi.stubGlobal('fetch', drive.fetch);
  const files = new GoogleDriveFiles(new GoogleDriveBackupFolder([source]), {
    getProvider: () => 'googleDrive',
    onAuthLost: () => {},
  });
  return { drive, files, upload: () => new GoogleDriveUploadFiles(files) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(time));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('upload history media preservation', () => {
  it('saves exact nonempty old bytes with a source marker before replacing the current file', async () => {
    const d = fixture();
    d.drive.put(source, promptPayload('old'));
    const old = `\n${JSON.stringify(promptPayload('old'), null, 2)}\n`;
    d.drive.files.set(source, old);
    await d.upload().write('token', source, promptPayload('new'));

    const history = d.drive.histories(source);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      name: 'gemini-voyager-prompts.backup-2026-10-29-013000.json',
      appProperties: { voyagerHistorySource: source },
      parents: d.drive.metadata.get(source)?.parents,
    });
    expect(d.drive.files.get(history[0].id)).toBe(old);
    expect(d.drive.payload(source)).toEqual(promptPayload('new'));
  });

  it('preserves unrecognized and existing zero-byte media for an exact upload Undo', async () => {
    const d = fixture();
    d.drive.put(source, {});
    d.drive.files.set(source, '{a future or malformed payload\n');
    await d.upload().write('token', source, promptPayload('readable'));
    expect(d.drive.files.get(d.drive.histories(source)[0].id)).toBe(
      '{a future or malformed payload\n',
    );
    const emptySource = 'gemini-voyager-plugins.json';
    d.drive.files.set(emptySource, '');
    await d.upload().write('token', emptySource, {
      format: 'gemini-voyager.plugins.v1',
      data: {},
    });
    expect(d.drive.histories(emptySource)).toHaveLength(1);
    expect(d.drive.files.get(d.drive.histories(emptySource)[0].id)).toBe('');
    expect(d.drive.payload(emptySource)).toEqual({
      format: 'gemini-voyager.plugins.v1',
      data: {},
    });
  });

  it('same-second uploads create distinct snapshots and trash older history without deleting it', async () => {
    const d = fixture();
    d.drive.put(source, promptPayload('zero'));
    for (const value of ['one', 'two', 'three', 'four', 'five', 'six']) {
      await d.upload().write('token', source, promptPayload(value));
    }
    const active = d.drive.histories(source);
    const all = d.drive.histories(source, true);
    expect(active).toHaveLength(3);
    expect(all).toHaveLength(6);
    expect(new Set(all.map(({ name }) => name)).size).toBe(6);
    expect(active.map(({ id }) => d.drive.payload(id))).toEqual(
      expect.arrayContaining([
        promptPayload('three'),
        promptPayload('four'),
        promptPayload('five'),
      ]),
    );
    const discarded = all.find(
      ({ id }) =>
        d.drive.trashed.has(id) && d.drive.files.get(id) === JSON.stringify(promptPayload('zero')),
    );
    expect(discarded).toBeDefined();
    expect(d.drive.files.get(discarded!.id)).toBe(JSON.stringify(promptPayload('zero')));
    expect(d.drive.payload(source)).toEqual(promptPayload('six'));
    await expect(d.upload().restoreHistory('token', [source])).resolves.toMatchObject([
      { name: source, status: 'restored' },
    ]);
    expect(d.drive.payload(source)).toEqual(promptPayload('five'));
  });

  it('failed history media leaves the current content unchanged', async () => {
    const d = fixture();
    d.drive.put(source, promptPayload('old'));
    const old = d.drive.files.get(source);
    d.drive.beforeWrite = async (name) => {
      if (name !== source) d.drive.failWrites.add(name);
    };
    const writing = expect(
      d.upload().write('token', source, promptPayload('new')),
    ).rejects.toThrow();
    await vi.runAllTimersAsync();
    await writing;
    expect(d.drive.files.get(source)).toBe(old);
    expect(d.drive.writes).not.toContain(source);
    expect(d.drive.histories(source, true)).toEqual([]);
  });

  it('a later preflight failure never creates or overwrites an earlier target or invokes persistence', async () => {
    const d = fixture();
    d.drive.put(source, promptPayload('old'));
    const later = 'gemini-voyager-plugins.json';
    d.drive.failFinds.add(later);
    const upload = d.upload();
    upload.register(source, later);
    const persistence = vi.fn(async () => {});
    upload.setBeforeFirstWrite(persistence);
    const original = new Map(d.drive.files);
    await expect(upload.write('token', source, promptPayload('new'))).rejects.toThrow();
    expect(d.drive.files).toEqual(original);
    expect(persistence).not.toHaveBeenCalled();
  });

  it('restores the newest history and records the replaced current body so restore can be reversed', async () => {
    const d = fixture();
    d.drive.put(source, promptPayload('old'));
    await d.upload().write('token', source, promptPayload('new'));
    const restored = await d.upload().restoreHistory('token', [source]);
    expect(restored).toMatchObject([{ name: source, status: 'restored' }]);
    expect(d.drive.payload(source)).toEqual(promptPayload('old'));
    expect(d.drive.histories(source).map(({ id }) => d.drive.payload(id))).toContainEqual(
      promptPayload('new'),
    );

    await expect(d.upload().restoreHistory('token', [source])).resolves.toMatchObject([
      { name: source, status: 'restored' },
    ]);
    expect(d.drive.payload(source)).toEqual(promptPayload('new'));
  });

  it('unrecognized history is reported without replacing current bytes', async () => {
    const d = fixture();
    d.drive.put(source, promptPayload('old'));
    await d.upload().write('token', source, promptPayload('new'));
    d.drive.files.set(d.drive.histories(source)[0].id, '{bad history');
    const before = new Map(d.drive.files);
    await expect(d.upload().restoreHistory('token', [source])).resolves.toEqual([
      { name: source, status: 'unrecognized_history' },
    ]);
    expect(d.drive.files).toEqual(before);
  });
});
