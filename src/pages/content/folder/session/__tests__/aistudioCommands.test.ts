import { describe, expect, it, vi } from 'vitest';

import { AISTUDIO_ROOT_BUCKET_ID } from '@/features/folder/constants';
import { validateFolderData } from '@/features/folder/model/folderData';
import { FOLDER_SITE_TABLE } from '@/features/folder/sites/folderSiteTable';

import { FolderDataSession } from '../../FolderDataSession';
import type { FolderData } from '../../types';
import { createAIStudioCommands } from '../aistudioCommands';

function fixture(data: FolderData, canEdit = true) {
  const repository = {
    data,
    canEdit,
    session: new FolderDataSession('test', 'test', null, validateFolderData),
    saveData: vi.fn().mockResolvedValue(canEdit),
    replaceData: vi.fn().mockResolvedValue(true),
  };
  const hooks = { commit: vi.fn().mockResolvedValue(undefined), onDraftSettled: vi.fn() };
  return { repository, hooks, commands: createAIStudioCommands(repository, hooks) };
}

const folder = (id: string) => ({
  id,
  name: id,
  parentId: null,
  isExpanded: true,
  createdAt: 1,
  updatedAt: 1,
});

const prompt = (title: string) => ({
  conversationId: 'p1',
  title,
  url: '/prompts/p1',
  addedAt: 1,
  starred: true,
  customTitle: true,
});

describe('AI Studio command boundaries', () => {
  it('edits synchronously and commits only changes, preserving caller-provided folder ids', async () => {
    const { commands, repository, hooks } = fixture({ folders: [], folderContents: {} });
    const creating = commands.run({
      kind: 'createFolder',
      folderId: 'old-id-format',
      name: 'First',
      parentId: null,
    });
    expect(repository.data.folders[0]?.id).toBe('old-id-format');
    expect(hooks.commit).toHaveBeenCalledTimes(1);
    await creating;
    await commands.run({ kind: 'renameFolder', folderId: 'old-id-format', name: 'First' });
    expect(hooks.commit).toHaveBeenCalledTimes(1);
    repository.canEdit = false;
    await commands.run({ kind: 'renameFolder', folderId: 'old-id-format', name: 'Other' });
    expect(repository.data.folders[0]?.name).toBe('First');
    expect(hooks.commit).toHaveBeenCalledTimes(1);
  });

  it('refuses, unchanged and unsaved, every edit the core folder table refuses on AI Studio', async () => {
    const data: FolderData = { folders: [folder('a')], folderContents: { a: [prompt('Kept')] } };
    const before = structuredClone(data);
    const { commands, hooks } = fixture(data);
    const bodies = {
      moveFolder: { kind: 'moveFolder', folderId: 'a', parentId: null },
      setFolderColor: { kind: 'setFolderColor', folderId: 'a', color: 'blue' },
      moveConversations: { kind: 'moveConversations', ids: ['p1'], from: 'a', target: 'b' },
      renameConversation: { kind: 'renameConversation', conversationId: 'p1', title: 'New' },
    } as const;
    for (const kind of Object.keys(bodies) as (keyof typeof bodies)[]) {
      expect(FOLDER_SITE_TABLE.aistudio.tree.refusedOps).toContain(kind);
      const outcome = await commands.run(bodies[kind] as never);
      expect(outcome).toMatchObject({ kind: 'rejected', reason: 'unsupported' });
    }
    expect(data).toEqual(before);
    expect(hooks.commit).not.toHaveBeenCalled();
  });

  it('stages the dragged stored copy without saving until the caller saves', async () => {
    const chosen = prompt('Chosen');
    const { commands, repository, hooks } = fixture({
      folders: [folder('a'), folder('b'), folder('c')],
      folderContents: {
        a: [prompt('First copy')],
        b: [chosen],
        c: [],
        [AISTUDIO_ROOT_BUCKET_ID]: [prompt('Root copy')],
      },
    });
    void commands.run({
      kind: 'placeAIStudioPrompt',
      prompt: { conversationId: 'p1', title: 'Payload', sourceFolderId: 'b' },
      target: 'c',
      untitledTitle: 'Untitled',
      at: 99,
    });
    expect(repository.data.folderContents).toEqual({
      a: [],
      b: [],
      c: [chosen],
      [AISTUDIO_ROOT_BUCKET_ID]: [],
    });
    expect(repository.saveData).not.toHaveBeenCalled();
    expect(hooks.commit).not.toHaveBeenCalled();
    await expect(commands.run({ kind: 'saveCurrentData' })).resolves.toEqual({ kind: 'saved' });
    expect(repository.saveData).toHaveBeenCalledTimes(1);
  });

  it('retains the library default-folder staging while read-only and reports the subsequent failed save', async () => {
    const { commands, repository, hooks } = fixture({ folders: [], folderContents: {} }, false);
    void commands.run({
      kind: 'ensureDefaultAIStudioFolder',
      folderId: 'default',
      name: 'First',
      at: 42,
    });
    expect(repository.data).toEqual({
      folders: [{ ...folder('default'), name: 'First', createdAt: 42, updatedAt: 42 }],
      folderContents: { default: [] },
    });
    expect(repository.saveData).not.toHaveBeenCalled();
    expect(hooks.commit).not.toHaveBeenCalled();
    await expect(commands.run({ kind: 'saveCurrentData' })).resolves.toMatchObject({
      kind: 'failed',
    });
  });

  it('commits prepared folder and prompt data in the existing single write', async () => {
    const { commands, repository, hooks } = fixture({ folders: [], folderContents: {} });
    const draft = { folders: [folder('new')], folderContents: { new: [] } };
    const beforeWrite = vi.fn(async () => {});
    await expect(
      commands.runBulk({ kind: 'commitPreparedData', data: draft, prompts: [], beforeWrite }),
    ).resolves.toEqual({ kind: 'saved' });
    expect(repository.replaceData).toHaveBeenCalledWith(draft, { gvPromptItems: [] }, beforeWrite);
    expect(repository.replaceData).toHaveBeenCalledTimes(1);
    expect(hooks.onDraftSettled).toHaveBeenCalledTimes(1);
  });

  it('does not refresh archived rows for a draft whose account session left while saving', async () => {
    const { commands, repository, hooks } = fixture({ folders: [], folderContents: {} });
    let resolve!: (saved: boolean) => void;
    repository.replaceData.mockImplementationOnce(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    const pending = commands.runBulk({ kind: 'commitPreparedData', data: repository.data });
    repository.session = new FolderDataSession('other', 'test', null, validateFolderData);
    resolve(true);
    await pending;
    expect(hooks.onDraftSettled).not.toHaveBeenCalled();
  });
});
