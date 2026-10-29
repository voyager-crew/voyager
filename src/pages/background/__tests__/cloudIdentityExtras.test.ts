import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import {
  HIGHLIGHT_EXPORT_FORMAT,
  type HighlightCreateInput,
  type HighlightExportPayloadV1,
  type HighlightRecordV1,
} from '@/core/types/highlight';
import type { SyncAccountScope } from '@/core/types/sync';
import { hashString } from '@/core/utils/hash';

import {
  createGuardDevice,
  guardFolders,
  guardForks,
  guardHierarchy,
  guardPrompt,
  GUARD_TIME,
} from './fixtures/uploadGuardDevice';

const emailHash = hashString('owner@example.com');
const emailKey = `email:${emailHash}`;
const routeScope: SyncAccountScope = { accountKey: 'route:2', accountId: 1, routeUserId: '2' };
const cloudName = (base: string, key: string) =>
  base.replace(/\.json$/, `.acct-${hashString(key)}.json`);
const highlightScope = { ...routeScope, platform: 'gemini' as const };

function profiles() {
  return {
    version: 1,
    nextId: 2,
    profiles: { 'route:2': { id: 1, createdAt: 1, updatedAt: 1, routeUserId: '2', emailHash } },
    routeAliases: { '2': 'route:2' },
    emailAliases: { [emailHash]: 'route:2' },
  };
}

function input(text: string): HighlightCreateInput {
  return {
    conversationId: 'gemini:conv:one',
    conversationUrl: 'https://gemini.google.com/u/2/app/one',
    turnId: `turn-${text}`,
    role: 'assistant',
    anchor: {
      quote: { exact: text, prefix: '', suffix: '' },
      position: { start: 0, end: text.length },
      sourceTextHash: `source-${text}`,
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(GUARD_TIME));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('cloud identity for account-scoped conversation extras', () => {
  it.each([
    'prompts-upload',
    'prompts-download',
    'highlights-upload',
    'highlights-download',
    'stars-and-forks',
    'hierarchy',
  ])('the real service refuses %s before writing for an unconfirmed account', async (operation) => {
    const d = await createGuardDevice();
    const cloud = new Map(d.drive.files);
    const local = structuredClone(d.values);
    const transfer = d.service.runExclusive(async (port): Promise<unknown> => {
      switch (operation) {
        case 'prompts-upload':
          return port.uploadPromptsOnly([guardPrompt('local')], routeScope, false);
        case 'prompts-download':
          return port.downloadPromptsOnly(routeScope, false);
        case 'highlights-upload':
          return port.uploadHighlightsOnly(
            {
              format: HIGHLIGHT_EXPORT_FORMAT,
              exportedAt: GUARD_TIME,
              version: '2.2.1',
              accountScope: { platform: 'gemini', accountHash: hashString(routeScope.accountKey) },
              items: [],
            },
            routeScope,
            false,
          );
        case 'highlights-download':
          return port.downloadHighlightsOnly(routeScope, false);
        case 'stars-and-forks':
          return port.upload(
            guardFolders(0),
            [],
            null,
            false,
            'gemini',
            guardForks(1),
            null,
            routeScope,
            null,
            null,
            null,
            d.starStore,
          );
        case 'hierarchy':
          return port.upload(
            guardFolders(0),
            [],
            null,
            false,
            'gemini',
            null,
            guardHierarchy(1),
            null,
            routeScope,
            null,
            null,
            d.starStore,
          );
      }
    });
    await expect(transfer).rejects.toMatchObject({ code: 'account_unconfirmed' });
    expect(d.drive.files).toEqual(cloud);
    expect(d.values).toEqual(local);
    await expect(d.service.getState()).resolves.toMatchObject({ isSyncing: false, error: null });
  });

  it.each([false, true])(
    'a route-first writer and email-first reader share stars and highlights without changing local buckets (Safari=%s)',
    async (safari) => {
      const writer = await createGuardDevice({ scope: routeScope, safari });
      writer.values[StorageKeys.GV_ACCOUNT_PROFILE_MAP] = profiles();
      const { highlightAnnotationService: writerAnnotations } =
        await import('@/core/services/HighlightAnnotationService');
      await writerAnnotations.add(highlightScope, input('from route-first device'));
      await writer.starStore.add({
        conversationId: 'gemini:conv:one',
        conversationUrl: 'https://gemini.google.com/u/2/app/one',
        turnId: 'saved-star',
        content: 'Shared star',
        starredAt: 1,
      });
      await expect(
        writer.request('gv.sync.upload', {
          includeHighlights: true,
          highlightAccountScope: routeScope,
        }),
      ).resolves.toMatchObject({ ok: true });
      const stars = cloudName('gemini-voyager-stars.json', emailKey);
      const highlights = cloudName('gemini-voyager-highlights.json', emailKey);
      expect(writer.drive.payload(stars)).toMatchObject({
        accountScope: { accountHash: hashString(emailKey) },
        items: [{ turnId: 'saved-star' }],
      });
      const exported = writer.drive.payload<HighlightExportPayloadV1>(highlights);
      expect(exported.accountScope.accountHash).toBe(hashString(emailKey));
      expect(exported.items.map((record) => record.accountHash)).toEqual([hashString(emailKey)]);
      expect((await writerAnnotations.getAll(highlightScope))[0].accountHash).toBe(
        hashString(routeScope.accountKey),
      );
      expect(await writerAnnotations.getAll({ ...highlightScope, accountKey: emailKey })).toEqual(
        [],
      );
      expect(
        writer.drive.files.has(cloudName('gemini-voyager-highlights.json', routeScope.accountKey)),
      ).toBe(false);

      const readerScope: SyncAccountScope = {
        accountKey: emailKey,
        accountId: 4,
        routeUserId: '5',
      };
      const reader = await createGuardDevice({ scope: readerScope, safari });
      for (const [name, body] of writer.drive.files) reader.drive.files.set(name, body);
      for (const [id, metadata] of writer.drive.metadata)
        reader.drive.metadata.set(id, structuredClone(metadata));
      await expect(
        reader.request('gv.sync.download', {
          includeHighlights: true,
          highlightAccountScope: readerScope,
        }),
      ).resolves.toMatchObject({
        ok: true,
        data: { stars: { items: [{ turnId: 'saved-star', content: 'Shared star' }] } },
        highlights: { synced: true, count: 1 },
      });
      const { highlightAnnotationService: readerAnnotations } =
        await import('@/core/services/HighlightAnnotationService');
      const restored = await readerAnnotations.getAll({ ...readerScope, platform: 'gemini' });
      expect(restored.map((record) => record.anchor.quote.exact)).toEqual([
        'from route-first device',
      ]);
      expect(restored[0].accountHash).toBe(hashString(emailKey));
    },
  );

  it('merges a bound route highlight source after filtering foreign account URLs', async () => {
    const d = await createGuardDevice({ scope: routeScope });
    d.values[StorageKeys.GV_ACCOUNT_PROFILE_MAP] = profiles();
    const record = (id: string, accountKey: string, route: string): HighlightRecordV1 => ({
      id,
      schemaVersion: 1,
      platform: 'gemini',
      accountHash: hashString(accountKey),
      conversationId: `gemini:conv:${id}`,
      conversationUrl: `https://gemini.google.com/u/${route}/app/${id}`,
      turnId: `turn-${id}`,
      role: 'assistant',
      anchor: input(id).anchor,
      color: 'yellow',
      createdAt: 1,
      updatedAt: 1,
      revision: { counter: 1, deviceId: 'legacy-device' },
    });
    const payload = (accountKey: string, items: HighlightRecordV1[]): HighlightExportPayloadV1 => ({
      format: HIGHLIGHT_EXPORT_FORMAT,
      exportedAt: GUARD_TIME,
      version: '2.2.1',
      accountScope: { platform: 'gemini', accountHash: hashString(accountKey) },
      items,
    });
    const legacy = cloudName('gemini-voyager-highlights.json', routeScope.accountKey);
    d.drive.put(
      legacy,
      payload(routeScope.accountKey, [
        record('legacy-ours', routeScope.accountKey, '2'),
        record('foreign', routeScope.accountKey, '7'),
      ]),
    );
    d.drive.put(
      cloudName('gemini-voyager-highlights.json', emailKey),
      payload(emailKey, [record('current', emailKey, '2')]),
    );
    const cloud = new Map(d.drive.files);
    await expect(
      d.request('gv.sync.download', { includeHighlights: true, highlightAccountScope: routeScope }),
    ).resolves.toMatchObject({ ok: true, highlights: { synced: true, count: 2 } });
    const { highlightAnnotationService: annotations } =
      await import('@/core/services/HighlightAnnotationService');
    expect((await annotations.getAll(highlightScope)).map((item) => item.id).sort()).toEqual([
      'current',
      'legacy-ours',
    ]);
    expect(d.drive.files).toEqual(cloud);
    expect(d.drive.writes).toEqual([]);
  });
});
