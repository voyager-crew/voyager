import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { baseState } from './cloudSyncChromeMock';
import { cloudFolders, localFolders, setupFlowHarness } from './cloudSyncFlowHarness';

vi.mock(
  '@/contexts/LanguageContext',
  async () => (await import('./cloudSyncFlowLanguage')).languageMock,
);
vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'chrome',
  isSafari: () => false,
}));

describe('popup sync reasons', () => {
  const h = setupFlowHarness();

  it('names an account it cannot confirm, without the raw code', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await h.mount((message) =>
      message.type === 'gv.sync.upload' ? { ok: false, error: 'account_unconfirmed' } : undefined,
    );
    await h.click('syncUpload');
    await h.settled();

    expect(h.status()).toContain('syncUploadFailed');
    expect(h.status()).toContain('syncReasonAccountUnconfirmed');
    expect(h.status()).not.toContain('account_unconfirmed');
  });

  it('names each row turned off in what syncs', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await h.mount((message) =>
      message.type === 'gv.sync.download'
        ? {
            ok: false,
            error: 'sync_scope_excluded',
            excludedRows: [{ kind: 'site', siteId: 'gemini' }, { kind: 'shared' }],
          }
        : undefined,
    );
    await h.click('syncMerge');
    await h.settled();

    expect(h.status()).toContain('syncDownloadFailed');
    expect(h.status()).toContain('Gemini excluded');
    expect(h.status()).toContain('syncReasonSharedExcluded');
    expect(h.status()).not.toContain('sync_scope_excluded');
  });

  it('lists what a partial restore landed, keeping an owner’s raw error out', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await h.mount(
      (message) =>
        message.type === 'gv.sync.download'
          ? {
              ok: true,
              operationId: 'op',
              catalog: null,
              data: {
                folders: { data: cloudFolders },
                starred: { format: 'gemini-voyager.starred.v1', data: { messages: {} } },
              },
            }
          : undefined,
      { local: { [StorageKeys.FOLDER_DATA]: localFolders } },
    );
    const set = vi.mocked(h.chrome.storage.local.set).getMockImplementation() as (
      items: Record<string, unknown>,
    ) => Promise<void>;
    vi.mocked(h.chrome.storage.local.set).mockImplementation(async (items) => {
      if (StorageKeys.TIMELINE_STARRED_MESSAGES in items) throw new Error('stars write failed');
      await set(items);
    });
    await h.click('syncMerge');
    await h.settled();

    expect(h.status()).toContain('Restored: folder_title');
    expect(h.status()).toContain('Not restored: savedLibraryStars');
    expect(h.status()).not.toContain('stars write failed');
  });

  it.each([
    ['raw text', 'Request failed with status 503', 'syncLastFailed'],
    ['a known code', 'not_authenticated', 'syncError: syncReasonSignIn'],
  ])(
    'shows a previous sync error of %s as its reason, never the raw text',
    async (_, error, shown) => {
      await h.mount(() => undefined, undefined, { ...baseState, error });
      await vi.waitFor(() => expect(h.container.textContent).toContain(shown));
      expect(h.container.textContent).not.toContain(error);
    },
  );
});
