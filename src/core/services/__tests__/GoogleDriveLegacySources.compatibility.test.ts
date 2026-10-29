import { execFileSync } from 'node:child_process';
import { Script } from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError, ErrorCode } from '@/core/errors/AppError';
import { StorageKeys } from '@/core/types/common';
import type { SyncAccountScope } from '@/core/types/sync';
import { hashString } from '@/core/utils/hash';

import { GoogleDriveSyncService } from '../GoogleDriveSyncService';
import { FakeSyncDrive, createSyncStorage } from './fixtures/fakeSyncDrive';

vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'chrome',
  isSafari: () => false,
  isBrave: () => false,
}));

const scope: SyncAccountScope = { accountKey: 'email:owner', accountId: 1, routeUserId: '1' };
const source = `gemini-voyager-prompts.acct-${hashString(scope.accountKey)}.json`;
const prompt = (id: string) => ({ id, text: `${id} text`, tags: [], createdAt: 1 });
const legacyMergeSources = { 'old-route-file': '1234567890abcdef1234567890abcdef' };
const envelope = (id: string) => ({
  format: 'gemini-voyager.prompts.v1',
  exportedAt: '2026-10-29T12:00:00.000Z',
  items: [prompt(id)],
  legacyMergeSources,
});

async function device() {
  const local = createSyncStorage({
    gvSyncMode: 'disabled',
    gvAccessToken: 'legacy-provenance-token',
    gvTokenExpiry: Date.now() + 3_600_000,
  });
  vi.stubGlobal('chrome', {
    runtime: { lastError: null },
    storage: { local: local.area, sync: createSyncStorage().area },
  });
  const drive = new FakeSyncDrive();
  vi.stubGlobal('fetch', drive.fetch);
  const service = new GoogleDriveSyncService();
  await service.getState();
  return { drive, service, local };
}

function releasedPromptReader() {
  const code = execFileSync(
    'git',
    ['show', 'v2.2.1:src/features/backup/services/PromptImportExportService.ts'],
    { encoding: 'utf8' },
  );
  const { outputText } = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const imports: Record<string, unknown> = {
    '@/core/errors/AppError': { AppError, ErrorCode },
    '@/core/types/common': { StorageKeys },
    '@/core/utils/version': { EXTENSION_VERSION: '2.2.1' },
  };
  const module = { exports: {} };
  new Script(outputText).runInNewContext({
    module,
    exports: module.exports,
    require: (id: string) => {
      if (!Object.hasOwn(imports, id)) throw new Error(`Unprovided release dependency: ${id}`);
      return imports[id];
    },
  });
  return module.exports as typeof import('@/features/backup/services/PromptImportExportService');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('email file legacy provenance compatibility', () => {
  it('keeps both local and legacy prompt whitespace while migrating an old route file', async () => {
    const d = await device();
    d.local.values[StorageKeys.GV_ACCOUNT_PROFILE_MAP] = {
      version: 1,
      nextId: 2,
      profiles: {
        'route:1': { id: 1, createdAt: 1, updatedAt: 1, routeUserId: '1', emailHash: 'owner' },
      },
      routeAliases: { '1': 'route:1' },
      emailAliases: { owner: 'route:1' },
    };
    const legacy = `gemini-voyager-prompts.acct-${hashString('route:1')}.json`;
    const incoming = {
      ...prompt('legacy'),
      text: '    print("legacy")\n',
      name: ' Legacy template ',
    };
    const local = { ...prompt('local'), text: '    print("local")\n', name: ' Local template ' };
    d.drive.put(legacy, { ...envelope('legacy'), items: [incoming] });
    await expect(
      d.service.runExclusive((turn) => turn.uploadPromptsOnly([local], scope, false)),
    ).resolves.toBe(true);
    expect(d.drive.payload<{ items: unknown[] }>(source).items).toEqual([local, incoming]);
  });

  it.each(['1234567890abcdef1234567890abcdef', `sha256:${'a'.repeat(64)}`])(
    'preserves provenance on an email-only device and the actual v2.2.1 reader accepts its output (%s)',
    async (fingerprint) => {
      const d = await device();
      const provenance = { ...legacyMergeSources, 'another-source': fingerprint };
      d.drive.put(source, { ...envelope('old'), legacyMergeSources: provenance });
      await expect(
        d.service.runExclusive((turn) => turn.uploadPromptsOnly([prompt('new')], scope, false)),
      ).resolves.toBe(true);
      const uploaded = d.drive.payload(source);
      expect(uploaded).toHaveProperty('legacyMergeSources', provenance);
      const result = releasedPromptReader().PromptImportExportService.validatePayload(uploaded);
      expect(result.success).toBe(true);
      if (!result.success) throw result.error;
      expect(result.data.items).toEqual([prompt('new')]);
    },
  );

  it('history keeps and restores the exact provenance-bearing bytes', async () => {
    const d = await device();
    d.drive.put(source, envelope('old'));
    const original = d.drive.files.get(source);
    await d.service.runExclusive((turn) => turn.uploadPromptsOnly([prompt('new')], scope, false));
    await expect(
      d.service.runExclusive((turn) =>
        turn.restorePreviousVersion([{ name: source, accountScope: scope }], false),
      ),
    ).resolves.toMatchObject([{ status: 'restored' }]);
    expect(d.drive.files.get(source)).toBe(original);
  });

  it('an unknown provenance shape blocks replacement without discarding it', async () => {
    const d = await device();
    d.drive.put(source, { ...envelope('old'), legacyMergeSources: { future: { revision: 1 } } });
    const before = new Map(d.drive.files);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      d.service.runExclusive((turn) => turn.uploadPromptsOnly([prompt('new')], scope, false)),
    ).resolves.toBe(false);
    expect(d.drive.files).toEqual(before);
  });
});
