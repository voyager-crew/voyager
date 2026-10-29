import { act } from 'react';

import { describe, expect, it, vi } from 'vitest';

import { accountIsolationService } from '@/core/services/AccountIsolationService';
import { StorageKeys } from '@/core/types/common';
import type { SyncAccountScope } from '@/core/types/sync';
import type { UploadGuardRefusedFile } from '@/core/types/syncUploadGuard';
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

const shrinking: UploadGuardRefusedFile = {
  kind: 'folders',
  localCount: 0,
  cloudCount: 24,
  reason: 'empty_local',
};
const unreadable: UploadGuardRefusedFile = {
  kind: 'plugins',
  localCount: 2,
  cloudCount: null,
  reason: 'unrecognized',
};
const refusal = (refusedFiles: UploadGuardRefusedFile[]) => ({
  ok: false,
  error: 'upload_guard_refused',
  refusedFiles,
  guardToken: 'guard-1',
});
const accountA: SyncAccountScope = { accountKey: 'a', accountId: 1, routeUserId: '0' };
const accountB: SyncAccountScope = { accountKey: 'b', accountId: 2, routeUserId: '1' };

describe('popup upload guard', () => {
  const h = setupFlowHarness();

  /** The tab's account, which the test can switch while the confirm is open. */
  function signedIn(initial: SyncAccountScope) {
    const account = { current: initial };
    vi.spyOn(accountIsolationService, 'isIsolationEnabled').mockResolvedValue(true);
    vi.spyOn(accountIsolationService, 'resolveAccountScope').mockImplementation(async () => ({
      ...account.current,
      emailHash: null,
    }));
    vi.mocked(h.chrome.tabs.sendMessage).mockImplementation((async (
      _tab: number,
      message: { type: string },
    ) =>
      message.type === 'gv.account.getContext'
        ? { ok: true, context: { routeUserId: account.current.routeUserId, email: 'me@x.com' } }
        : { ok: true, data: localFolders, accountScope: account.current }) as never);
    return account;
  }

  async function refuse(refusedFiles: UploadGuardRefusedFile[]) {
    await h.mount((message) =>
      message.type === 'gv.sync.upload'
        ? (message.payload as { force?: boolean }).force
          ? { ok: true }
          : refusal(refusedFiles)
        : undefined,
    );
  }

  it('lists each refused kind and sends nothing more on Cancel', async () => {
    await refuse([shrinking, unreadable]);
    await h.click('syncUpload');
    await vi.waitFor(() => expect(confirmDriver.isOpen()).toBe(true));

    expect(confirmDriver.message()).toBe('syncGuardMessage');
    expect(confirmDriver.details()).toEqual([
      'folder_title (Gemini): 24 → 0',
      'pluginsTitle: unrecognized',
    ]);
    // Enter right after it opens changes nothing; the safe answer is the primary.
    expect(confirmDriver.focusedLabel()).toBe('pm_cancel');
    expect(confirmDriver.emphasis('syncGuardMerge')).toBe('primary');
    expect(confirmDriver.emphasis('syncGuardForce')).toBe('danger');

    await act(async () => confirmDriver.answer('pm_cancel'));
    await h.settled();
    expect(h.payloads('gv.sync.upload')).toHaveLength(1);
    expect(h.status()).toBe('');
  });

  it('resends the refused upload with force and the same account scopes on Upload anyway', async () => {
    await refuse([shrinking]);
    signedIn(accountA);
    await h.click('syncUpload');
    await vi.waitFor(() => expect(confirmDriver.isOpen()).toBe(true));
    await act(async () => confirmDriver.answer('syncGuardForce'));
    await h.settled();

    const [first, second] = h.payloads('gv.sync.upload') as Record<string, unknown>[];
    expect(first).toMatchObject({
      accountScope: accountA,
      timelineHierarchyAccountScope: accountA,
      highlightAccountScope: accountA,
    });
    expect(second).toEqual({ ...first, force: true, guardToken: 'guard-1' });
    expect(h.status()).toContain('syncSuccess');
  });

  it('asks again when the retry brings a new refusal instead of reporting an error', async () => {
    let refusals = 0;
    await h.mount((message) => {
      if (message.type !== 'gv.sync.upload') return undefined;
      const { guardToken } = message.payload as { guardToken?: string };
      // The first token no longer matches (the files changed); the second one does.
      if (guardToken === 'guard-2') return { ok: true };
      refusals += 1;
      return { ...refusal([shrinking]), guardToken: `guard-${refusals}` };
    });
    await h.click('syncUpload');
    for (const round of [1, 2]) {
      await vi.waitFor(() => expect(confirmDriver.isOpen()).toBe(true));
      await act(async () => confirmDriver.answer('syncGuardForce'));
      if (round === 1) await vi.waitFor(() => expect(h.payloads('gv.sync.upload')).toHaveLength(2));
    }
    await h.settled();

    expect(
      h
        .payloads('gv.sync.upload')
        .map((payload) => (payload as { guardToken?: string }).guardToken),
    ).toEqual([undefined, 'guard-1', 'guard-2']);
    expect(h.status()).toContain('syncSuccess');
    expect(h.status()).not.toContain('syncUploadFailed');
  });

  it('refuses the retry when the tab switched accounts while the confirm was open', async () => {
    await refuse([shrinking]);
    const account = signedIn(accountA);
    await h.click('syncUpload');
    await vi.waitFor(() => expect(confirmDriver.isOpen()).toBe(true));
    account.current = accountB;
    await act(async () => confirmDriver.answer('syncGuardForce'));
    await h.settled();

    expect(h.payloads('gv.sync.upload')).toHaveLength(1);
    expect(h.status()).toContain('syncReasonAccountChanged');
  });

  it('runs a merge download instead, which offers Undo, when asked to merge', async () => {
    await h.mount(
      (message) =>
        message.type === 'gv.sync.upload'
          ? refusal([shrinking])
          : message.type === 'gv.sync.download'
            ? {
                ok: true,
                operationId: 'op',
                catalog: null,
                data: { folders: { data: cloudFolders } },
              }
            : undefined,
      { local: { [StorageKeys.FOLDER_DATA]: localFolders } },
    );
    vi.mocked(h.chrome.tabs.sendMessage).mockResolvedValue({
      ok: true,
      data: localFolders,
    } as never);
    await h.click('syncUpload');
    await vi.waitFor(() => expect(confirmDriver.isOpen()).toBe(true));
    await act(async () => confirmDriver.answer('syncGuardMerge'));
    await vi.waitFor(() => expect(h.button('syncUndo')).toBeDefined(), { timeout: 5000 });

    expect(h.payloads('gv.sync.upload')).toHaveLength(1);
    expect(h.payloads('gv.sync.download')).toHaveLength(1);
    const stored = await h.chrome.storage.local.get(StorageKeys.FOLDER_DATA);
    // A merge keeps the local folder beside the cloud one; it never overwrites.
    expect(
      (stored[StorageKeys.FOLDER_DATA] as typeof localFolders).folders.map(({ id }) => id),
    ).toEqual(['local', 'cloud']);
  });

  it('offers no merge when only an unreadable cloud file was refused', async () => {
    await refuse([unreadable]);
    await h.click('syncUpload');
    await vi.waitFor(() => expect(confirmDriver.isOpen()).toBe(true));
    expect(confirmDriver.labels()).toEqual(['pm_cancel', 'syncGuardForce']);
    await act(async () => confirmDriver.answer('pm_cancel'));
    await h.settled();
  });
});
