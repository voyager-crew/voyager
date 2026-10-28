// @vitest-environment jsdom
/**
 * A user's AI Studio folders as the folder manager left them, before the
 * folders primitive: `fixtures/aistudioBuiltinData.json` is what that build
 * stored, uploaded and imported on aistudio.google.com (a pinned folder with a
 * subfolder, a coloured subfolder from a Drive sync, a starred prompt, one
 * filed from a `/u/1/` link and one in Uncategorized), with placeholder ids and
 * titles. The update must open it as it is, never rewrite it, upload the same
 * folder file and import that file into an empty store as the same folders.
 */
import { describe, expect, it, vi } from 'vitest';

import type { FolderData } from '@/core/types/folder';
import { AISTUDIO_ROOT_BUCKET_ID } from '@/features/folder/constants';
import {
  mergeAIStudioImport,
  readAIStudioImportFile,
} from '@/features/folder/model/aistudioImport';
import {
  GLOBAL_KEY,
  flush,
  installAIStudioFolderPage,
  local,
  mockBrowser,
  mount,
} from '@/pages/content/folder/__tests__/aistudioFolderHarness';
import { treeRoot } from '@/pages/content/folder/__tests__/aistudioTreeDriver';
import { treeDriver } from '@/pages/content/folder/floatingTree/__tests__/treeDriver';

import builtin from './fixtures/aistudioBuiltinData.json';

vi.mock('webextension-polyfill', () => ({ default: chrome }));

const STORED = builtin.stored as FolderData;

installAIStudioFolderPage();

/** The data key's writes since the page opened. */
function dataWrites(): unknown[] {
  return mockBrowser.storage.local.set.mock.calls
    .map(([values]) => (values as Record<string, unknown>)[GLOBAL_KEY])
    .filter((value) => value !== undefined);
}

async function openStored(): Promise<{ upload(): Promise<void> }> {
  local[GLOBAL_KEY] = structuredClone(STORED);
  const manager = await mount();
  await flush();
  return manager.transfer;
}

describe("an AI Studio user's folders from the folder manager", () => {
  it('open as they were, nested, filed and in Uncategorized, and are never rewritten', async () => {
    await openStored();

    // Folders in the order they were made; the cloud folder came in collapsed.
    expect(
      treeDriver({ root: treeRoot(), rootBucketId: AISTUDIO_ROOT_BUCKET_ID }).outline(),
    ).toEqual([
      'Voyager 测试',
      '  · Voyager 测试 提示 A',
      '  Voyager 测试 云',
      '  Voyager 测试 子',
      '    · Untitled',
      '· Voyager 测试 提示 C',
    ]);
    expect(local[GLOBAL_KEY]).toEqual(STORED);
    expect(dataWrites()).toEqual([]);
  });

  it('upload as the same folder file', async () => {
    const transfer = await openStored();
    mockBrowser.runtime.sendMessage.mockResolvedValue({ ok: true });

    await transfer.upload();

    const upload = mockBrowser.runtime.sendMessage.mock.calls
      .map(([message]) => message as { type: string; payload?: unknown })
      .find((message) => message.type === 'gv.sync.upload');
    // The background writes these folders, unmarked, as the Drive file `exported` is.
    expect(upload?.payload).toEqual({ folders: STORED, prompts: [], platform: 'aistudio' });
  });

  it('import from its file into an empty store as the same folders, Uncategorized left out', () => {
    const read = readAIStudioImportFile(structuredClone(builtin.exported));
    if (!read.ok) throw new Error(`refused: ${read.messageKey}`);

    expect(mergeAIStudioImport({ folders: [], folderContents: {} }, read.data).data).toEqual(
      builtin.imported,
    );
  });
});
