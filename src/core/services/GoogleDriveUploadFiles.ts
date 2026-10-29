import type { DriveHistoryRestoreFile } from '@/core/types/driveHistory';

import type { DriveFilesPort } from './GoogleDriveFiles';
import { isDriveSyncFileName } from './GoogleDriveHistoryPayload';
import { GoogleDriveUploadHistory, type PreparedDriveHistory } from './GoogleDriveUploadHistory';

type Files = Pick<
  DriveFilesPort,
  | 'find'
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
  | { kind: 'ready'; id: string; history: PreparedDriveHistory };

/** Every target and old body is resolved before creation or content replacement begins. */
export class GoogleDriveUploadFiles {
  private readonly names = new Set<string>();
  private readonly targets = new Map<string, UploadTarget>();
  private readonly history: GoogleDriveUploadHistory;
  private beforeFirstWrite: (() => Promise<void>) | null = null;

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
      const id = await this.files.ensure(token, name, target.id);
      this.targets.set(name, { kind: 'ready', id, history: target.history });
    }
  }

  async write(token: string, name: string, payload: unknown): Promise<void> {
    this.register(name);
    await this.commitReady(token, name);
    const target = this.targets.get(name);
    if (!target?.id) throw new Error('Upload failed');
    const text = JSON.stringify(payload);
    if (text === undefined) throw new Error('Upload failed');
    if (target.history.current !== text) await this.history.preserve(token, name, target.history);
    await this.files.upload(token, target.id, payload);
    // A verification retry snapshots the body it actually replaces, never an already saved copy.
    target.history.current = text;
    await this.history.retain(token, target.history);
  }

  /** Restore is planned for all requested files before any current content can be replaced. */
  async restoreHistory(
    token: string,
    names: readonly string[],
  ): Promise<DriveHistoryRestoreFile[]> {
    if (!this.files.supportsHistory()) {
      return names.map((name) => ({ name, status: 'unsupported_provider' }));
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
        if (!target?.id) throw new Error('Upload failed');
        if (target.history.current !== text)
          await this.history.preserve(token, name, target.history);
        await this.files.uploadText(token, target.id, text);
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
