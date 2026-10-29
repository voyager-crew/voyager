import { describe, expect, it } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { PromptImportExportService } from '@/features/backup/services/PromptImportExportService';
import type { PromptItem } from '@/features/backup/types/backup';
import {
  type PromptLibraryArea,
  createPromptLibraryOwner,
} from '@/features/prompt/library/promptLibraryOwner';

import { mergeCloudPrompts, mergeCloudPromptsForUpload } from '../promptDriveMerge';

const KEY = StorageKeys.PROMPT_ITEMS;

/** One device: its stored library and the background owner that writes it. */
function device(initial: PromptItem[]) {
  const data = new Map<string, unknown>([[KEY, structuredClone(initial)]]);
  const area: PromptLibraryArea = {
    get: async (key) => (data.has(key) ? { [key]: structuredClone(data.get(key)) } : {}),
    set: async (items) => {
      for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value));
    },
  };
  const owner = createPromptLibraryOwner({ area });
  return {
    owner,
    stored: () => data.get(KEY) as PromptItem[],
    /** Reorders as a Prompt Manager drag does. */
    reorder: (ids: string[]) => owner.apply({ kind: 'reorder', ids }),
    add: (item: PromptItem) => owner.apply({ kind: 'add', items: [item] }),
  };
}

// `createdAt` values are chosen so that the manual order is not newest-first.
const prompt = (id: string, createdAt: number): PromptItem => ({
  id,
  text: `Body of ${id}`,
  tags: [],
  createdAt,
});
const cloud = (...items: PromptItem[]) => PromptImportExportService.exportToPayload(items);
const ids = (items: PromptItem[]) => items.map((item) => item.id);

async function pushedFile(owner: ReturnType<typeof createPromptLibraryOwner>, drive: unknown) {
  const uploaded = await mergeCloudPromptsForUpload(owner, drive);
  expect(uploaded.kind).toBe('ready');
  if (uploaded.kind !== 'ready') throw new Error('Prompt merge was not ready');
  return cloud(...uploaded.items);
}

describe('prompt order through the prompts-only Drive merges', () => {
  it('keeps the local order on a pull and places a cloud-only prompt by its cloud neighbour', async () => {
    const local = device([prompt('b', 2), prompt('a', 3), prompt('c', 1)]);

    await mergeCloudPrompts(
      local.owner,
      cloud(prompt('a', 3), prompt('b', 2), prompt('c', 1), prompt('x', 9)),
    );

    expect(ids(local.stored())).toEqual(['b', 'a', 'c', 'x']);
  });

  it('uploads the local order on a push', async () => {
    const local = device([prompt('b', 2), prompt('a', 3), prompt('c', 1)]);

    const uploaded = await mergeCloudPromptsForUpload(
      local.owner,
      cloud(prompt('x', 9), prompt('a', 3), prompt('b', 2), prompt('c', 1)),
    );

    expect(uploaded.kind).toBe('ready');
    if (uploaded.kind !== 'ready') throw new Error('Prompt merge was not ready');
    expect(ids(uploaded.items)).toEqual(['x', 'b', 'a', 'c']);
    expect(uploaded.items).toEqual(local.stored());
  });

  it('round-trips between two devices: the pusher sets Drive, a puller keeps its own order', async () => {
    const shared = [prompt('a', 1), prompt('b', 3), prompt('c', 2)];
    const laptop = device(shared);
    const desktop = device(shared);
    let drive: unknown = null;

    // The laptop adds a prompt at the top and drags `c` first, then pushes.
    await laptop.add(prompt('new', 10));
    await laptop.reorder(['c', 'new', 'a', 'b']);
    drive = await pushedFile(laptop.owner, drive);

    // The desktop had its own manual order; a pull keeps it and takes the new prompt.
    await desktop.reorder(['b', 'a', 'c']);
    await mergeCloudPrompts(desktop.owner, drive);
    expect(ids(desktop.stored())).toEqual(['b', 'a', 'c', 'new']);

    // The desktop pushes; Drive now holds the desktop's order, the laptop keeps its own.
    drive = await pushedFile(desktop.owner, drive);
    await mergeCloudPrompts(laptop.owner, drive);
    expect(ids(laptop.stored())).toEqual(['c', 'new', 'a', 'b']);
    expect(ids(desktop.stored())).toEqual(['b', 'a', 'c', 'new']);
  });
});
