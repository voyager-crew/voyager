import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import {
  HIGHLIGHT_EXPORT_FORMAT,
  type HighlightExportPayloadV1,
  type HighlightRecordV1,
} from '@/core/types/highlight';
import type { SyncAccountScope } from '@/core/types/sync';
import { hashString } from '@/core/utils/hash';
import {
  createGuardDevice,
  guardEnvelope,
  guardFolders,
  guardPrompt,
  GUARD_TIME,
  scopedGuardFile,
} from '@/pages/background/__tests__/fixtures/uploadGuardDevice';

const scope = { accountKey: 'email:history-person', accountId: 1, routeUserId: '2' };
const accountHash = hashString(scope.accountKey);
const source = `gemini-voyager-highlights.acct-${accountHash}.json`;

function record(id: string): HighlightRecordV1 {
  return {
    id,
    schemaVersion: 1,
    platform: 'gemini',
    accountHash,
    conversationId: `gemini:conv:${id}`,
    conversationUrl: `https://gemini.google.com/u/2/app/${id}`,
    turnId: 'turn',
    role: 'assistant',
    anchor: {
      quote: { exact: id, prefix: '', suffix: '' },
      position: { start: 0, end: id.length },
      sourceTextHash: `source-${id}`,
    },
    color: 'yellow',
    createdAt: 1,
    updatedAt: 1,
    revision: { counter: 1, deviceId: 'history-device' },
  };
}

function payload(items: HighlightRecordV1[]): HighlightExportPayloadV1 {
  return {
    format: HIGHLIGHT_EXPORT_FORMAT,
    exportedAt: GUARD_TIME,
    version: '2.2.1',
    accountScope: { platform: 'gemini', accountHash },
    items,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(GUARD_TIME));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function seedPromptHistory(d: Awaited<ReturnType<typeof createGuardDevice>>, name: string) {
  d.drive.put(name, guardEnvelope('prompts', [guardPrompt('current')]));
  const history = name.replace(/\.json$/, '.backup-2026-10-29-110000.json');
  d.drive.put(history, guardEnvelope('prompts', [guardPrompt('older')]));
  d.drive.metadata.set(history, {
    ...d.drive.metadata.get(history)!,
    appProperties: { voyagerHistorySource: name },
  });
}

function bindRouteIdentity(d: Awaited<ReturnType<typeof createGuardDevice>>) {
  d.values[StorageKeys.GV_ACCOUNT_PROFILE_MAP] = {
    version: 1,
    nextId: 2,
    profiles: {
      'route:2': {
        id: 1,
        createdAt: 1,
        updatedAt: 1,
        routeUserId: '2',
        emailHash: 'history-person',
      },
    },
    routeAliases: { '2': 'route:2' },
    emailAliases: { 'history-person': 'route:2' },
  };
}

describe('history restore service target authority', () => {
  it.each(['base', 'another-email', 'bound-legacy-route'] as const)(
    'refuses a %s target instead of restoring outside the confirmed email file',
    async (target) => {
      const localScope =
        target === 'bound-legacy-route' ? { ...scope, accountKey: 'route:2' } : scope;
      const d = await createGuardDevice({ scope: localScope });
      bindRouteIdentity(d);
      const base = 'gemini-voyager-prompts.json';
      const name =
        target === 'base'
          ? base
          : scopedGuardFile(base, {
              ...scope,
              accountKey: target === 'another-email' ? 'email:other-person' : 'route:2',
            });
      seedPromptHistory(d, name);
      const cloud = new Map(d.drive.files);
      const metadata = structuredClone(d.drive.metadata);
      const local = structuredClone(d.values);

      await expect(
        d.service.runExclusive((turn) =>
          turn.restorePreviousVersion([{ name, accountScope: localScope }], false),
        ),
      ).rejects.toThrow('account_unconfirmed');
      expect(d.drive.files).toEqual(cloud);
      expect(d.drive.metadata).toEqual(metadata);
      expect(d.drive.writes).toEqual([]);
      expect(d.values).toEqual(local);
    },
  );

  it('restores the canonical email target together with the global files used by uploads', async () => {
    const localScope: SyncAccountScope = { ...scope, accountKey: 'route:2' };
    const d = await createGuardDevice({ scope: localScope });
    bindRouteIdentity(d);
    const promptName = scopedGuardFile('gemini-voyager-prompts.json', scope);
    seedPromptHistory(d, promptName);
    const globals = [
      {
        name: 'gemini-voyager-settings.json',
        old: { format: 'gemini-voyager.settings.v1', data: { language: 'en' } },
        current: { format: 'gemini-voyager.settings.v1', data: { language: 'fr' } },
      },
      {
        name: 'gemini-voyager-plugins.json',
        old: guardEnvelope('plugins', { plugin: { enabled: false, installedAt: 1 } }),
        current: guardEnvelope('plugins', { plugin: { enabled: true, installedAt: 1 } }),
      },
      {
        name: 'gemini-voyager-chatgpt-folders.json',
        old: { ...guardEnvelope('folders', guardFolders(1)), platform: 'chatgpt' },
        current: { ...guardEnvelope('folders', guardFolders(2)), platform: 'chatgpt' },
      },
    ];
    for (const { name, old, current } of globals) {
      d.drive.put(name, current);
      const history = name.replace(/\.json$/, '.backup-2026-10-29-110000.json');
      d.drive.put(history, old);
      d.drive.metadata.set(history, {
        ...d.drive.metadata.get(history)!,
        appProperties: { voyagerHistorySource: name },
      });
    }
    const local = structuredClone(d.values);
    const names = [promptName, ...globals.map(({ name }) => name)];

    await expect(
      d.service.runExclusive((turn) =>
        turn.restorePreviousVersion(
          names.map((name) => ({ name, accountScope: name === promptName ? localScope : null })),
          false,
        ),
      ),
    ).resolves.toMatchObject(names.map((name) => ({ name, status: 'restored' })));
    expect(d.drive.payload(promptName)).toMatchObject({ items: [guardPrompt('older')] });
    for (const { name, old } of globals) expect(d.drive.payload(name)).toEqual(old);
    expect(d.values).toEqual(local);
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('highlight history restore scope', () => {
  it.each(['account', 'platform'] as const)(
    'skips a newest history containing an item from another %s and restores the older valid one',
    async (mismatch) => {
      const d = await createGuardDevice({ scope });
      d.drive.put(source, payload([record('current')]));
      const older = source.replace(/\.json$/, '.backup-2026-10-29-110000.json');
      d.drive.put(older, payload([record('older-valid')]));
      d.drive.metadata.set(older, {
        ...d.drive.metadata.get(older)!,
        createdTime: '2026-10-29T11:00:00.000Z',
        appProperties: { voyagerHistorySource: source },
      });
      const invalid = record('wrong-scope');
      if (mismatch === 'account') invalid.accountHash = hashString('another-account');
      else {
        invalid.platform = 'aistudio';
        invalid.conversationId = 'aistudio:prompt:wrong-scope';
        invalid.conversationUrl = 'https://aistudio.google.com/prompts/wrong-scope';
      }
      const newest = source.replace(/\.json$/, '.backup-2026-10-29-120000.json');
      d.drive.put(newest, payload([invalid]));
      d.drive.metadata.set(newest, {
        ...d.drive.metadata.get(newest)!,
        createdTime: GUARD_TIME,
        appProperties: { voyagerHistorySource: source },
      });
      const invalidBytes = d.drive.files.get(newest);
      const local = structuredClone(d.values);

      await expect(
        d.request('gv.sync.restorePreviousVersion', { files: [source] }),
      ).resolves.toMatchObject({
        ok: true,
        files: [{ name: source, status: 'restored', historyId: older }],
      });
      expect(d.drive.payload(source)).toEqual(payload([record('older-valid')]));
      expect(d.drive.files.get(newest)).toBe(invalidBytes);
      expect(d.drive.trashed.has(newest)).toBe(false);
      expect(d.values).toEqual(local);
    },
  );
});
