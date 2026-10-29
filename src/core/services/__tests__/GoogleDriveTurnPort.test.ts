import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { PromptExportPayload } from '@/core/types/sync';

import { GoogleDriveSyncService } from '../GoogleDriveSyncService';
import type { GoogleDriveSyncTransfer } from '../GoogleDriveSyncTransfer';
import type { HighlightDrivePort } from '../HighlightDriveSyncCoordinator';
import { FakeSyncDrive, createSyncStorage } from './fixtures/fakeSyncDrive';
import { createHighlightPayload } from './fixtures/googleDriveServiceFixture';

const runtime = vi.hoisted(() => ({ target: 'chrome' }));
vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => runtime.target,
  isSafari: () => false,
  isBrave: () => false,
}));

const promptsFile = 'gemini-voyager-prompts.json';
const scope = { accountKey: 'email:cache-person', accountId: 1, routeUserId: '1' };
const prompt = (id: string) => ({ id, text: id, tags: [], createdAt: 1 });

function device() {
  const local = createSyncStorage();
  const sync = createSyncStorage();
  vi.stubGlobal('chrome', {
    runtime: { lastError: null, getURL: (path: string) => `chrome-extension://turn-port/${path}` },
    identity: {
      getAuthToken: (_options: unknown, callback: (token: string) => void) =>
        callback('test-token'),
      removeCachedAuthToken: (_options: unknown, callback: () => void) => callback(),
    },
    storage: { local: local.area, sync: sync.area },
  });
  const drive = new FakeSyncDrive();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === 'accounts.google.com') return new Response('');
    return drive.fetch(input, init);
  });
  return { drive, service: new GoogleDriveSyncService() };
}

beforeEach(() => {
  runtime.target = 'chrome';
});
afterEach(() => {
  runtime.target = 'chrome';
  vi.unstubAllGlobals();
});

describe('sync turn port and shared Drive cache', () => {
  it('exposes an unqueued turn port whose type excludes the queued service', async () => {
    expectTypeOf<GoogleDriveSyncService>().not.toExtend<GoogleDriveSyncTransfer>();
    expectTypeOf<GoogleDriveSyncService>().not.toExtend<HighlightDrivePort>();
    const d = device();

    await d.service.runExclusive(async (port) => {
      expect(port.kind).toBe('sync-turn');
      expect('runExclusive' in port).toBe(false);
      await expect(port.uploadPromptsOnly([prompt('turn-owned')])).resolves.toBe(true);
    });

    expect(d.drive.payload<PromptExportPayload>(promptsFile).items).toEqual([prompt('turn-owned')]);
  });

  it('keeps prompts and highlights independent across queue turns', async () => {
    const d = device();
    const highlights = createHighlightPayload(scope);
    await d.service.runExclusive((port) => port.uploadPromptsOnly([prompt('first')]));

    await expect(
      d.service.runExclusive((port) => port.downloadPromptsOnly()),
    ).resolves.toMatchObject({ kind: 'found', value: { items: [prompt('first')] } });
    await expect(
      d.service.runExclusive((port) => port.uploadHighlightsOnly(highlights, scope)),
    ).resolves.toBe(true);
    await expect(
      d.service.runExclusive((port) => port.downloadHighlightsOnly(scope)),
    ).resolves.toEqual(highlights);
    await expect(
      d.service.runExclusive((port) => port.uploadPromptsOnly([prompt('latest')])),
    ).resolves.toBe(true);

    expect(d.drive.payload<PromptExportPayload>(promptsFile).items).toEqual([prompt('latest')]);
    expect(
      [...d.drive.files.keys()].filter((name) => name.startsWith('gemini-voyager-highlights.')),
    ).toHaveLength(1);
  });

  it.each(['sign-out', 'provider switch'] as const)(
    'rediscovers the folder after %s resets the shared cache',
    async (ending) => {
      const d = device();
      await d.service.runExclusive((port) => port.uploadPromptsOnly([prompt('before')]));

      if (ending === 'sign-out') {
        await d.service.signOut();
      } else {
        // Provider configuration is Safari-only; transfers stay on the JS Drive transport.
        runtime.target = 'safari';
        await d.service.setProvider('icloud');
        await d.service.setProvider('googleDrive');
        runtime.target = 'chrome';
      }
      await expect(
        d.service.runExclusive((port) => port.uploadPromptsOnly([prompt('after')])),
      ).resolves.toBe(true);
      await expect(
        d.service.runExclusive((port) => port.downloadPromptsOnly()),
      ).resolves.toMatchObject({ kind: 'found', value: { items: [prompt('after')] } });

      expect(d.drive.payload<PromptExportPayload>(promptsFile).items).toEqual([prompt('after')]);
    },
  );
});
