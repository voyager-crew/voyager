import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { refusedGuardToken } from './fixtures/guardConfirmation';
import { createGuardDevice, guardFiles } from './fixtures/uploadGuardDevice';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('returns local_read_failed for unreadable upload plugins with zero Drive changes', async () => {
  const d = await createGuardDevice();
  d.values[StorageKeys.PLUGINS_STATE] = ['invalid'];
  const before = structuredClone(d.values);
  await expect(d.request()).resolves.toEqual({ ok: false, error: 'local_read_failed' });
  expect(d.drive.files.size).toBe(0);
  expect(d.values).toEqual(before);
});

it.each([
  'gv.sync.upload',
  'gv.sync.download',
  'gv.sync.pullPromptsMerge',
  'gv.sync.pushPromptsMerge',
])('%s reports cloud_read_failed without exposing its raw diagnostic as the code', async (type) => {
  const d = await createGuardDevice();
  d.setLocal('prompts', 1);
  d.putCloud('prompts', 24);
  d.drive.failReads.add(guardFiles.prompts);
  const before = new Map(d.drive.files);
  const pending = d.request(type, { force: true });
  await vi.runAllTimersAsync();
  await expect(pending).resolves.toMatchObject({ ok: false, error: 'cloud_read_failed' });
  expect(d.drive.files).toEqual(before);
  const state = await d.service.getState();
  expect(state.error).not.toBe('cloud_read_failed');
});

it('prompts push returns local_read_failed before writing either local or cloud data', async () => {
  const d = await createGuardDevice();
  d.values[StorageKeys.PROMPT_ITEMS] = { invalid: true };
  const before = structuredClone(d.values);
  await expect(d.request('gv.sync.pushPromptsMerge')).resolves.toMatchObject({
    ok: false,
    error: 'local_read_failed',
  });
  expect(d.drive.writes).toEqual([]);
  expect(d.values).toEqual(before);
});

it('a confirmed iCloud prompts retry still aborts its failed first read without a second safety net', async () => {
  const d = await createGuardDevice({ provider: 'icloud' });
  d.setLocal('prompts', 1);
  d.drive.put(guardFiles.prompts, { format: 'future.prompts' });
  const guardToken = await refusedGuardToken(d.request('gv.sync.pushPromptsMerge'));
  d.putCloud('prompts', 24);
  const before = new Map(d.drive.files);
  const local = structuredClone(d.values);
  let reads = 0;
  d.drive.beforeRead = async (name) => {
    if (name !== guardFiles.prompts) return;
    if (++reads <= 3) d.drive.failReads.add(name);
    else d.drive.failReads.delete(name);
  };
  const pending = d.request('gv.sync.pushPromptsMerge', { force: true, guardToken });
  await vi.runAllTimersAsync();
  await expect(pending).resolves.toMatchObject({ ok: false, error: 'cloud_read_failed' });
  expect(d.drive.files).toEqual(before);
  expect(d.values).toEqual(local);
  expect(d.drive.writes).toEqual([]);
});
