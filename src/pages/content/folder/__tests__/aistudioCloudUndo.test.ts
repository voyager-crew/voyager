/**
 * AI Studio's cloud result toast offers Undo for the download that just ran,
 * as Gemini's does, and Undo puts the folders back.
 */
import { describe, expect, it, vi } from 'vitest';

import en from '@/locales/en/messages.json';
import { toastDriver } from '@/tests/toastDriver';

import {
  GLOBAL_KEY,
  folderData,
  local,
  mockBrowser,
  mount,
  panelText,
  installAIStudioFolderPage,
} from './aistudioFolderHarness';

vi.mock('webextension-polyfill', () => ({ default: chrome }));

installAIStudioFolderPage({ syncStorage: true });

// The page reads English messages here.
const MERGED = en.downloadMergeSuccess.message;
const UNDO = en.syncUndo.message;
const names = (value: unknown) =>
  (value as ReturnType<typeof folderData>).folders.map(({ name }) => name);

describe('AI Studio cloud Undo', () => {
  it('offers Undo after a download, and Undo brings the folders back', async () => {
    local[GLOBAL_KEY] = folderData('Mine');
    local.gvPromptItems = [];
    const manager = await mount();
    mockBrowser.runtime.sendMessage.mockImplementation(async ({ type }: { type: string }) =>
      type === 'gv.sync.download'
        ? { ok: true, operationId: 'op', data: { folders: { data: folderData('Cloud') } } }
        : { ok: true },
    );

    await manager.transfer.sync();
    await vi.advanceTimersByTimeAsync(0);
    const toast = toastDriver.find(MERGED)!;
    expect(toastDriver.labels(toast)).toContain(UNDO);
    expect(names(local[GLOBAL_KEY])).toEqual(['Mine', 'Cloud']);

    toastDriver.press(toast, UNDO);
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(0);
      expect(toastDriver.find(en.syncUndoDone.message)).toBeDefined();
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(names(local[GLOBAL_KEY])).toEqual(['Mine']);
    // The panel redraws from the restored storage on its own turn.
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(0);
      expect(panelText()).not.toContain('Cloud');
    });
  });

  it('keeps Undo past its ten seconds while the pointer is on it', async () => {
    local[GLOBAL_KEY] = folderData('Mine');
    local.gvPromptItems = [];
    const manager = await mount();
    mockBrowser.runtime.sendMessage.mockImplementation(async ({ type }: { type: string }) =>
      type === 'gv.sync.download'
        ? { ok: true, operationId: 'op', data: { folders: { data: folderData('Cloud') } } }
        : { ok: true },
    );
    await manager.transfer.sync();
    const toast = toastDriver.find(MERGED)!;

    toastDriver.hover(toast);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(toastDriver.find(MERGED)).toBeDefined();
    toastDriver.leave(toast);
    await vi.advanceTimersByTimeAsync(10_001);
    expect(toastDriver.find(MERGED)).toBeUndefined();
  });
});
