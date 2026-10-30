import type { DriveHistoryRestoreFile } from '@/core/types/driveHistory';
import type { CloudUploadReceipt, CloudUploadWrittenFile } from '@/core/types/syncUploadReceipt';
import { restoreICloudPreviousVersion } from '@/core/utils/safariICloudHistory';

import type { DriveFilesPort } from './GoogleDriveFiles';
import { isDriveSyncFileName } from './GoogleDriveHistoryPayload';
import { isUnsentDriveCall } from './GoogleDriveSyncSession';
import { GoogleDriveUploadHistory, type PreparedDriveHistory } from './GoogleDriveUploadHistory';
import { undoDriveUploadFile } from './GoogleDriveUploadUndo';
import { DriveWriteUnchanged, preserveLatestDriveVersion } from './GoogleDriveWriteVersion';

type Files = Pick<
  DriveFilesPort,
  | 'find'
  | 'metadata'
  | 'ensure'
  | 'upload'
  | 'downloadText'
  | 'uploadText'
  | 'supportsHistory'
  | 'createHistory'
  | 'listHistory'
  | 'trash'
>;

type UploadTarget =
  | { kind: 'found'; id: string | null; history: PreparedDriveHistory }
  | { kind: 'ready'; id: string; created: boolean; history: PreparedDriveHistory };

/** Every target and old body is resolved before creation or content replacement begins. */
export class GoogleDriveUploadFiles {
  private readonly names = new Set<string>();
  private readonly targets = new Map<string, UploadTarget>();
  private readonly history: GoogleDriveUploadHistory;
  private beforeFirstWrite: (() => Promise<void>) | null = null;
  private readonly receipts = new Map<string, CloudUploadWrittenFile>();
  private readonly unreceipted = new Set<string>();

  getReceipt(): CloudUploadReceipt {
    return { files: [...this.receipts.values()], complete: this.unreceipted.size === 0 };
  }

  constructor(private readonly files: Files) {
    this.history = new GoogleDriveUploadHistory(files);
  }

  register(...names: string[]): void {
    for (const name of names) this.names.add(name);
  }

  setBeforeFirstWrite(callback: () => Promise<void>): void {
    this.beforeFirstWrite = callback;
  }

  /** This phase is read-only: even missing target files are not created yet. */
  async prepare(token: string): Promise<void> {
    for (const name of this.names) {
      if (this.targets.has(name)) continue;
      const id = await this.files.find(token, name);
      const history = await this.history.prepare(token, name, id);
      this.targets.set(name, { kind: 'found', id, history });
    }
  }

  private async commitReady(token: string, name: string): Promise<void> {
    await this.prepare(token);
    const before = this.beforeFirstWrite;
    await before?.();
    if (this.beforeFirstWrite === before) this.beforeFirstWrite = null;
    // Read-only targets stay missing; account persistence precedes creation or relocation.
    const target = this.targets.get(name);
    if (target?.kind === 'found') {
      // Creation can succeed even if its response is lost. Do not offer a partial run Undo.
      // Finding the file it already had creates nothing; only the write below then needs Undo.
      const id = await this.mutating(
        name,
        () => this.files.ensure(token, name, target.id),
        (found) => found === target.id,
      );
      this.targets.set(name, {
        kind: 'ready',
        id,
        created: target.id === null,
        history: target.history,
      });
    }
  }

  async write(token: string, name: string, payload: unknown): Promise<void> {
    this.register(name);
    await this.commitReady(token, name);
    const target = this.targets.get(name);
    if (target?.kind !== 'ready') throw new Error('Upload failed');
    const text = JSON.stringify(payload);
    if (text === undefined) throw new Error('Upload failed');
    let replacement: CloudUploadWrittenFile['replaced'] | null = target.created
      ? { kind: 'created' }
      : null;
    const previous = this.receipts.get(name);
    let checks = 0;
    let skippedWrite = false;
    const metadata = await this.mutating(name, () =>
      this.files.upload(token, target.id, payload, async () => {
        checks++;
        if (this.files.supportsHistory()) {
          const current = await preserveLatestDriveVersion({
            files: this.files,
            history: this.history,
            plan: target.history,
            token,
            name,
            id: target.id,
            next: text,
            created: target.created,
          });
          if (previous && current.metadata?.md5Checksum === previous.md5Checksum)
            replacement = previous.replaced;
          else if (current.historyId)
            replacement = { kind: 'history', historyId: current.historyId };
          if (current.metadata && target.history.current === text) {
            skippedWrite = true;
            throw new DriveWriteUnchanged(current.metadata);
          }
        }
      }),
    );
    if (skippedWrite) {
      // A retry can see our own ambiguous earlier PATCH. Its later GET is not a write receipt.
      if (checks === 1) this.unreceipted.delete(name);
    } else if (metadata?.uploadReceipt) {
      this.receipts.set(
        name,
        previous && metadata.previousText === target.history.current
          ? { ...metadata.uploadReceipt, replaced: previous.replaced }
          : metadata.uploadReceipt,
      );
      this.unreceipted.delete(name);
    } else if (metadata && replacement) {
      this.receipts.set(name, {
        name,
        fileId: target.id,
        md5Checksum: metadata.md5Checksum,
        replaced: replacement,
      });
      this.unreceipted.delete(name);
    }
    // A verification retry snapshots the body it actually replaces, never an already saved copy.
    target.history.current = text;
    await this.history.retain(token, target.history);
  }

  /**
   * Holds `name` without a receipt while a call that may change it runs. A call refused before it
   * was sent, or one `unchanged` vouches for, leaves the name as it was.
   */
  private async mutating<T>(
    name: string,
    mutate: () => Promise<T>,
    unchanged?: (value: T) => boolean,
  ): Promise<T> {
    const held = this.unreceipted.has(name);
    this.unreceipted.add(name);
    try {
      const value = await mutate();
      if (!held && unchanged?.(value)) this.unreceipted.delete(name);
      return value;
    } catch (error) {
      if (!held && isUnsentDriveCall(error)) this.unreceipted.delete(name);
      throw error;
    }
  }

  /** Restore is planned for all requested files before any current content can be replaced. */
  async restoreHistory(
    token: string,
    names: readonly string[],
    receipt?: CloudUploadReceipt,
  ): Promise<DriveHistoryRestoreFile[]> {
    if (receipt) {
      const outcomes: DriveHistoryRestoreFile[] = [];
      for (const name of names) {
        const file = receipt.files.find((file) => file.name === name);
        outcomes.push(
          file && isDriveSyncFileName(name)
            ? await undoDriveUploadFile(this.files, token, file, async () => {
                await this.beforeFirstWrite?.();
              })
            : { name, status: 'no_history' },
        );
      }
      return outcomes;
    }
    if (!this.files.supportsHistory()) {
      const outcomes: DriveHistoryRestoreFile[] = [];
      for (const name of new Set(names)) {
        outcomes.push(
          isDriveSyncFileName(name)
            ? await restoreICloudPreviousVersion(name, async () => {
                await this.beforeFirstWrite?.();
              })
            : { name, status: 'unrecognized_history' },
        );
      }
      return outcomes;
    }
    const outcomes: DriveHistoryRestoreFile[] = [];
    const planned: Array<{ name: string; text: string; historyId: string }> = [];
    for (const name of new Set(names)) {
      if (!isDriveSyncFileName(name)) {
        outcomes.push({ name, status: 'unrecognized_history' });
        continue;
      }
      try {
        const history = await this.history.prepare(token, name, null);
        const id = await this.files.find(token, name);
        history.current = id ? await this.files.downloadText(token, id) : null;
        // An archive from an unsuccessful upload is not a previous version.
        const latest = history.recognized.find(({ text }) => text !== history.current);
        if (!latest) {
          outcomes.push({
            name,
            status:
              history.entries.length && !history.recognized.length
                ? 'unrecognized_history'
                : 'no_history',
          });
          continue;
        }
        this.names.add(name);
        this.targets.set(name, { kind: 'found', id, history });
        planned.push({ name, text: latest.text, historyId: latest.entry.id });
      } catch {
        outcomes.push({ name, status: 'read_failed' });
      }
    }
    for (const { name, text, historyId } of planned) {
      try {
        await this.commitReady(token, name);
        const target = this.targets.get(name);
        if (target?.kind !== 'ready') throw new Error('Upload failed');
        await this.files.uploadText(token, target.id, text, async () => {
          await preserveLatestDriveVersion({
            files: this.files,
            history: this.history,
            plan: target.history,
            token,
            name,
            id: target.id,
            next: text,
          });
        });
        target.history.current = text;
        await this.history.retain(token, target.history);
        outcomes.push({ name, status: 'restored', historyId });
      } catch {
        outcomes.push({ name, status: 'write_failed' });
      }
    }
    const order = new Map(names.map((name, index) => [name, index]));
    return outcomes.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
  }
}
