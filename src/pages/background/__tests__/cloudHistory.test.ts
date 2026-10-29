import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GoogleDriveBackupFolder } from '@/core/services/GoogleDriveBackupFolder';
import { StorageKeys } from '@/core/types/common';

import {
  createGuardDevice,
  guardEnvelope,
  guardFiles,
  guardFolders,
  guardPrompt,
  GUARD_TIME,
} from './fixtures/uploadGuardDevice';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(GUARD_TIME));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('upload history through the real background queue', () => {
  it.each([false, true])(
    'preserves the exact replaced bytes before a Google upload (Safari=%s)',
    async (safari) => {
      const d = await createGuardDevice({ safari });
      d.setLocal('prompts', 1);
      const old = JSON.stringify(guardEnvelope('prompts', [guardPrompt('older')]), null, 2);
      d.drive.files.set(guardFiles.prompts, old);
      const local = structuredClone(d.values[StorageKeys.PROMPT_ITEMS]);

      await expect(d.request()).resolves.toMatchObject({ ok: true });
      const history = d.drive.histories(guardFiles.prompts);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        name: 'gemini-voyager-prompts.backup-2026-10-29-120000.json',
        parents: ['sync-test-folder'],
        appProperties: { voyagerHistorySource: guardFiles.prompts },
      });
      expect(d.drive.files.get(history[0].id)).toBe(old);
      expect(d.drive.payload(guardFiles.prompts)).toMatchObject({
        items: [guardPrompt('prompt-0')],
      });
      expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual(local);
    },
  );

  it('keeps three histories and moves the fourth to trash without deleting its bytes', async () => {
    const d = await createGuardDevice();
    d.setLocal('prompts', 1);
    d.drive.put(guardFiles.prompts, guardEnvelope('prompts', [guardPrompt('original')]));
    const versions = ['first', 'second', 'third', 'fourth'];
    for (const id of versions) {
      d.values[StorageKeys.PROMPT_ITEMS] = [guardPrompt(id)];
      await expect(d.request()).resolves.toMatchObject({ ok: true });
    }
    const all = d.drive.histories(guardFiles.prompts, true);
    expect(all).toHaveLength(4);
    const active = d.drive.histories(guardFiles.prompts);
    expect(active).toHaveLength(3);
    const trashed = all.filter((file) => d.drive.trashed.has(file.id));
    expect(trashed).toHaveLength(1);
    expect(d.drive.payload(trashed[0].id)).toMatchObject({ items: [guardPrompt('original')] });
    const kept = active.map(
      (file) => d.drive.payload<{ items: { id: string }[] }>(file.id).items[0].id,
    );
    expect(kept.sort()).toEqual(['first', 'second', 'third']);
    expect(d.drive.payload(guardFiles.prompts)).toMatchObject({ items: [guardPrompt('fourth')] });
  });

  it('Safari retains and restores its newly saved history using server time when the device clock is behind', async () => {
    const d = await createGuardDevice({ safari: true });
    d.drive.serverNow = () => Date.parse('2026-11-02T12:00:00.000Z');
    d.setLocal('prompts', 1);
    d.drive.put(
      guardFiles.prompts,
      guardEnvelope('prompts', [guardPrompt('current-before-upload')]),
    );
    const before = d.drive.files.get(guardFiles.prompts);
    for (let index = 0; index < 3; index++) {
      const name = `gemini-voyager-prompts.backup-2026-11-01-12000${index}.json`;
      d.drive.put(name, guardEnvelope('prompts', [guardPrompt(`older-${index}`)]));
      d.drive.metadata.set(name, {
        ...d.drive.metadata.get(name)!,
        createdTime: new Date(Date.parse('2026-11-01T12:00:00.000Z') + index * 1000).toISOString(),
        appProperties: { voyagerHistorySource: guardFiles.prompts },
      });
    }

    await expect(d.request()).resolves.toMatchObject({ ok: true });
    const active = d.drive.histories(guardFiles.prompts);
    expect(active).toHaveLength(3);
    const saved = active.find((file) => d.drive.files.get(file.id) === before);
    expect(saved).toBeDefined();
    expect(saved?.createdTime).toMatch(/^2026-11-02T12:00:00\./);
    const discarded = d.drive
      .histories(guardFiles.prompts, true)
      .filter((file) => d.drive.trashed.has(file.id));
    expect(discarded).toHaveLength(1);
    expect(d.drive.payload(discarded[0].id)).toMatchObject({ items: [guardPrompt('older-0')] });

    await expect(
      d.request('gv.sync.restorePreviousVersion', { files: [guardFiles.prompts] }),
    ).resolves.toMatchObject({
      ok: true,
      files: [{ name: guardFiles.prompts, status: 'restored', historyId: saved?.id }],
    });
    expect(d.drive.files.get(guardFiles.prompts)).toBe(before);
    expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([guardPrompt('prompt-0')]);
  });

  it.each([false, true])(
    'failed archives leave no history stubs and the next upload stays restorable (Safari=%s)',
    async (safari) => {
      const d = await createGuardDevice({ safari });
      d.setLocal('prompts', 1);
      d.drive.put(guardFiles.prompts, guardEnvelope('prompts', [guardPrompt('keep')]));
      const previous = d.drive.files.get(guardFiles.prompts);
      let attemptedHistoryWrites = 0;
      d.drive.beforeWrite = async (name) => {
        if (name.includes('.backup-')) {
          attemptedHistoryWrites++;
          throw new Error('History media unavailable');
        }
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        const upload = d.request();
        await vi.runAllTimersAsync();
        await expect(upload).resolves.toMatchObject({ ok: false });
        expect(d.drive.histories(guardFiles.prompts, true)).toEqual([]);
        expect(d.drive.files.get(guardFiles.prompts)).toBe(previous);
      }
      expect(attemptedHistoryWrites).toBeGreaterThan(0);
      d.drive.beforeWrite = undefined;
      await expect(d.request()).resolves.toMatchObject({ ok: true });
      expect(d.drive.histories(guardFiles.prompts)).toHaveLength(1);
      await expect(
        d.request('gv.sync.restorePreviousVersion', { files: [guardFiles.prompts] }),
      ).resolves.toMatchObject({ ok: true });
      expect(d.drive.files.get(guardFiles.prompts)).toBe(previous);
      expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([guardPrompt('prompt-0')]);
    },
  );

  it.each([false, true])(
    'restores previous content and makes the replaced version restorable (Safari=%s)',
    async (safari) => {
      const d = await createGuardDevice({ safari });
      d.setLocal('prompts', 1);
      d.drive.put(guardFiles.prompts, guardEnvelope('prompts', [guardPrompt('previous')]));
      const previous = d.drive.files.get(guardFiles.prompts);
      await expect(d.request()).resolves.toMatchObject({ ok: true });
      const uploaded = d.drive.files.get(guardFiles.prompts);

      const restore = () =>
        d.request('gv.sync.restorePreviousVersion', { files: [guardFiles.prompts] });
      await expect(restore()).resolves.toMatchObject({
        ok: true,
        files: [{ name: guardFiles.prompts, status: 'restored' }],
      });
      expect(d.drive.files.get(guardFiles.prompts)).toBe(previous);
      expect(
        d.drive
          .histories(guardFiles.prompts)
          .some((file) => d.drive.files.get(file.id) === uploaded),
      ).toBe(true);
      await expect(restore()).resolves.toMatchObject({ ok: true });
      expect(d.drive.files.get(guardFiles.prompts)).toBe(uploaded);
      expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([guardPrompt('prompt-0')]);
    },
  );

  it('reports no history, unreadable history and failed reads independently', async () => {
    const d = await createGuardDevice();
    const broken = 'gemini-voyager-prompts.backup-2026-10-29-110000.json';
    d.drive.files.set(broken, '{not JSON');
    d.drive.metadata.set(broken, {
      id: broken,
      name: broken,
      parents: ['sync-test-folder'],
      createdTime: GUARD_TIME,
      appProperties: { voyagerHistorySource: guardFiles.prompts },
    });
    const failed = 'gemini-voyager-plugins.backup-2026-10-29-110000.json';
    d.drive.put(failed, guardEnvelope('plugins', {}));
    d.drive.metadata.set(failed, {
      ...d.drive.metadata.get(failed)!,
      appProperties: { voyagerHistorySource: guardFiles.plugins },
    });
    d.drive.failReads.add(failed);
    const cloud = new Map(d.drive.files);
    const local = structuredClone(d.values);
    const restore = d.request('gv.sync.restorePreviousVersion', {
      files: [guardFiles.folders, guardFiles.prompts, guardFiles.plugins],
    });
    await vi.runAllTimersAsync();
    await expect(restore).resolves.toMatchObject({
      ok: false,
      files: [
        { name: guardFiles.folders, status: 'no_history' },
        { name: guardFiles.prompts, status: 'unrecognized_history' },
        { name: guardFiles.plugins, status: 'read_failed' },
      ],
    });
    expect(d.drive.files).toEqual(cloud);
    expect(d.values).toEqual(local);
  });

  it('a restore keeps its queue turn until the next upload may replace the restored file', async () => {
    const d = await createGuardDevice();
    d.setLocal('prompts', 1);
    d.drive.put(guardFiles.prompts, guardEnvelope('prompts', [guardPrompt('previous')]));
    await expect(d.request()).resolves.toMatchObject({ ok: true });
    const history = d.drive.histories(guardFiles.prompts)[0];
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((done) => {
      release = done;
    });
    const reading = new Promise<void>((done) => {
      started = done;
    });
    d.drive.beforeRead = async (name) => {
      if (name === history.id) {
        started();
        await held;
      }
    };
    const restore = d.request('gv.sync.restorePreviousVersion', { files: [guardFiles.prompts] });
    await reading;
    d.values[StorageKeys.PROMPT_ITEMS] = [guardPrompt('newest-local')];
    const upload = d.request();
    await vi.advanceTimersByTimeAsync(0);
    release();
    await expect(restore).resolves.toMatchObject({ ok: true });
    await expect(upload).resolves.toMatchObject({ ok: true });
    expect(d.drive.payload(guardFiles.prompts)).toMatchObject({
      items: [guardPrompt('newest-local')],
    });
    expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([guardPrompt('newest-local')]);
  });

  it('the restore message cannot write an arbitrary non-sync Drive file', async () => {
    const d = await createGuardDevice();
    d.drive.put('unrelated-note.json', { unrelated: 'keep' });
    const cloud = new Map(d.drive.files);
    const local = structuredClone(d.values);
    await expect(
      d.request('gv.sync.restorePreviousVersion', { files: ['unrelated-note.json'] }),
    ).resolves.toMatchObject({ ok: false });
    expect(d.drive.files).toEqual(cloud);
    expect(d.values).toEqual(local);
  });

  it('exact-name current-file lookups cannot return a history sibling', async () => {
    const d = await createGuardDevice();
    const history = 'gemini-voyager-prompts.backup-2026-10-29-110000.json';
    d.drive.put(history, guardEnvelope('prompts', [guardPrompt('history-only')]));
    d.drive.metadata.set(history, {
      ...d.drive.metadata.get(history)!,
      appProperties: { voyagerHistorySource: guardFiles.prompts },
    });
    await expect(d.request('gv.sync.pullPromptsMerge')).resolves.toMatchObject({
      ok: true,
      empty: true,
    });
    expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([]);
    expect(d.drive.files.has(guardFiles.prompts)).toBe(false);
    d.drive.put(guardFiles.prompts, guardEnvelope('prompts', [guardPrompt('current')]));
    await expect(d.request('gv.sync.pullPromptsMerge')).resolves.toMatchObject({
      ok: true,
      imported: 1,
    });
    expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([guardPrompt('current')]);
  });

  it('backup-folder recovery ignores a renamed folder holding only history siblings', async () => {
    const d = await createGuardDevice();
    d.drive.folders.clear();
    d.drive.folders.set('history-only-folder', {
      id: 'history-only-folder',
      name: 'Renamed history archive',
      mimeType: 'application/vnd.google-apps.folder',
    });
    const history = 'gemini-voyager-folders.backup-2026-10-29-110000.json';
    d.drive.put(history, guardEnvelope('folders', guardFolders(3)));
    d.drive.metadata.set(history, {
      ...d.drive.metadata.get(history)!,
      parents: ['history-only-folder'],
      appProperties: { voyagerHistorySource: guardFiles.folders },
    });
    const folder = new GoogleDriveBackupFolder([guardFiles.folders, guardFiles.prompts]);
    await expect(folder.resolve('token', false)).resolves.toBeNull();
    expect(d.drive.folders.get('history-only-folder')).toMatchObject({
      name: 'Renamed history archive',
    });
    expect(d.drive.files.get(history)).toContain('Folder 2');
    d.drive.put(guardFiles.folders, guardEnvelope('folders', guardFolders(1)));
    d.drive.metadata.set(guardFiles.folders, {
      ...d.drive.metadata.get(guardFiles.folders)!,
      parents: ['history-only-folder'],
    });
    await expect(
      new GoogleDriveBackupFolder([guardFiles.folders, guardFiles.prompts]).resolve('token', false),
    ).resolves.toBe('history-only-folder');
    expect(d.drive.folders.get('history-only-folder')?.appProperties).toMatchObject({
      voyagerDataFolder: '1',
    });
  });
});
