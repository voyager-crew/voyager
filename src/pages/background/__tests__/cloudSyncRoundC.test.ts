import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import {
  createGuardDevice,
  guardFiles,
  guardPrompt,
  guardEnvelope,
} from './fixtures/uploadGuardDevice';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('lossless sync preflight', () => {
  it('keeps cloud and local template whitespace through a prompts-only push', async () => {
    const d = await createGuardDevice();
    const local = { ...guardPrompt('local'), text: '    local()\n', name: ' Local ' };
    const cloud = { ...guardPrompt('cloud'), text: '    remote()\n', name: ' Cloud ' };
    d.values[StorageKeys.PROMPT_ITEMS] = [local];
    d.drive.put(guardFiles.prompts, guardEnvelope('prompts', [cloud]));
    await expect(d.request('gv.sync.pushPromptsMerge')).resolves.toMatchObject({ ok: true });
    expect(d.drive.payload<{ items: unknown[] }>(guardFiles.prompts).items).toEqual([cloud, local]);
    expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([cloud, local]);
  });
  it('does not guard or read omitted empty prompts while uploading shared settings', async () => {
    const d = await createGuardDevice();
    d.putCloud('prompts', 24);
    const previous = d.drive.files.get(guardFiles.prompts);
    await expect(d.request('gv.sync.upload', { selection: 'shared' })).resolves.toMatchObject({
      ok: true,
    });
    expect(d.drive.files.get(guardFiles.prompts)).toEqual(previous);
    expect(d.drive.writes).not.toContain(guardFiles.prompts);
  });
  it('uploads a prompt template without trimming its indentation, newline or name', async () => {
    const d = await createGuardDevice();
    const prompt = {
      ...guardPrompt('template'),
      text: '    print("hello")\n',
      name: '  Template  ',
    };
    d.values[StorageKeys.PROMPT_ITEMS] = [prompt];
    await expect(d.request('gv.sync.upload', { selection: 'shared' })).resolves.toMatchObject({
      ok: true,
    });
    expect(d.drive.payload(guardFiles.prompts)).toMatchObject({ items: [prompt] });
    expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([prompt]);
  });
});
