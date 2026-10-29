import type { SyncAccountScope } from '@/core/types/sync';
import { isSafariICloudConflictError } from '@/core/utils/safariICloudSync';
import { EXTENSION_VERSION } from '@/core/utils/version';
import type { StarStore } from '@/features/savedLibrary/starStore';
import { mergeStarState, type StarState } from '@/features/savedLibrary/starSyncData';
import {
  buildStarsV2,
  decodeStarSyncSources,
  type StarSyncSources,
} from '@/features/savedLibrary/starSyncPayload';

import { legacyStarredExport } from './legacyStarredExport';

export interface StarTransferPort {
  assertActive(): void;
  read(): Promise<StarSyncSources>;
  writeV2(payload: unknown): Promise<void>;
  /** The legacy v1 twin; absent for a file older versions never read. */
  writeV1?(payload: unknown): Promise<void>;
  /** The part of the local stars this file holds, given what the file held when read. */
  select?(local: StarState, remote: StarState): StarState;
}

export interface StarTransferTarget {
  port: StarTransferPort;
  scope: SyncAccountScope | null;
  /** A source already read in this sync turn, for discovering the catalog files it carries. */
  source?: StarSyncSources;
}

interface PreparedStarTransfer extends StarTransferTarget {
  held: StarState;
  v2: ReturnType<typeof buildStarsV2>;
  v1: {
    format: 'gemini-voyager.starred.v1';
    exportedAt: string;
    version: string;
    data: ReturnType<typeof legacyStarredExport>;
  };
}

interface VerifiedStarTransfer extends StarTransferTarget {
  held: StarState;
  stateFingerprint: string;
}

function fingerprint(state: StarState): string {
  const records = (items: object[]) =>
    items
      .map((item) => JSON.stringify(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))))
      .sort();
  return JSON.stringify([
    records(Object.values(state.data.messages).flat()),
    records(state.tombstones),
  ]);
}

export class StarDriveSyncCoordinator {
  /** Read every source and local snapshot before an upload operation may write its first file. */
  async prepare(
    store: StarStore,
    targets: readonly StarTransferTarget[],
  ): Promise<() => Promise<void>> {
    const prepared = await this.prepareTransfers(store, targets);
    return async () => {
      for (const { port } of prepared) port.assertActive();
      const verified: VerifiedStarTransfer[] = [];
      for (const transfer of prepared) verified.push(await this.transfer(store, transfer));
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const changed = [];
        for (const [index, transfer] of verified.entries()) {
          const { port, scope, held } = transfer;
          port.assertActive();
          const local = await store.getSyncSnapshot(scope);
          port.assertActive();
          const selected = port.select ? port.select(local, held) : local;
          if (fingerprint(selected) !== transfer.stateFingerprint) {
            changed.push({ index, port, scope });
          }
        }
        if (changed.length === 0) return;
        if (attempt === 2) break;
        // A later site transfer can change the compatibility copy an earlier file holds.
        const refreshed = await this.prepareTransfers(store, changed);
        for (const [position, transfer] of refreshed.entries()) {
          verified[changed[position].index] = await this.transfer(store, transfer);
        }
      }
      throw new Error('Star upload could not be verified after 3 merge attempts');
    };
  }

  private async prepareTransfers(
    store: StarStore,
    targets: readonly StarTransferTarget[],
  ): Promise<PreparedStarTransfer[]> {
    const reads = [];
    for (const target of targets) {
      target.port.assertActive();
      const remote = target.source ?? (await target.port.read());
      target.port.assertActive();
      reads.push({ ...target, remote, held: decodeStarSyncSources(remote, target.scope) });
    }
    // Merge all files first: a site's tombstone must also reach its legacy Gemini projection.
    for (const { port, scope, remote } of reads) {
      port.assertActive();
      await store.mergeSync(remote, scope);
      port.assertActive();
    }
    const prepared: PreparedStarTransfer[] = [];
    for (const { port, scope, held } of reads) {
      port.assertActive();
      const local = await store.getSyncSnapshot(scope);
      const snapshot = port.select ? port.select(local, held) : local;
      port.assertActive();
      const v2 = buildStarsV2(snapshot, scope, EXTENSION_VERSION);
      const v1: PreparedStarTransfer['v1'] = {
        format: 'gemini-voyager.starred.v1',
        exportedAt: new Date().toISOString(),
        version: EXTENSION_VERSION,
        data: legacyStarredExport(snapshot.data),
      };
      JSON.stringify(v2);
      JSON.stringify(v1);
      prepared.push({ port, scope, held, v2, v1 });
    }
    return prepared;
  }

  private async transfer(
    store: StarStore,
    initial: PreparedStarTransfer,
  ): Promise<VerifiedStarTransfer> {
    const { port, scope } = initial;
    let prepared = initial;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) {
        for (const refreshed of await this.prepareTransfers(store, [{ port, scope }])) {
          prepared = refreshed;
        }
      }
      const select = (local: StarState) =>
        port.select ? port.select(local, prepared.held) : local;
      port.assertActive();
      try {
        await port.writeV2(prepared.v2);
        port.assertActive();
        await port.writeV1?.(prepared.v1);
      } catch (error) {
        if (isSafariICloudConflictError(error)) {
          port.assertActive();
          continue;
        }
        throw error;
      }
      port.assertActive();
      const readback = await port.read();
      port.assertActive();
      const verified = decodeStarSyncSources(readback, scope);
      await store.mergeSync(readback, scope);
      port.assertActive();
      const latest = select(await store.getSyncSnapshot(scope));
      port.assertActive();
      // Verify the latest queued edits too: a deletion made during upload must reach both files.
      const covered = mergeStarState(
        [verified.data, latest.data],
        [...verified.tombstones, ...latest.tombstones],
        Date.now(),
      );
      const actualV2 = decodeStarSyncSources({ v2: readback.v2 }, scope);
      const actualV1 = decodeStarSyncSources(
        { v1: readback.v1, v1AccountHash: readback.v1AccountHash },
        scope,
      );
      const projection = { data: legacyStarredExport(latest.data), tombstones: [] };
      if (
        readback.v2 &&
        fingerprint(actualV2) === fingerprint(covered) &&
        (!port.writeV1 || (readback.v1 && fingerprint(actualV1) === fingerprint(projection)))
      ) {
        return { port, scope, held: prepared.held, stateFingerprint: fingerprint(latest) };
      }
    }
    throw new Error('Star upload could not be verified after 3 merge attempts');
  }
}
