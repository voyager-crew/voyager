import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { SyncAccountScope } from '@/core/types/sync';
import { hashString } from '@/core/utils/hash';

import {
  createGuardDevice,
  guardEnvelope,
  guardFiles,
  guardFolders,
  guardPrompt,
  scopedGuardFile,
} from './fixtures/uploadGuardDevice';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function refusalToken(response: unknown): string {
  expect(response).toMatchObject({
    ok: false,
    error: 'upload_guard_refused',
    guardToken: expect.any(String),
  });
  if (
    !response ||
    typeof response !== 'object' ||
    !('guardToken' in response) ||
    typeof response.guardToken !== 'string'
  )
    throw new Error('Missing guard token');
  return response.guardToken;
}

describe('runtime guard confirmation binding', () => {
  it.each(['gv.sync.upload', 'gv.sync.pushPromptsMerge'])(
    'rechecks %s when a route profile now resolves to another email file',
    async (type) => {
      const scope: SyncAccountScope = { accountKey: 'route:1', accountId: 1, routeUserId: '1' };
      const d = await createGuardDevice({ scope });
      d.setLocal('prompts', 1);
      const profiles = (emailHash: string) => ({
        version: 1,
        nextId: 2,
        profiles: { 'route:1': { id: 1, createdAt: 1, updatedAt: 1, routeUserId: '1', emailHash } },
        routeAliases: { '1': 'route:1' },
        emailAliases: { [emailHash]: 'route:1' },
      });
      d.values[StorageKeys.GV_ACCOUNT_PROFILE_MAP] = profiles('first');
      for (const emailHash of ['first', 'second']) {
        const destination = { ...scope, accountKey: `email:${emailHash}` };
        d.drive.put(
          scopedGuardFile(guardFiles.folders, destination),
          guardEnvelope('folders', guardFolders(24)),
        );
        d.drive.put(scopedGuardFile(guardFiles.prompts, destination), {
          format: 'future',
          items: [guardPrompt('remote')],
        });
      }
      const token = refusalToken(await d.request(type));
      d.values[StorageKeys.GV_ACCOUNT_PROFILE_MAP] = profiles('second');
      const before = new Map(d.drive.files);
      refusalToken(await d.request(type, { force: true, guardToken: token }));
      expect(d.drive.files).toEqual(before);
    },
  );
  it('requires the refusal token even when a client supplies force', async () => {
    const d = await createGuardDevice();
    d.putCloud('folders', 24);
    const before = new Map(d.drive.files);
    refusalToken(await d.request('gv.sync.upload', { force: true }));
    expect(d.drive.files).toEqual(before);
  });

  it('allows the same refusal but rechecks a changed refused file set', async () => {
    const d = await createGuardDevice();
    d.putCloud('folders', 24);
    const token = refusalToken(await d.request());
    d.putCloud('plugins', 24);
    const before = new Map(d.drive.files);
    const next = refusalToken(
      await d.request('gv.sync.upload', { force: true, guardToken: token }),
    );
    expect(d.drive.files).toEqual(before);
    await expect(
      d.request('gv.sync.upload', { force: true, guardToken: next }),
    ).resolves.toMatchObject({ ok: true });
    expect(d.drive.payload(guardFiles.folders)).toMatchObject({ data: guardFolders(0) });
  });

  it('does not reuse account A confirmation for account B', async () => {
    const a: SyncAccountScope = { accountKey: 'email:aaa', accountId: 1, routeUserId: '0' };
    const b: SyncAccountScope = { accountKey: 'email:bbb', accountId: 2, routeUserId: '1' };
    const d = await createGuardDevice({ scope: a });
    d.values[`${StorageKeys.FOLDER_DATA}:acct:${hashString(b.accountKey)}`] = guardFolders(0);
    for (const scope of [a, b])
      d.drive.put(
        scopedGuardFile(guardFiles.folders, scope),
        guardEnvelope('folders', guardFolders(24)),
      );
    const token = refusalToken(await d.request('gv.sync.upload', { selection: 'site' }));
    const before = new Map(d.drive.files);
    refusalToken(
      await d.request('gv.sync.upload', {
        selection: 'site',
        accountScope: b,
        force: true,
        guardToken: token,
      }),
    );
    expect(d.drive.files).toEqual(before);
  });

  it('binds prompts push confirmation to its resolved account', async () => {
    const a: SyncAccountScope = { accountKey: 'email:aaa', accountId: 1, routeUserId: '0' };
    const b: SyncAccountScope = { accountKey: 'email:bbb', accountId: 2, routeUserId: '1' };
    const d = await createGuardDevice({ scope: a });
    d.setLocal('prompts', 1);
    for (const scope of [a, b])
      d.drive.put(scopedGuardFile(guardFiles.prompts, scope), { format: 'future' });
    const token = refusalToken(await d.request('gv.sync.pushPromptsMerge'));
    const before = new Map(d.drive.files);
    refusalToken(
      await d.request('gv.sync.pushPromptsMerge', {
        accountScope: b,
        force: true,
        guardToken: token,
      }),
    );
    expect(d.drive.files).toEqual(before);
    await expect(
      d.request('gv.sync.pushPromptsMerge', { force: true, guardToken: token }),
    ).resolves.toMatchObject({ ok: true });
  });
});
