import { createHash } from 'node:crypto';

interface CloudFiles {
  readText(name: string): string | null | Promise<string | null>;
  writeText(name: string, text: string): void | Promise<void>;
  removeText?(name: string): void | Promise<void>;
}

interface HistoryFile {
  id: string;
  name: string;
  json: string;
  createdTime: number;
}

const checksum = (text: string) => createHash('md5').update(text).digest('hex');
const version = (text: string | null) => (text === null ? null : `version:${checksum(text)}`);

/** The new native CloudKit read/conditional-write boundary, over each test's existing media store. */
export function createFakeICloudUploadTransport(files: CloudFiles) {
  let sequence = 0;
  const histories = new Map<string, HistoryFile>();
  const archive = (name: string, json: string) => {
    const id = `history-${name}-${++sequence}`;
    histories.set(id, { id, name, json, createdTime: sequence });
    return id;
  };
  const transport = async (message: Record<string, unknown>): Promise<object | null> => {
    if (
      ![
        'iCloudReadUploadVersion',
        'iCloudWriteUpload',
        'iCloudReadHistory',
        'iCloudPruneHistory',
        'iCloudRestoreHistory',
        'iCloudUndoUpload',
      ].includes(String(message.action))
    )
      return null;
    if (message.action === 'iCloudUndoUpload') {
      const receipt = message.receipt;
      if (
        typeof receipt !== 'object' ||
        receipt === null ||
        !('name' in receipt) ||
        typeof receipt.name !== 'string' ||
        !('md5Checksum' in receipt) ||
        !('replaced' in receipt)
      )
        throw new Error('Invalid fake Undo receipt');
      const name = receipt.name;
      const current = await files.readText(name);
      if (current === null || checksum(current) !== receipt.md5Checksum)
        return { success: true, data: { name, status: 'kept' } };
      const replaced = receipt.replaced;
      if (typeof replaced !== 'object' || replaced === null || !('kind' in replaced))
        throw new Error('Invalid fake Undo replacement');
      if (replaced.kind === 'created') {
        archive(name, current);
        if (!files.removeText) throw new Error('No fake remove boundary');
        await files.removeText(name);
        return { success: true, data: { name, status: 'removed' } };
      }
      if (!('historyId' in replaced) || typeof replaced.historyId !== 'string')
        throw new Error('No fake history target');
      const history = histories.get(replaced.historyId);
      if (history?.name !== name) return { success: true, data: { name, status: 'no_history' } };
      const retentionHistoryId = archive(name, current);
      await files.writeText(name, history.json);
      return {
        success: true,
        data: { name, status: 'restored', historyId: history.id, retentionHistoryId },
      };
    }
    if (typeof message.fileName !== 'string') throw new Error('Missing native CloudKit filename');
    const name = message.fileName;
    const current = await files.readText(name);
    if (message.action === 'iCloudReadHistory')
      return {
        success: true,
        data: {
          files: [...histories.values()]
            .filter((entry) => entry.name === name)
            .sort((a, b) => b.createdTime - a.createdTime),
        },
      };
    if (message.action === 'iCloudPruneHistory') {
      if (!Array.isArray(message.historyIds)) throw new Error('Missing fake prune IDs');
      let deleted = 0;
      for (const id of message.historyIds) {
        if (histories.get(id)?.name !== name || id === message.protectedHistoryId)
          throw new Error('Invalid fake prune authority');
        histories.delete(id);
        deleted++;
      }
      return { success: true, data: { deleted, errors: [] } };
    }
    if (message.action === 'iCloudRestoreHistory') {
      if (message.expectedVersion !== version(current))
        return { success: true, data: { name, status: 'kept' } };
      const history =
        typeof message.historyId === 'string' ? histories.get(message.historyId) : undefined;
      if (history?.name !== name) return { success: true, data: { name, status: 'no_history' } };
      const retentionHistoryId = current === null ? undefined : archive(name, current);
      await files.writeText(name, history.json);
      return {
        success: true,
        data: { name, status: 'restored', historyId: history.id, retentionHistoryId },
      };
    }
    if (message.action === 'iCloudReadUploadVersion')
      return {
        success: true,
        data: { found: current !== null, json: current, version: version(current) },
      };
    if (message.expectedVersion !== version(current))
      return {
        success: false,
        code: 'icloud_conflict',
        error: 'The cloud file changed before the conditional write',
      };
    if (typeof message.json !== 'string') throw new Error('Missing native CloudKit media');
    await files.writeText(name, message.json);
    return {
      success: true,
      data: {
        name,
        fileId: name,
        md5Checksum: checksum(message.json),
        replaced:
          current === null
            ? { kind: 'created' }
            : { kind: 'history', historyId: archive(name, current) },
      },
    };
  };
  return Object.assign(transport, { histories });
}
