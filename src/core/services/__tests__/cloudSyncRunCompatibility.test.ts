import { execFileSync } from 'node:child_process';
import { Script } from 'node:vm';
import ts from 'typescript';
import { expect, it } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import * as canonicalHash from '@/core/utils/canonicalHash';
import { isFolderPlatform } from '@/features/folder/platforms';
import { createWriteQueue } from '@/features/storage/writeQueue';
import { createMemoryStorage } from '@/tests/memoryStorage';

import * as failure from '../CloudSyncFailure';
import { CloudSyncSnapshotService } from '../CloudSyncSnapshotService';
import * as owners from '../CloudSyncUndoOwners';
import * as hashes from '../cloudSyncSnapshotHash';
import * as undo from '../cloudSyncSnapshotUndo';

// Execute the actual Round C parser/undo service, not a hand-copied compatibility model.
function roundCModule(name: string, imports: Record<string, unknown>): unknown {
  const source = execFileSync('git', ['show', `b9bf9e58b:src/core/services/${name}.ts`], {
    encoding: 'utf8',
  });
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Script(outputText).runInNewContext({
    module,
    exports: module.exports,
    require: (id: string) => {
      if (!(id in imports)) throw new Error(`Missing Round C dependency: ${id}`);
      return imports[id];
    },
  });
  return module.exports;
}

it('an older build refuses a multi-row run without writing or dropping its stored undo data', async () => {
  const memory = createMemoryStorage();
  memory.values.local.set('example', 'before');
  const service = new CloudSyncSnapshotService(() => memory.api);
  const run = await service.capture({
    context: { source: 'popup-restore', platform: 'gemini', accountScope: null },
    keys: [{ area: 'local', key: 'example' }],
    run: { owner: 'panel', operationId: 'row' },
  });
  await service.extend(run.id, [{ area: 'local', key: 'example' }], {
    applied: [{ area: 'local', key: 'example', kind: 'prompts', value: 'downloaded' }],
  });
  await memory.api.local.set({ example: 'downloaded' });
  await service.finishRunRow(run.id, 'row');
  const types = roundCModule('cloudSyncSnapshotTypes', {
    '@/core/utils/canonicalHash': canonicalHash,
    '@/features/folder/platforms': { isFolderPlatform },
  });
  const released = roundCModule('CloudSyncSnapshotService', {
    '@/core/types/common': { StorageKeys },
    '@/features/storage/writeQueue': { createWriteQueue },
    './CloudSyncFailure': failure,
    './CloudSyncUndoOwners': owners,
    './cloudSyncSnapshotHash': hashes,
    './cloudSyncSnapshotTypes': types,
    './cloudSyncSnapshotUndo': undo,
  }) as typeof import('../CloudSyncSnapshotService');
  const before = structuredClone([...memory.values.local]);
  const writes = memory.writes.length;
  expect(await new released.CloudSyncSnapshotService(() => memory.api).undo(run.id)).toMatchObject({
    status: 'failed',
  });
  expect([...memory.values.local]).toEqual(before);
  expect(memory.writes).toHaveLength(writes);
  expect(await service.undo(run.id)).toMatchObject({ status: 'restored', restoredKeys: 1 });
  expect(memory.values.local.get('example')).toBe('before');
});
