import { isUndoneCloudSyncValue } from '@/core/services/CloudSyncUndoMarkers';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';
import { cloneFolderData, validateFolderData } from '@/features/folder/model/folderData';

import type { FolderDataSession } from './FolderDataSession';
import { FolderRepositoryUndo } from './FolderRepositoryUndo';
import { mergeDebouncedEdits } from './debouncedEditMerge';
import type { FolderData } from './types';

/** Growing gaps between reads after a failed one, in ms. The last gap repeats until a read lands. */
const READ_RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000] as const;

/** `FolderRepository`'s reads: load, scoped migration, recovery and read retries. */
export abstract class FolderRepositoryLoads extends FolderRepositoryUndo {
  async loadData(): Promise<void> {
    const session = this.dataSession;
    if (!session?.isActive || !this.fence.canWrite || this.destroyed) return;
    const pending = session.pendingSave;
    if (pending) {
      try {
        if (
          (await isUndoneCloudSyncValue({
            area: 'local',
            key: session.storageKey,
            value: pending,
          })) &&
          session.pendingSave === pending
        ) {
          session.cancelPendingSave();
        }
      } catch (error) {
        if (this.dataSession === session && session.isActive && !this.destroyed)
          this.markReadUnavailable(session, error);
        return;
      }
    }
    if (this.dataSession !== session || !session.isActive || !this.fence.canWrite || this.destroyed)
      return;
    if (session.pendingSave) {
      this.drainPendingSave(session);
      return;
    }
    if (session.saveInProgress || session.replacingData) {
      // Accepted writes must drain before a resumed read; their settlement triggers the reload.
      if (!session.ready) session.reconcilePending = true;
      return;
    }
    const version = ++session.loadVersion;
    // A fenced reload must not replace the unsaved memory retained for the reload notice.
    const isCurrent = () =>
      this.fence.canWrite &&
      this.dataSession === session &&
      session.isActive &&
      session.loadVersion === version &&
      !this.destroyed;
    session.loadsInFlight += 1;
    session.storageChangedDuringRead = false;
    session.reconcileAttempted = true;
    const writesBefore = session.writeGen;
    let applied = false; // a valid read or recovery applied
    let recovering = false; // recovery's own write supersedes this read; it is not discarded
    try {
      let loadedData: FolderData | null;
      try {
        loadedData = await this.storage.loadData(session.storageKey);
        if (!(await this.fence.check()) || !isCurrent()) return;
        await this.discardUndoneMemory(session, version);
        if (!isCurrent()) return;
        // A resumed snapshot stays unavailable until a read unaffected by bucket events lands.
        if (!session.ready && session.storageChangedDuringRead) {
          // Reuse read backoff so continuous external writes cannot cause an immediate reload loop.
          this.scheduleReadRetry(session);
          return;
        }
        if (!loadedData && session.accountScope) {
          loadedData = await this.migrateLegacyFolderDataToScopedStorage(session, version);
          if (!isCurrent()) return;
        }
      } catch (error) {
        // Unreadable storage may hold newer data: leave it untouched, show memory read-only and retry.
        if (!isCurrent()) return;
        this.markReadUnavailable(session, error);
        return;
      }
      session.readFailed = false;

      if (loadedData && validateFolderData(loadedData)) {
        // Validate and repair data integrity
        const fresh = this.config.normalize(loadedData);
        const base = session.baseline;
        session.baseline = cloneFolderData(fresh);
        // Edits still waiting on the debounce were made after `base`; keep them.
        if (session.debouncePending && base) mergeDebouncedEdits(fresh, this.data, base);
        // Readable storage wins on resumption; failed edits are retained only for recovery.
        this.data = fresh;

        // Clean up orphaned folderContents (folders that no longer exist)
        if (this.config.pruneOrphanBuckets) {
          const validFolderIds = new Set(this.data.folders.map((f) => f.id));
          validFolderIds.add(this.config.rootBucketId); // Keep root conversations
          Object.keys(this.data.folderContents).forEach((folderId) => {
            if (!validFolderIds.has(folderId)) {
              this.debugWarn(`Removing orphaned folderContents for: ${folderId}`);
              delete this.data.folderContents[folderId];
            }
          });
        }

        // Create primary backup on successful load
        void session.backup.createPrimaryBackup(this.data);
        await session.backup.finishLocalWrites();
        // Suspension or a newer load during backup authorization cannot restore readiness.
        if (!isCurrent()) return;
        session.markReady();
        if (session.debouncePending) this.armDebounce(session);
        applied = true;

        this.debug('Data loaded and validated successfully');
      } else if (loadedData) {
        // Data exists but validation failed - this is a real corruption case
        console.warn(
          `${this.tag} Storage returned invalid data structure, attempting recovery from backup`,
        );
        recovering = true;
        applied = await this.attemptDataRecovery(
          { reason: 'corrupted', originalData: loadedData },
          session,
        );
      } else if (session.failedEditGen !== null || this.config.recoverMissingData) {
        console.warn(`${this.tag} Storage returned no data, attempting recovery from backup`);
        recovering = true;
        applied = await this.attemptDataRecovery(null, session);
      } else {
        // No data found - likely a first-time user
        console.log(
          `${this.tag} No folder data found, initializing empty state (likely first-time user)`,
        );
        this.data = { folders: [], folderContents: {} };
        // No canonical members remain to receive debounced expansion or activity edits.
        session.takeDebounce();
        session.markReady();
        applied = true;
        // No notification needed - this is expected for new users
      }
    } catch (error) {
      if (!isCurrent()) return;
      console.error(`${this.tag} Load data error:`, error);

      // CRITICAL: Do NOT clear data on error - this causes data loss!
      // Instead, try to recover from backup or keep existing data
      recovering = true;
      applied = await this.attemptDataRecovery(error, session);
    } finally {
      session.loadsInFlight -= 1;
      if (applied && isCurrent()) this.clearReadRetry();
      // A bucket event during this read still needs a fresh answer.
      if (applied && isCurrent() && !session.storageChangedDuringRead)
        session.reconcilePending = false;
      // Only the current load settles older failed edits; recovery writes settle their own generation.
      if (applied && isCurrent()) session.settleFailedEdit(writesBefore);
      if (isCurrent() && session.ready) {
        this.hooks.onChange('loaded');
      }
      // Failed recovery waits for a bucket event or settled write; a suspended load stays parked.
      if (
        this.dataSession === session &&
        session.isActive &&
        (applied || (!isCurrent() && !recovering))
      ) {
        this.tryReconcile();
      }
    }
  }

  protected async migrateLegacyFolderDataToScopedStorage(
    session: FolderDataSession,
    version: number,
  ): Promise<FolderData | null> {
    // A failed read rejects: binding an empty account bucket would end this migration for good.
    const legacyData = await this.storage.loadData(this.config.storageKey);
    try {
      if (
        this.dataSession !== session ||
        session.loadVersion !== version ||
        !legacyData ||
        !validateFolderData(legacyData)
      ) {
        return null;
      }

      const migratedData = this.config.normalize(
        this.config.migrateLegacyData(legacyData, session.accountScope),
      );
      // Compare the candidate to its destination, not the legacy bucket that still owns its copy.
      if (
        (await isUndoneCloudSyncValue({
          area: 'local',
          key: session.storageKey,
          value: migratedData,
        })) ||
        this.dataSession !== session ||
        session.loadVersion !== version ||
        !session.isActive ||
        !this.fence.canWrite ||
        this.destroyed
      )
        return null;
      session.data = migratedData;
      session.markReady();
      // Migrated legacy data is no local edit: a failed write must not outrank a newer backup.
      session.activeSave = this.persistDataSession(
        session,
        cloneFolderData(session.data),
        undefined,
        false,
      );
      const saved = await session.activeSave;
      if (!saved) {
        console.warn(`${this.tag} Failed to persist scoped migration data`);
      }
      this.debug(
        'Migrated legacy folder data to scoped storage:',
        session.storageKey,
        migratedData.folders.length,
      );
      return migratedData;
    } catch (error) {
      console.error(`${this.tag} Failed to migrate legacy folder data:`, error);
      return null;
    }
  }

  /** Returns whether storage now holds the recovered data. */
  protected async attemptDataRecovery(
    error: unknown,
    session: FolderDataSession,
  ): Promise<boolean> {
    if (this.dataSession !== session) return false;
    const version = session.loadVersion;
    const canRecover = () => {
      if (
        this.dataSession !== session ||
        session.loadVersion !== version ||
        !session.isActive ||
        !this.fence.canWrite ||
        this.destroyed
      )
        return false;
      // Recovery must never write an older backup over a canonical change during an await.
      if (session.storageChangedDuringRead) {
        this.scheduleReadRetry(session);
        return false;
      }
      return true;
    };
    if (!canRecover()) return false;
    console.warn(`${this.tag} Attempting data recovery after load failure`);

    // Failed local edits outrank backups when storage is corrupt.
    if (session.failedEditGen !== null && validateFolderData(this.data)) {
      this.data = this.config.normalize(this.data);
      session.markReady();
      this.hooks.onRecovery('kept');
      return this.saveMemory(true, version, canRecover);
    }

    // Step 1: Read both stores, including durable copies that cannot fit in localStorage.
    await session.backup.ensureHydrated();
    if (!canRecover()) return false;
    let recovered: FolderData | null;
    try {
      recovered = await session.backup.recoverFromBackupForKey(session.storageKey, canRecover);
    } catch (error) {
      if (canRecover()) this.markReadUnavailable(session, error);
      return false;
    }
    if (!canRecover()) return false;
    if (!(await this.fence.check()) || !canRecover()) return false;
    if (recovered && validateFolderData(recovered)) {
      this.data = this.config.normalize(recovered);
      session.markReady();
      console.warn(`${this.tag} Data recovered from backup`);
      this.hooks.onRecovery('recovered');
      // Save recovered data to persistent storage. It is the backup, not a local edit:
      // its failure must not outrank a newer backup another tab may write meanwhile.
      // The durable bridge cannot compare-write; keep primary copies other contexts may refresh.
      return this.saveMemory(false, version, canRecover, false);
    }

    // Step 2: If current this.data already has valid structure, keep it
    if (validateFolderData(this.data) && this.data.folders.length > 0) {
      console.warn(`${this.tag} Keeping existing in-memory data after load error`);
      this.data = this.config.normalize(this.data);
      session.markReady();
      this.hooks.onRecovery('kept');
      return false;
    }

    // Step 3: Last resort - initialize empty data and log critical error
    console.error(`${this.tag} CRITICAL: Unable to recover data, initializing empty state`);
    console.error(`${this.tag} Original error:`, error);
    this.data = { folders: [], folderContents: {} };
    session.markReady();

    // Show user notification about data loss
    this.hooks.onRecovery('lost');
    return false;
  }

  private markReadUnavailable(session: FolderDataSession, error: unknown): void {
    console.error(`${this.tag} Failed to read folder data; storage left untouched:`, error);
    const firstReadFailure = !session.readFailed;
    session.readFailed = true;
    this.hooks.onChange('availability');
    if (firstReadFailure) this.hooks.onRecovery('unreadable');
    if (!isExtensionContextInvalidatedError(error)) this.scheduleReadRetry(session);
  }

  /** Drop only the exact undone in-memory copy; differing unsaved edits remain recoverable. */
  private async discardUndoneMemory(session: FolderDataSession, version: number): Promise<void> {
    const candidate = JSON.stringify(session.data);
    const undone = await isUndoneCloudSyncValue({
      area: 'local',
      key: session.storageKey,
      value: candidate,
    });
    if (
      !undone ||
      this.dataSession !== session ||
      session.loadVersion !== version ||
      !session.isActive ||
      !this.fence.canWrite ||
      this.destroyed ||
      JSON.stringify(session.data) !== candidate
    )
      return;
    session.data = { folders: [], folderContents: {} };
    session.baseline = null;
    session.failedEditGen = null;
    session.cancelPendingSave();
  }

  /** Read `session`'s bucket again through the owner's reload, so a recovered read repaints. */
  protected scheduleReadRetry(session: FolderDataSession): void {
    if (this.destroyed || this.readRetry !== null) return;
    const delay = READ_RETRY_DELAYS[Math.min(this.readRetryAttempt, READ_RETRY_DELAYS.length - 1)];
    this.readRetryAttempt += 1;
    this.readRetry = window.setTimeout(() => {
      this.readRetry = null;
      if (!this.destroyed && this.dataSession === session) this.hooks.onExternalChange();
    }, delay);
  }

  protected clearReadRetry(): void {
    this.readRetryAttempt = 0;
    if (this.readRetry === null) return;
    window.clearTimeout(this.readRetry);
    this.readRetry = null;
  }
}
