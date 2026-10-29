import { registerCloudSyncUndoOwner } from '@/core/services/CloudSyncUndoOwners';
import { LegacyFolderWriteRefusedError } from '@/features/folder/owner/legacyFolderFence';

import type { FolderDataSession } from './FolderDataSession';
import { FolderRepositorySaves } from './FolderRepositorySaves';

/** Admits raw snapshot restoration alongside a session's existing accepted saves. */
export abstract class FolderRepositoryUndo extends FolderRepositorySaves {
  private readonly undoOwners = new Map<FolderDataSession, () => void>();
  private readonly undoAdmissions = new Map<FolderDataSession, Promise<void>>();

  protected registerUndoSession(session: FolderDataSession): void {
    if (this.undoOwners.has(session)) return;
    this.undoOwners.set(
      session,
      registerCloudSyncUndoOwner(
        session.storageKey,
        (operation) => this.runUndo(session, operation),
        () => {
          if (!this.fence.canWrite) throw new LegacyFolderWriteRefusedError();
        },
      ),
    );
  }

  protected releaseUndoSession(session: FolderDataSession): void {
    if (session.isActive || session.saveInProgress || session.pendingSave || session.replacingData)
      return;
    this.undoOwners.get(session)?.();
    this.undoOwners.delete(session);
    if (
      !session.debouncePending &&
      this.dataSession !== session &&
      this.releasingSession !== session
    )
      this.dataSessions.delete(session.storageKey);
  }

  protected stopUndoOwners(): void {
    for (const stop of this.undoOwners.values()) stop();
    this.undoOwners.clear();
  }

  protected undoSessionCompletion(session: FolderDataSession): Promise<void> | undefined {
    return this.undoAdmissions.get(session);
  }

  private async runUndo<T>(session: FolderDataSession, operation: () => Promise<T>): Promise<T> {
    const activation = this.accountScopeRequest;
    const requireCurrent = () => {
      if (
        this.destroyed ||
        this.dataSession !== session ||
        this.accountScopeRequest !== activation ||
        !session.isActive ||
        !this.fence.canWrite
      )
        throw new Error('Folder undo owner is unavailable');
    };
    const waitForSave = async () => {
      const saving = session.pendingSaveCompletion?.promise ?? session.activeSave;
      if (!saving) throw new Error('Folder undo is waiting for unavailable writes');
      await saving;
      requireCurrent();
    };
    requireCurrent();
    // An earlier undo owns the barrier even while it is still checking authority.
    while (session.replacingData) {
      const admitted = this.undoAdmissions.get(session);
      if (admitted) {
        await admitted;
        requireCurrent();
      } else await waitForSave();
    }
    let complete!: () => void;
    const completion = new Promise<void>((resolve) => {
      complete = resolve;
    });
    this.undoAdmissions.set(session, completion);
    session.pauseDebounce();
    session.replacingData = true;
    session.loadVersion += 1;
    try {
      this.hooks.onChange('availability');
      while (session.saveInProgress || session.pendingSave) {
        if (!session.saveInProgress) this.drainPendingSave(session);
        await waitForSave();
      }
      if (!(await this.fence.check())) throw new Error('Folder undo owner is unavailable');
      requireCurrent();
      session.saveInProgress = true;
      const restoring = (async () => operation())();
      session.activeSave = restoring.then(
        () => true,
        () => false,
      );
      try {
        return await restoring;
      } finally {
        session.saveInProgress = false;
        session.activeSave = null;
      }
    } finally {
      session.replacingData = false;
      this.undoAdmissions.delete(session);
      try {
        if (this.dataSession === session && !this.destroyed) {
          this.hooks.onChange('availability');
          this.tryReconcile();
          if (session.debouncePending && !session.reconcilePending) this.armDebounce(session);
        }
        this.releaseUndoSession(session);
      } finally {
        complete();
      }
    }
  }
}
