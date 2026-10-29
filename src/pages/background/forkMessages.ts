import { recordCloudSyncWrites } from '@/core/services/CloudSyncSnapshotService';
import { StorageKeys } from '@/core/types/common';
import type { ForkNode, ForkNodesData } from '@/pages/content/fork/forkTypes';

interface StorageArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isForkNodesContainer(value: unknown): value is {
  nodes: Record<string, unknown>;
  groups: Record<string, unknown>;
} {
  return isRecord(value) && isRecord(value.nodes) && isRecord(value.groups);
}

function isForkNode(value: unknown): value is ForkNode {
  if (typeof value !== 'object' || value === null) return false;
  const node = value as Record<string, unknown>;
  return (
    typeof node.turnId === 'string' &&
    typeof node.conversationId === 'string' &&
    typeof node.conversationUrl === 'string' &&
    typeof node.forkGroupId === 'string' &&
    typeof node.forkIndex === 'number' &&
    typeof node.createdAt === 'number'
  );
}

/** Preserve valid records while refusing an unreadable base for every fork operation. */
function normalizeStoredForkNodes(value: unknown): ForkNodesData {
  if (value === undefined) return { nodes: {}, groups: {} };
  if (!isForkNodesContainer(value)) throw new Error('Invalid fork nodes envelope');
  const nodes = Object.fromEntries(
    Object.entries(value.nodes).flatMap(([id, entries]) => {
      const valid = Array.isArray(entries) ? entries.filter(isForkNode) : [];
      return valid.length > 0 ? [[id, valid]] : [];
    }),
  );
  const hadNodes = Object.values(value.nodes).some(
    (entries) => !Array.isArray(entries) || entries.length > 0,
  );
  const groups = Object.fromEntries(
    Object.entries(value.groups).flatMap(([id, entries]) => {
      const valid = Array.isArray(entries)
        ? entries.filter((entry): entry is string => typeof entry === 'string')
        : [];
      return valid.length > 0 ? [[id, valid]] : [];
    }),
  );
  const hadGroups = Object.values(value.groups).some(
    (entries) => !Array.isArray(entries) || entries.length > 0,
  );
  if (
    (hadNodes && Object.keys(nodes).length === 0) ||
    (!hadNodes && hadGroups && Object.keys(groups).length === 0)
  ) {
    throw new Error('Invalid fork nodes envelope');
  }
  return { nodes, groups };
}

/** Add `node` and its group index entry unless the same fork is already recorded. */
function insertForkNode(data: ForkNodesData, node: ForkNode): boolean {
  const nodes = (data.nodes[node.conversationId] ??= []);
  if (nodes.some((n) => n.turnId === node.turnId && n.forkGroupId === node.forkGroupId)) {
    return false;
  }
  nodes.push(node);
  const group = (data.groups[node.forkGroupId] ??= []);
  const groupKey = `${node.conversationId}:${node.turnId}`;
  if (!group.includes(groupKey)) group.push(groupKey);
  return true;
}

class ForkNodesManager {
  private operationQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly area: StorageArea) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const promise = this.operationQueue.then(operation, operation);
    this.operationQueue = promise.catch(() => {});
    return promise;
  }

  // Writes read strictly: saving over an empty read-error fallback would erase the stored forks.
  private async readStored(): Promise<ForkNodesData> {
    const result = await this.area.get([StorageKeys.FORK_NODES]);
    return normalizeStoredForkNodes(result[StorageKeys.FORK_NODES]);
  }

  private async getFromStorage(): Promise<ForkNodesData> {
    try {
      return await this.readStored();
    } catch (error) {
      console.error('[Background] Failed to get fork nodes:', error);
      return { nodes: {}, groups: {} };
    }
  }

  private async saveToStorage(data: ForkNodesData): Promise<void> {
    await this.area.set({ [StorageKeys.FORK_NODES]: data });
  }

  async addForkNode(node: ForkNode): Promise<boolean> {
    return this.serialize(async () => {
      const data = await this.readStored();
      if (!insertForkNode(data, node)) return false;
      await this.saveToStorage(data);
      return true;
    });
  }

  /** Add the forks from a Drive envelope; restores never remove local forks. */
  async mergeCloud(envelope: unknown): Promise<{ status: 'absent' | 'merged' }> {
    return this.serialize(async () => {
      if (envelope === null || typeof envelope !== 'object') return { status: 'absent' };
      const cloud = 'data' in envelope ? envelope.data : undefined;
      if (
        ('format' in envelope && envelope.format !== 'gemini-voyager.forks.v1') ||
        !isForkNodesContainer(cloud)
      ) {
        throw new Error('Invalid fork nodes envelope');
      }
      const data = await this.readStored();
      let changed = false;
      for (const nodes of Object.values(cloud.nodes)) {
        if (!Array.isArray(nodes)) continue;
        for (const node of nodes) {
          if (isForkNode(node) && insertForkNode(data, node)) changed = true;
        }
      }
      if (changed) {
        if ('cloudSyncSnapshotId' in envelope && typeof envelope.cloudSyncSnapshotId === 'string') {
          await recordCloudSyncWrites(envelope.cloudSyncSnapshotId, [
            {
              area: 'local',
              key: StorageKeys.FORK_NODES,
              kind: 'forks',
              value: data,
            },
          ]);
        }
        await this.saveToStorage(data);
      }
      return { status: 'merged' };
    });
  }

  async removeForkNode(
    conversationId: string,
    turnId: string,
    forkGroupId: string,
  ): Promise<boolean> {
    return this.serialize(async () => {
      const data = await this.readStored();

      if (data.nodes[conversationId]) {
        const initialLength = data.nodes[conversationId].length;
        data.nodes[conversationId] = data.nodes[conversationId].filter(
          (n) => !(n.turnId === turnId && n.forkGroupId === forkGroupId),
        );

        if (data.nodes[conversationId].length < initialLength) {
          if (data.nodes[conversationId].length === 0) {
            delete data.nodes[conversationId];
          }

          // Update group index
          if (data.groups[forkGroupId]) {
            const groupKey = `${conversationId}:${turnId}`;
            data.groups[forkGroupId] = data.groups[forkGroupId].filter((k) => k !== groupKey);
            if (data.groups[forkGroupId].length === 0) {
              delete data.groups[forkGroupId];
            }
          }

          await this.saveToStorage(data);
          return true;
        }
      }
      return false;
    });
  }

  async getAllForkNodes(): Promise<ForkNodesData> {
    // Cloud uploads must never replace existing forks with a read-error fallback.
    return this.serialize(() => this.readStored());
  }

  async getForConversation(conversationId: string): Promise<ForkNode[]> {
    const data = await this.getFromStorage();
    return data.nodes[conversationId] || [];
  }

  async getGroup(forkGroupId: string): Promise<ForkNode[]> {
    const data = await this.getFromStorage();
    const groupKeys = data.groups[forkGroupId] || [];
    const nodes: ForkNode[] = [];

    for (const key of groupKeys) {
      const [convId, turnId] = key.split(':');
      const convNodes = data.nodes[convId] || [];
      const match = convNodes.find((n) => n.turnId === turnId && n.forkGroupId === forkGroupId);
      if (match) nodes.push(match);
    }

    return nodes.sort((a, b) => a.forkIndex - b.forkIndex);
  }
}

type ForkMessageRequest =
  | { type: 'gv.fork.add'; payload: ForkNode }
  | { type: 'gv.fork.remove'; payload: Pick<ForkNode, 'conversationId' | 'turnId' | 'forkGroupId'> }
  | { type: 'gv.fork.getAll' }
  | { type: 'gv.fork.mergeCloud'; payload: unknown }
  | { type: 'gv.fork.getForConversation'; payload: Pick<ForkNode, 'conversationId'> }
  | { type: 'gv.fork.getGroup'; payload: Pick<ForkNode, 'forkGroupId'> };

export interface ForkMessagesOwner {
  handle(message: unknown): Promise<Record<string, unknown>> | null;
  getAllForkNodes(): Promise<ForkNodesData>;
}

/** Owns fork records and their group index in one serialized queue. */
export function createForkMessagesOwner(area: StorageArea): ForkMessagesOwner {
  const manager = new ForkNodesManager(area);
  return {
    getAllForkNodes: () => manager.getAllForkNodes(),
    handle(message) {
      const request = message as ForkMessageRequest | null;
      switch (request?.type) {
        case 'gv.fork.add':
          return manager.addForkNode(request.payload).then((added) => ({ ok: true, added }));
        case 'gv.fork.remove':
          return manager
            .removeForkNode(
              request.payload.conversationId,
              request.payload.turnId,
              request.payload.forkGroupId,
            )
            .then((removed) => ({ ok: true, removed }));
        case 'gv.fork.getAll':
          return manager.getAllForkNodes().then((data) => ({ ok: true, data }));
        case 'gv.fork.mergeCloud':
          return manager.mergeCloud(request.payload).then((result) => ({ ok: true, ...result }));
        case 'gv.fork.getForConversation':
          return manager
            .getForConversation(request.payload.conversationId)
            .then((nodes) => ({ ok: true, nodes }));
        case 'gv.fork.getGroup':
          return manager
            .getGroup(request.payload.forkGroupId)
            .then((nodes) => ({ ok: true, nodes }));
        default:
          return null;
      }
    },
  };
}
