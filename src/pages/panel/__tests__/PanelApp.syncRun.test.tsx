import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { click, extensionApi, local } from './panelHarness';
import {
  FOLDER_FILES,
  FOLDER_KEYS,
  PROMPTS_FILE,
  conversationIds,
  folderEnvelope,
  folders,
  openSheet,
  primary,
  prompt,
  rowStatus,
  startSyncBackground,
  toastText,
  toastUndo,
  until,
} from './panelSyncHarness';

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./panelBrowserApi')).extensionApi,
}));

const SCOPE = StorageKeys.CLOUD_SYNC_SCOPE;
const promptIds = () =>
  (local[StorageKeys.PROMPT_ITEMS] as { id: string }[]).map((item) => item.id).sort();

/** Synced once; then another device added a prompt, a Claude chat and a ChatGPT chat. */
async function cloudNewerOnThreeRows() {
  const bg = await startSyncBackground();
  local[SCOPE] = { shared: true, sites: { aistudio: false } };
  local[FOLDER_KEYS.gemini] = folders('gemini', 'G', ['g1']);
  local[FOLDER_KEYS.claude] = folders('claude', 'C', ['c1']);
  local[FOLDER_KEYS.chatgpt] = folders('chatgpt', 'X', ['x1']);
  await bg.fromPopup('gv.sync.upload');
  await bg.fromPopup('gv.sync.upload', { platform: 'claude', selection: 'site' });
  await bg.fromPopup('gv.sync.upload', { platform: 'chatgpt', selection: 'site' });
  bg.drive.put(PROMPTS_FILE, {
    format: 'gemini-voyager.prompts.v1',
    exportedAt: '2026-10-29T00:00:00.000Z',
    items: [prompt('local'), prompt('other')],
  });
  bg.drive.put(FOLDER_FILES.claude, folderEnvelope('claude', folders('claude', 'C', ['c1', 'c2'])));
  bg.drive.put(
    FOLDER_FILES.chatgpt,
    folderEnvelope('chatgpt', folders('chatgpt', 'X', ['x1', 'x2'])),
  );
  await openSheet();
  for (const row of ['shared', 'claude', 'chatgpt']) expect(rowStatus(row)).toBe('Newer in cloud');
  return bg;
}

describe('a run that downloads several rows', () => {
  it('is undone in one click: 通用, Claude and ChatGPT all go back', async () => {
    await cloudNewerOnThreeRows();
    await click(primary());
    await until(() => toastText().includes('Synced 3'));
    expect(promptIds()).toEqual(['local', 'other']);
    expect(conversationIds(local[FOLDER_KEYS.claude])).toEqual(['c1', 'c2']);
    expect(conversationIds(local[FOLDER_KEYS.chatgpt])).toEqual(['x1', 'x2']);

    await click(toastUndo());
    await until(() => toastText().includes('Sync undone'));

    expect(promptIds()).toEqual(['local']);
    expect(conversationIds(local[FOLDER_KEYS.claude])).toEqual(['c1']);
    expect(conversationIds(local[FOLDER_KEYS.chatgpt])).toEqual(['x1']);
  });

  it('stops when a popup download supersedes it: the next row writes nothing', async () => {
    const bg = await cloudNewerOnThreeRows();
    const background = extensionApi.runtime.sendMessage.getMockImplementation();
    let interrupted = false;
    // The popup downloads right after the run's first row completes, before the next row starts.
    extensionApi.runtime.sendMessage.mockImplementation(async (message: { type?: string }) => {
      const reply = await background?.(message);
      if (message?.type === 'gv.sync.completeDownload' && !interrupted) {
        interrupted = true;
        await bg.fromPopup('gv.sync.download', { selection: 'site' });
      }
      return reply;
    });
    await click(primary());
    await until(() => toastText().includes('Another sync started on this device'));

    const downloads = bg.calls.filter((call) => call.type === 'download').map((call) => call.row);
    expect(downloads).toHaveLength(2);
    const [finished, refused] = downloads;
    expect(bg.transfers()).toEqual([
      `download ${finished}`,
      'complete',
      `upload ${finished}`,
      `download ${refused}`,
    ]);
    // The refused row and those after it keep this device's data; the finished row keeps its merge.
    const merged = { shared: ['local', 'other'], claude: ['c1', 'c2'], chatgpt: ['x1', 'x2'] };
    const kept = { shared: ['local'], claude: ['c1'], chatgpt: ['x1'] };
    const now = {
      shared: promptIds(),
      claude: conversationIds(local[FOLDER_KEYS.claude]),
      chatgpt: conversationIds(local[FOLDER_KEYS.chatgpt]),
    };
    for (const row of ['shared', 'claude', 'chatgpt'] as const)
      expect(now[row]).toEqual(row === finished ? merged[row] : kept[row]);
    // The popup's download owns the undo slot now, so this run offers no Undo.
    expect(toastUndo()).toBeNull();
  });
});

describe('a catalog site with nothing here and nothing in the cloud', () => {
  it('needs no sync, so the sheet reaches Up to date', async () => {
    const bg = await startSyncBackground();
    local[FOLDER_KEYS.gemini] = folders('gemini', 'G', ['g1']);
    await bg.fromPopup('gv.sync.upload');
    await openSheet('claude');

    expect(rowStatus('claude')).toBe('Synced');
    expect(rowStatus('chatgpt')).toBe('Synced');
    expect(primary()?.textContent).toBe('Up to date');
  });
});
