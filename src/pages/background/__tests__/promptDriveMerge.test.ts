import { describe, expect, it } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { PromptImportExportService } from '@/features/backup/services/PromptImportExportService';
import type { PromptItem } from '@/features/backup/types/backup';
import {
  createPromptLibraryClient,
  handlePromptLibraryApplyMessage,
} from '@/features/prompt/library/promptLibraryMessages';
import {
  type PromptLibraryArea,
  createPromptLibraryOwner,
} from '@/features/prompt/library/promptLibraryOwner';
import {
  RESEARCH_PACK_TEMPLATE_TAG,
  createTemplateLibrary,
} from '@/features/researchPack/services/templates';

import { mergeCloudPrompts, mergeCloudPromptsForUpload } from '../promptDriveMerge';

const KEY = StorageKeys.PROMPT_ITEMS;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Storage whose writes land a little after its reads, so overlapping writers can race. */
function setup(initial: unknown) {
  const data = new Map<string, unknown>([[KEY, structuredClone(initial)]]);
  const area: PromptLibraryArea = {
    get: async (key) => {
      await wait(0);
      return data.has(key) ? { [key]: structuredClone(data.get(key)) } : {};
    },
    set: async (items) => {
      await wait(5);
      for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value));
    },
  };
  const owner = createPromptLibraryOwner({ area });
  const template = createTemplateLibrary({
    area,
    key: KEY,
    apply: createPromptLibraryClient((request) =>
      handlePromptLibraryApplyMessage(structuredClone(request), owner),
    ).apply,
    makeId: () => 'template',
  });
  return { owner, template, stored: () => data.get(KEY) as PromptItem[] };
}

const prompt = (id: string, text: string): PromptItem => ({ id, text, tags: [], createdAt: 1 });
const cloud = (...items: PromptItem[]) => PromptImportExportService.exportToPayload(items);

describe('prompts-only Drive merges', () => {
  it('keeps a template saved while a Drive pull is merging', async () => {
    const { owner, template, stored } = setup([prompt('local', 'Local')]);

    const [outcome] = await Promise.all([
      mergeCloudPrompts(owner, cloud(prompt('cloud', 'From Drive'))),
      template.save([{ name: 'Review', text: 'Compare the sources.' }]),
    ]);

    expect(outcome).toEqual({ ok: true, imported: 1, duplicates: 0, nameConflicts: 0 });
    expect(
      stored()
        .map((item) => item.id)
        .sort(),
    ).toEqual(['cloud', 'local', 'template']);
  });

  it('keeps a template saved during a Drive push, and uploads the library the merge wrote', async () => {
    const { owner, template, stored } = setup([prompt('local', 'Local')]);

    const [uploaded] = await Promise.all([
      mergeCloudPromptsForUpload(owner, cloud(prompt('cloud', 'From Drive'))),
      template.save([{ name: 'Review', text: 'Compare the sources.' }]),
    ]);

    expect(uploaded.kind).toBe('ready');
    if (uploaded.kind !== 'ready') throw new Error('Prompt merge was not ready');
    expect(uploaded.items.map((item) => item.id).sort()).toEqual(['cloud', 'local']);
    expect(
      stored()
        .map((item) => item.id)
        .sort(),
    ).toEqual(['cloud', 'local', 'template']);
    expect(stored().find((item) => item.id === 'template')?.tags).toEqual([
      RESEARCH_PACK_TEMPLATE_TAG,
    ]);
  });

  it('uploads a template saved before the push', async () => {
    const { owner, template, stored } = setup([prompt('local', 'Local')]);
    await template.save([{ name: 'Review', text: 'Compare the sources.' }]);

    const uploaded = await mergeCloudPromptsForUpload(owner, cloud(prompt('cloud', 'Drive')));

    expect(uploaded.kind).toBe('ready');
    if (uploaded.kind !== 'ready') throw new Error('Prompt merge was not ready');
    expect(uploaded.items.map((item) => item.id).sort()).toEqual(['cloud', 'local', 'template']);
    expect(uploaded.items).toEqual(stored());
  });

  it('changes nothing for an empty cloud file, and uploads the library as stored', async () => {
    const { owner, stored } = setup([prompt('local', 'Local')]);

    await expect(mergeCloudPrompts(owner, null)).resolves.toEqual({ ok: true, empty: true });
    await expect(mergeCloudPromptsForUpload(owner, { items: [] })).resolves.toEqual({
      kind: 'ready',
      items: [prompt('local', 'Local')],
    });
    expect(stored()).toEqual([prompt('local', 'Local')]);
  });

  it('reports a failure, and never uploads or overwrites, when the stored library is not a list', async () => {
    const { owner, stored } = setup({ not: 'a list' });

    await expect(mergeCloudPrompts(owner, cloud(prompt('c', 'C')))).resolves.toMatchObject({
      ok: false,
    });
    await expect(mergeCloudPromptsForUpload(owner, cloud(prompt('c', 'C')))).resolves.toEqual({
      kind: 'failed',
    });
    expect(stored()).toEqual({ not: 'a list' });
  });
});
