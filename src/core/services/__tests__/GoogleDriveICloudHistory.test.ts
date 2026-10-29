import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CloudUploadReceipt } from '@/core/types/syncUploadReceipt';

import { GoogleDriveSyncService } from '../GoogleDriveSyncService';
import { createFakeICloudUploadTransport } from './fixtures/fakeICloudUploadTransport';
import { createSyncStorage } from './fixtures/fakeSyncDrive';

const native = vi.hoisted(() => vi.fn());
vi.mock('webextension-polyfill', () => ({ default: { runtime: { sendNativeMessage: native } } }));
vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'safari',
  isSafari: () => true,
  isBrave: () => false,
}));

const name = 'gemini-voyager-prompts.json';
const prompt = (id: string) => ({ id, text: id, tags: [], createdAt: 1 });
const payload = (id: string) =>
  JSON.stringify({ format: 'gemini-voyager.prompts.v1', items: [prompt(id)] });

async function device() {
  const current = new Map<string, string>();
  const transport = createFakeICloudUploadTransport({
    readText: (name) => current.get(name) ?? null,
    writeText: (name, json) => {
      current.set(name, json);
    },
    removeText: (name) => {
      current.delete(name);
    },
  });
  native.mockImplementation(async (_app, message) =>
    message.action === 'iCloudAccountStatus'
      ? { success: true, data: { available: true } }
      : transport(message),
  );
  const local = createSyncStorage({ gvSyncProvider: 'icloud', gvSyncMode: 'disabled' });
  vi.stubGlobal('chrome', {
    runtime: { lastError: null },
    storage: { local: local.area, sync: createSyncStorage().area },
  });
  const service = new GoogleDriveSyncService();
  await service.getState();
  return {
    current,
    histories: transport.histories,
    local,
    service,
    transport,
    upload: (id: string) =>
      service.runExclusive(async (turn) => ({
        ok: await turn.uploadPromptsOnly([prompt(id)], null, false),
        receipt: turn.getUploadReceipt(),
      })),
    restore: (receipt?: CloudUploadReceipt) =>
      service.runExclusive((turn) =>
        turn.restorePreviousVersion([{ name, accountScope: null }], false, receipt),
      ),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  native.mockReset();
});

describe('iCloud recovery through the real sync service', () => {
  it('retains only the newest three recoverable histories for each source after successful writes', async () => {
    const d = await device();
    d.current.set(name, payload('initial'));
    const other = {
      id: 'other-history',
      name: 'gemini-voyager-folders.acct-other.json',
      json: payload('private'),
      createdTime: 1,
    };
    d.histories.set(other.id, other);
    for (const id of ['one', 'two', 'three', 'four', 'five'])
      expect((await d.upload(id)).ok).toBe(true);
    expect(
      [...d.histories.values()]
        .filter((entry) => entry.name === name)
        .map((entry) => JSON.parse(entry.json).items[0].id),
    ).toEqual(['two', 'three', 'four']);
    expect(d.histories.get(other.id)).toEqual(other);
  });

  it('ordinary restore recovers exact first-created bytes retained by Undo without changing local data', async () => {
    const d = await device();
    const uploaded = await d.upload('mine');
    const receipt = uploaded.receipt.files[0];
    if (!receipt) throw new Error('missing upload receipt');
    const raw = d.current.get(name);
    const local = structuredClone(d.local.values);
    await expect(d.restore(uploaded.receipt)).resolves.toEqual([{ name, status: 'removed' }]);
    expect(d.current.has(name)).toBe(false);
    await expect(d.restore()).resolves.toEqual([
      { name, status: 'restored', historyId: expect.any(String) },
    ]);
    expect(d.current.get(name)).toBe(raw);
    expect(d.local.values).toEqual(local);
  });

  it('failed writes never prune histories, while failed cleanup keeps the confirmed upload receipt', async () => {
    const d = await device();
    for (const id of ['initial', 'one', 'two', 'three']) expect((await d.upload(id)).ok).toBe(true);
    const before = new Map(d.histories);
    const send = native.getMockImplementation();
    if (!send) throw new Error('no native transport');
    native.mockImplementation(async (app, message) =>
      message.action === 'iCloudWriteUpload'
        ? { success: false, code: 'icloud_conflict', error: 'changed' }
        : send(app, message),
    );
    expect((await d.upload('failed')).ok).toBe(false);
    expect(d.histories).toEqual(before);
    native.mockImplementation(async (app, message) =>
      message.action === 'iCloudPruneHistory'
        ? { success: true, data: { deleted: 0, errors: [{ error: 'cleanup failed' }] } }
        : send(app, message),
    );
    const uploaded = await d.upload('confirmed');
    expect(uploaded.ok).toBe(true);
    expect(uploaded.receipt.complete).toBe(true);
    expect(uploaded.receipt.files).toHaveLength(1);
    expect(JSON.parse(d.current.get(name) ?? '').items).toEqual([prompt('confirmed')]);
    expect(d.histories.size).toBe(4);
  });

  it('retention preserves unknown raw bytes and timestamp ties, including the exact receipt before-image', async () => {
    const d = await device();
    d.current.set(name, payload('current'));
    const raw = '\uFEFF {future raw format}\r\n';
    d.histories.set('unknown', { id: 'unknown', name, json: raw, createdTime: 0 });
    for (const id of ['one', 'two', 'three', 'four'])
      d.histories.set(id, { id, name, json: payload(id), createdTime: 1 });
    const send = native.getMockImplementation();
    if (!send) throw new Error('no native transport');
    native.mockImplementation(async (app, message) => {
      const result = await send(app, message);
      if (message.action === 'iCloudWriteUpload')
        for (const entry of d.histories.values())
          if (entry.id.startsWith('history-')) entry.createdTime = 1;
      return result;
    });
    const uploaded = await d.upload('mine');
    const receipt = uploaded.receipt.files[0];
    if (receipt?.replaced.kind !== 'history') throw new Error('no before-image');
    expect(d.histories.get(receipt.replaced.historyId)?.json).toBe(payload('current'));
    expect(d.histories.get('unknown')?.json).toBe(raw);
    await expect(d.restore(uploaded.receipt)).resolves.toEqual([
      { name, status: 'restored', historyId: receipt.replaced.historyId },
    ]);
    expect(d.current.get(name)).toBe(payload('current'));
    expect(d.histories.get('unknown')?.json).toBe(raw);
  });

  it('ordinary restore skips malformed newer history and preserves exact valid bytes', async () => {
    const d = await device();
    d.current.set(name, payload('current'));
    const raw = `\uFEFF  ${payload('previous')}\r\n`;
    d.histories.set('valid', { id: 'valid', name, json: raw, createdTime: 1 });
    d.histories.set('corrupt', { id: 'corrupt', name, json: '{broken', createdTime: 2 });
    const local = structuredClone(d.local.values);
    await expect(d.restore()).resolves.toEqual([{ name, status: 'restored', historyId: 'valid' }]);
    expect(d.current.get(name)).toBe(raw);
    expect(d.histories.get('corrupt')?.json).toBe('{broken');
    expect([...d.histories.values()].some((entry) => entry.json === payload('current'))).toBe(true);
    expect(d.local.values).toEqual(local);
  });

  it('a later confirmed create trims histories left by repeated create/Undo runs', async () => {
    const d = await device();
    for (const id of ['one', 'two', 'three', 'four', 'five']) {
      const uploaded = await d.upload(id);
      await expect(d.restore(uploaded.receipt)).resolves.toEqual([{ name, status: 'removed' }]);
    }
    expect(d.histories.size).toBe(4);
    const uploaded = await d.upload('six');
    expect(uploaded.ok).toBe(true);
    expect(uploaded.receipt.files[0]?.replaced).toEqual({ kind: 'created' });
    expect(d.histories.size).toBe(3);
  });
});
