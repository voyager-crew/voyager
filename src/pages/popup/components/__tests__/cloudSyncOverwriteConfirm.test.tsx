import { act } from 'react';

import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { confirmDriver } from '@/tests/confirmDriver';

import { cloudFolders, localFolders, setupFlowHarness } from './cloudSyncFlowHarness';

vi.mock(
  '@/contexts/LanguageContext',
  async () => (await import('./cloudSyncFlowLanguage')).languageMock,
);
vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'chrome',
  isSafari: () => false,
}));

const localPrompts = [{ id: 'mine', text: 'Keep me', tags: [], createdAt: 1 }];
const localHierarchy = { conversations: { mine: { level: 1 } } };

describe('popup overwrite confirmation', () => {
  const h = setupFlowHarness();

  it.each(['Cancel', 'Escape'] as const)(
    'downloads nothing and stays idle on %s, with Cancel focused',
    async (answer) => {
      await h.mount(() => undefined);
      await h.click('syncOverwrite');
      await vi.waitFor(() => expect(confirmDriver.isOpen()).toBe(true));

      expect(confirmDriver.message()).toBe('syncOverwriteConfirm');
      expect(confirmDriver.focusedLabel()).toBe('pm_cancel');
      expect(h.button('syncOverwrite')?.disabled).toBe(false);

      await act(async () =>
        answer === 'Cancel' ? confirmDriver.answer('pm_cancel') : confirmDriver.pressEscape(),
      );
      await act(async () => {});
      expect(h.payloads('gv.sync.download')).toEqual([]);
      expect(h.button('syncOverwrite')?.disabled).toBe(false);
      expect(h.status()).toBe('');
    },
  );

  it('keeps kinds the cloud lacks or cannot be read byte-identical, and lists them', async () => {
    await h.mount(
      (message) =>
        message.type === 'gv.sync.download'
          ? {
              ok: true,
              operationId: 'op',
              catalog: null,
              data: { folders: { data: cloudFolders }, timelineHierarchy: { unknown: true } },
              kindStatus: {
                folders: 'found',
                prompts: 'missing',
                timelineHierarchy: 'unrecognized',
              },
            }
          : undefined,
      {
        local: {
          [StorageKeys.FOLDER_DATA]: localFolders,
          [StorageKeys.PROMPT_ITEMS]: localPrompts,
          [StorageKeys.TIMELINE_HIERARCHY]: localHierarchy,
        },
      },
    );
    vi.mocked(h.chrome.tabs.sendMessage).mockResolvedValue({
      ok: true,
      data: localFolders,
    } as never);
    await h.click('syncOverwrite');
    await vi.waitFor(() => expect(confirmDriver.isOpen()).toBe(true));
    await act(async () => confirmDriver.answer('syncOverwrite'));
    await h.settled();

    const stored = await h.chrome.storage.local.get(null);
    expect(stored[StorageKeys.FOLDER_DATA]).toEqual(cloudFolders);
    expect(stored[StorageKeys.PROMPT_ITEMS]).toEqual(localPrompts);
    expect(stored[StorageKeys.TIMELINE_HIERARCHY]).toEqual(localHierarchy);
    expect(h.status()).toContain('syncSuccess');
    expect(h.status()).toContain('missing: promptDataMigration');
    expect(h.status()).toContain('unrecognized: syncKindTimelineLevels');
  });
});
