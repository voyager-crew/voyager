import type { Storage } from 'webextension-polyfill';

import { cloneFolderData, validateFolderData } from '@/features/folder/model/folderData';
import { LegacyFolderWriteRefusedError } from '@/features/folder/owner/legacyFolderFence';

import type { FolderDataSession } from './FolderDataSession';
import { FolderRecoverySupersededError } from './FolderRecoveryWriteGuard';
import { FolderRepositoryState } from './FolderRepositoryState';
import type { FolderWriteReceipt } from './storage/FolderStorageAdapter';
import { type StorageEcho, serializeStoredValue } from './storage/StorageEchoTracker';
import type { FolderData } from './types';

const SAVE_DEBOUNCE_MS = 300;

/** `FolderRepository`'s serialized writes: the debounce, the save chain and reconciliation. */
export abstract class FolderRepositorySaves extends FolderRepositoryState {
  /**
   * Debounce a save. Only for edits that `mergeDebouncedEdits` can carry onto a
   * reload: expand/collapse and conversation timestamps.
   */
  scheduleSaveData(): void {
    if (this.canEdit && this.dataSession) this.armDebounce(this.dataSession);
  }

  protected armDebounce(session: FolderDataSession): void {
    session.scheduleDebounce(() => this.fireDebouncedSave(session), SAVE_DEBOUNCE_MS);
  }

  protected fireDebouncedSave(session: FolderDataSession): void {
    // An account's accepted edit stays parked until that account is active and freshly loaded.
    if (this.destroyed || this.dataSession !== session || !session.isActive) return;
    if (!this.canEdit || session.loadsInFlight) {
      if (this.fence.canWrite) this.armDebounce(session);
      return;
    }
    this.flushPendingSaveData();
  }

  /** Flag external writes for their captured bucket, including retained account sessions. */
  protected markExternalChanges(changes: Record<string, Storage.StorageChange>): void {
    const sessions = new Set(this.dataSessions.values());
    if (this.dataSession) sessions.add(this.dataSession);
    if (this.releasingSession) sessions.add(this.releasingSession);
    for (const session of sessions) {
      const change = changes[session.storageKey];
      if (!change) continue;
      // Recovery's own echo must not keep reconciliation alive and refresh a newer backup.
      if (this.storageEchoes.consume(session.storageKey, change.newValue)) continue;
      session.storageChangedDuringRead = true;
      session.reconcilePending = true;
      session.reconcileAttempted = false;
    }
    this.tryReconcile();
  }

  /** Reconcile external writes once this session is idle; merge pending debounced edits. */
  protected tryReconcile(): void {
    const session = this.dataSession;
    if (!session?.reconcilePending || this.destroyed || !this.fence.canWrite) return;
    if (session.pendingSave) {
      this.drainPendingSave(session);
      return;
    }
    // Only skips a reload that could not apply yet; the flag survives it, and
    // persist, `replaceData` and `loadData` call back once they settle.
    if (session.saveInProgress || session.replacingData || session.loadsInFlight > 0) return;
    session.reconcileAttempted = true;
    this.hooks.onExternalChange();
  }

  /** Unready sessions need a fresh read; failed recovery waits for a new bucket event. */
  protected reconcileAfterWrite(session: FolderDataSession, saved: boolean): void {
    if (!session.ready || saved || !session.reconcileAttempted) this.tryReconcile();
  }

  flushPendingSaveData(): void {
    if (!this.canEdit || !this.dataSession?.takeDebounce()) return;
    void this.saveData();
  }

  /** Publish a draft only after its atomic folder/companion write succeeds. */
  async replaceData(
    data: FolderData,
    companions?: Record<string, unknown>,
    beforeWrite?: FolderWriteReceipt,
  ): Promise<boolean> {
    const session = this.dataSession;
    const activation = this.accountScopeRequest;
    if (!session || !this.canEdit) return false;
    const snapshot = this.config.normalize(cloneFolderData(data));

    this.flushPendingSaveData();
    session.replacingData = true;
    session.loadVersion += 1;
    this.hooks.onChange('availability');
    let saved = false;
    try {
      // Finish accepted edits first. A draft must not replace their coalesced tail.
      const pending = session.pendingSaveCompletion?.promise ?? session.activeSave;
      if (pending) await pending;
      if (this.destroyed || this.dataSession !== session || this.accountScopeRequest !== activation)
        return false;

      session.activeSave = this.persistDataSession(
        session,
        snapshot,
        companions,
        false,
        undefined,
        beforeWrite,
      );
      saved = await session.activeSave;
      // An issued write still belongs to this session if the user has since left it.
      if (saved) session.data = snapshot;
      if (saved) session.baseline = cloneFolderData(snapshot);
      return saved;
    } finally {
      session.replacingData = false;
      if (this.dataSession === session && !this.destroyed) {
        this.hooks.onChange(saved ? 'data' : 'availability');
        this.reconcileAfterWrite(session, saved);
      } else if (!session.saveInProgress && !session.debouncePending) {
        this.dataSessions.delete(session.storageKey);
      }
      this.releaseUndoSession(session);
    }
  }

  saveData(): Promise<boolean> {
    return this.saveMemory(true);
  }

  protected async saveMemory(
    carriesEdit: boolean,
    recoveryVersion?: number,
    canRecover?: () => boolean,
    refreshPrimaryBackup = true,
  ): Promise<boolean> {
    const session = this.dataSession;
    if (
      !session ||
      !this.canEdit ||
      (recoveryVersion !== undefined && session.loadVersion !== recoveryVersion)
    )
      return false;
    try {
      this.data = this.config.normalize(this.data);
      const snapshot = cloneFolderData(session.data);
      // Recovery belongs to its current load; user mutations supersede an in-flight read.
      if (recoveryVersion === undefined) session.loadVersion += 1;
      session.markReady();
      // Backups stay off the save chain: a slow or failed copy never delays or fails a save.
      void session.backup.createEmergencyBackup(snapshot);
      if (session.saveInProgress || session.pendingSave) {
        session.pendingSave = snapshot;
        // Calls coalesced into this trailing snapshot share its storage result.
        if (!session.pendingSaveCompletion) {
          let resolve!: (saved: boolean) => void;
          const promise = new Promise<boolean>((complete) => {
            resolve = complete;
          });
          session.pendingSaveCompletion = { promise, resolve };
        }
        this.debug('Save already in progress, queueing one trailing save');
        return session.pendingSaveCompletion.promise;
      }

      session.activeSave = this.persistDataSession(
        session,
        snapshot,
        undefined,
        carriesEdit,
        canRecover,
        undefined,
        refreshPrimaryBackup,
      );
      return session.activeSave;
    } catch (error) {
      console.error(`${this.tag} Save data error:`, error);
      this.hooks.onSaveFailed?.();
      return false;
    }
  }

  protected writeSnapshot(
    key: string,
    snapshot: FolderData,
    companions: Record<string, unknown> | undefined,
    canRecover?: () => boolean,
    beforeWrite?: FolderWriteReceipt,
  ): Promise<boolean | void> {
    return this.recoveryWrites.save(key, canRecover, () =>
      beforeWrite
        ? this.storage.saveData(key, snapshot, companions, beforeWrite)
        : companions
          ? this.storage.saveData(key, snapshot, companions)
          : this.storage.saveData(key, snapshot),
    );
  }

  protected async persistDataSession(
    session: FolderDataSession,
    snapshot: FolderData,
    companions?: Record<string, unknown>,
    /** False for a draft or recovered backup: its failure leaves no local edit unsaved. */
    carriesEdit = true,
    canRecover?: () => boolean,
    beforeWrite?: FolderWriteReceipt,
    refreshPrimaryBackup = true,
  ): Promise<boolean> {
    this.dataSessions.set(session.storageKey, session);
    session.saveInProgress = true;
    const gen = ++session.writeGen;
    let success = false;
    let refused = false;
    let superseded = false;
    const serialized = serializeStoredValue(snapshot);
    let echo: StorageEcho | null = null;

    try {
      if (
        this.config.checkEmptyOverwrite &&
        snapshot.folders.length === 0 &&
        Object.keys(snapshot.folderContents).length === 0
      ) {
        // Check if we're about to overwrite non-empty data
        // Diagnostic only: unreadable or malformed buckets must not block a recovery save.
        const existingData = await this.storage.loadData(session.storageKey).catch(() => null);
        if (
          existingData &&
          validateFolderData(existingData) &&
          (existingData.folders.length > 0 || Object.keys(existingData.folderContents).length > 0)
        ) {
          console.warn(
            `${this.tag} WARNING: Attempting to save empty data over existing non-empty data`,
          );
          console.warn(`${this.tag} This may indicate a bug.`);
          // Still proceed, but log it prominently
        }
      }

      // Suppress this exact own-write echo, avoiding a redundant reload.
      echo = this.storageEchoes.arm(session.storageKey, serialized);
      success =
        (await this.writeSnapshot(
          session.storageKey,
          snapshot,
          companions,
          canRecover,
          beforeWrite,
        )) !== false;
      if (!success) this.storageEchoes.disarm(echo);

      if (!success && this.config.retryFailedSave) {
        console.warn(`${this.tag} Save failed, retrying once...`);
        echo = this.storageEchoes.arm(session.storageKey, serialized);
        success =
          (await this.writeSnapshot(
            session.storageKey,
            snapshot,
            companions,
            canRecover,
            beforeWrite,
          )) !== false;
        if (!success) this.storageEchoes.disarm(echo);
      }

      if (success) {
        session.baseline = cloneFolderData(snapshot);
        // A recovery copy must not replace a primary another context changed during recovery.
        if (refreshPrimaryBackup) void session.backup.createPrimaryBackup(snapshot);
        this.debug('Data saved successfully');
        // Every persistence path refreshes the floating panel through this hook.
        if (this.dataSession === session && !this.destroyed) {
          this.hooks.onChange('saved');
        }
      } else {
        console.error(`${this.tag} Save failed after retry`);
      }
    } catch (error) {
      refused = error instanceof LegacyFolderWriteRefusedError;
      superseded = error instanceof FolderRecoverySupersededError;
      if (!refused && !superseded) console.error(`${this.tag} Save data error:`, error);
      this.storageEchoes.disarm(echo);
      success = false;
    } finally {
      if (success) session.settleFailedEdit(gen);
      else if (carriesEdit && !refused && !superseded) session.failedEditGen = gen;
      // Recovery retains failed edits in memory, then rereads canonical when authority returns.
      if (refused && carriesEdit && !canRecover && !this.fence.reloadRequired && !this.destroyed) {
        session.pendingSave ??= snapshot;
      }
      // A newer queued snapshot can still persist this edit; report only a final failure.
      // A refused write already has a fence notice; do not cover it with a save-failed notice.
      if (
        !success &&
        !superseded &&
        this.fence.canWrite &&
        this.dataSession === session &&
        !session.pendingSave
      ) {
        this.hooks.onSaveFailed?.();
      }
      session.saveInProgress = false;
      if (this.destroyed && !this.fence.canWrite) {
        session.cancelPendingSave();
      }
      session.activeSave = null;
      if (this.fence.canWrite) this.drainPendingSave(session);
      // A later accepted debounce still belongs to this session after its older write settles.
      if (
        !session.pendingSave &&
        !session.saveInProgress &&
        !session.debouncePending &&
        this.dataSession !== session &&
        this.releasingSession !== session &&
        !session.replacingData
      ) {
        this.dataSessions.delete(session.storageKey);
      }
      this.releaseUndoSession(session);
    }
    if (this.dataSession === session && !session.replacingData) {
      this.hooks.onPersistSettled?.();
      if (!session.saveInProgress) this.reconcileAfterWrite(session, success);
    }

    return success;
  }

  protected drainPendingSave(session: FolderDataSession): void {
    if (!this.fence.canWrite || session.saveInProgress || !session.pendingSave) return;
    const snapshot = session.pendingSave;
    const completion = session.pendingSaveCompletion;
    session.pendingSave = null;
    session.pendingSaveCompletion = null;
    void session.backup.createEmergencyBackup(snapshot);
    session.activeSave = this.persistDataSession(session, snapshot);
    void session.activeSave.then((saved) => {
      if (!completion) return;
      if (
        !saved &&
        session.pendingSave &&
        !this.fence.canWrite &&
        !this.fence.reloadRequired &&
        !this.destroyed
      ) {
        if (session.pendingSaveCompletion)
          void session.pendingSaveCompletion.promise.then(completion.resolve);
        else session.pendingSaveCompletion = completion;
      } else completion.resolve(saved);
    });
  }
}
