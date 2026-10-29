import browser from 'webextension-polyfill';

import {
  type AccountContext,
  type AccountScope,
  accountIsolationService,
  buildScopedStorageKey,
  detectAccountContextFromDocument,
} from '@/core/services/AccountIsolationService';
import { validateFolderData } from '@/features/folder/model/folderData';
import { LegacyFolderWriteRefusedError } from '@/features/folder/owner/legacyFolderFence';

import { FolderDataSession } from './FolderDataSession';
import { FolderRepositoryLoads } from './FolderRepositoryLoads';

export {
  type FolderRepositoryHooks,
  type FolderStoreChange,
  folderDebug,
  folderDebugWarn,
} from './folderRepositoryHooks';

/** Growing gaps between account-scope retries, in ms. Length caps the attempts. */
const ACCOUNT_SCOPE_RETRY_DELAYS = [400, 1200, 3000] as const;

/** Owns platform sessions, load/recovery, serialized writes, echoes and scope retry. */
export class FolderRepository extends FolderRepositoryLoads {
  async init(): Promise<void> {
    this.watchStorage();
    // A refused migration must still allow account binding to use its normal retry path.
    await this.initializeStorage(this.config.storageKey).catch((error) => {
      if (this.fence.canWrite) throw error;
    });
    if (this.destroyed) return;
    this.beforeUnloadFlushHandler = () => this.flushPendingSaveData();
    window.addEventListener('beforeunload', this.beforeUnloadFlushHandler);
    await this.loadAccountIsolationSetting();
    if (this.destroyed) return;
    await this.refreshAccountScope();
    await this.loadData();
  }

  /** Reload on writes to the active bucket from other contexts. */
  watchStorage(): void {
    if (!this.destroyed) browser.storage.onChanged.addListener(this.storageChangeHandler);
  }

  /** Suspend edits and invalidate in-flight reads; account refresh resumes the session. */
  suspend(): void {
    this.flushPendingSaveData();
    // Cached memory is not an authoritative snapshot until the resumed session loads again.
    if (this.dataSession) {
      this.dataSession.ready = false;
      this.dataSession.reconcilePending = true;
    }
    this.clearAccountScopeRetry();
    this.clearReadRetry();
    this.dataSession?.deactivate();
    if (this.dataSession) this.releaseUndoSession(this.dataSession);
    this.accountScopeRequest += 1;
  }

  /**
   * Stops edits, timers and listeners at once. The returned drain resolves once
   * every write already accepted, and its backups, settled: whoever opens this
   * bucket next waits for it, so two repositories never write one key at once.
   */
  destroy(): Promise<void> {
    // Accept the final debounce before disabling edits and cancelling retry timers.
    this.flushPendingSaveData();
    this.destroyed = true;
    this.clearAccountScopeRetry();
    this.clearReadRetry();
    this.dataSession?.deactivate();
    this.accountScopeRequest += 1;
    browser.storage.onChanged.removeListener(this.storageChangeHandler);
    if (this.beforeUnloadFlushHandler)
      window.removeEventListener('beforeunload', this.beforeUnloadFlushHandler);
    this.beforeUnloadFlushHandler = null;
    this.fence.close();
    // Teardown stops new edits; already accepted writes still need their fresh authority checks.
    const sessions = new Set(this.dataSessions.values());
    if (this.dataSession) sessions.add(this.dataSession);
    return Promise.all(
      [...sessions].map(async (session) => {
        // Parked work has no drain once teardown stops authority retries.
        if (!session.saveInProgress || !this.fence.canWrite) session.cancelPendingSave();
        await this.undoSessionCompletion(session);
        await (session.pendingSaveCompletion?.promise ?? session.activeSave);
        await session.backup.finishPendingWrites();
      }),
    )
      .then(() => undefined)
      .finally(() => {
        this.stopUndoOwners();
        this.fence.destroy();
      });
  }

  /** Record the isolation switch without rebinding; the caller refreshes the scope. */
  setAccountIsolationFlag(enabled: boolean): void {
    this.isolationEnabled = enabled;
  }

  async setAccountIsolationEnabled(enabled: boolean): Promise<void> {
    if (this.destroyed || enabled === this.isolationEnabled) return;
    this.isolationEnabled = enabled;
    await this.refreshAccountScope();
    await this.loadData();
    if (this.hooks.isEnabled()) this.hooks.onChange('data');
  }

  protected async initializeStorage(key: string): Promise<void> {
    if (!(await this.fence.check())) throw new LegacyFolderWriteRefusedError();
    let initialization = this.initializations.get(key);
    if (!initialization) {
      initialization = this.storage.init(key).catch((error) => {
        this.initializations.delete(key);
        throw error;
      });
      this.initializations.set(key, initialization);
    }
    await initialization;
  }

  protected async loadAccountIsolationSetting(): Promise<void> {
    try {
      this.isolationEnabled = await accountIsolationService.isIsolationEnabled({
        platform: this.config.platform,
        pageUrl: window.location.href,
      });
      this.debug('Loaded account isolation setting:', this.isolationEnabled);
    } catch (error) {
      console.error(`${this.tag} Failed to load account isolation setting:`, error);
      this.isolationEnabled = false;
    }
  }

  async refreshAccountScope(): Promise<void> {
    // A reload-required tab must keep the unsaved session rather than release it for rebinding.
    if (this.fence.reloadRequired || this.destroyed) return;
    this.scopeRefreshPending = true;
    const request = ++this.accountScopeRequest;
    this.clearAccountScopeRetry();
    this.clearReadRetry();
    if (!this.accountScopeRetrying) this.accountScopeRetryAttempt = 0;
    const previous = this.dataSession ?? this.releasingSession;
    // Flush the old account's pending debounce before releasing its data owner.
    this.flushPendingSaveData();
    previous?.deactivate();
    if (previous) this.releaseUndoSession(previous);
    this.releasingSession = previous;
    if (
      previous &&
      this.dataSession === previous &&
      this.fence.canWrite &&
      !previous.saveInProgress &&
      !previous.pendingSave &&
      !previous.debouncePending &&
      !previous.replacingData
    ) {
      this.dataSessions.delete(previous.storageKey);
    }
    this.dataSession = null;
    this.unresolvedData = { folders: [], folderContents: {} };
    this.resolvedAccountScope = null;
    this.activeStorageKey = '';
    this.hooks.onAccountReleased();
    this.hooks.onChange('account');
    // An unknown account owns no bucket: resolving it now could claim another account's data.
    if (this.isolationEnabled && this.hooks.canBindAccount?.() === false) {
      this.debug('Account not known yet; nothing bound');
      return;
    }
    let storageKey: string | null = null;
    try {
      let resolvedScope: AccountScope | null = null;
      let context: AccountContext | null = null;
      if (this.isolationEnabled) {
        context = detectAccountContextFromDocument(window.location.href, document);
        resolvedScope = await accountIsolationService.resolveAccountScope({
          pageUrl: window.location.href,
          routeUserId: context.routeUserId,
          email: context.email,
        });
      }
      if (request !== this.accountScopeRequest || this.destroyed) return;
      storageKey = resolvedScope
        ? buildScopedStorageKey(this.config.storageKey, resolvedScope.accountKey)
        : this.config.storageKey;
      // Resolve visibility even while authority is unavailable; binding waits for its timer.
      if (!this.fence.canWrite) throw new LegacyFolderWriteRefusedError();
      await this.initializeStorage(storageKey);
      if (request !== this.accountScopeRequest || this.destroyed) return;
      const session =
        this.dataSessions.get(storageKey) ??
        (previous?.storageKey === storageKey
          ? previous
          : new FolderDataSession(
              storageKey,
              this.config.backupNamespace,
              resolvedScope,
              validateFolderData,
              () => this.fence.canWrite,
              (operation) => this.fence.write(operation),
            ));
      this.dataSessions.set(storageKey, session);
      session.accountScope = resolvedScope;
      this.dataSession = session;
      this.releasingSession = null;
      this.scopeRefreshPending = false;
      this.resolvedAccountScope = resolvedScope;
      this.activeStorageKey = storageKey;
      this.hooks.onAccountBound?.(context);
      // A disabled rebind may have loaded before another context wrote this cached session.
      if (session.reconcilePending || session.debouncePending) session.ready = false;
      session.activate();
      this.registerUndoSession(session);
      this.accountScopeRetryAttempt = 0;
      if (session.ready) {
        this.hooks.onChange('title');
        this.hooks.onChange('loaded');
      }
      // A rebound session may hold a write observed before or during the switch.
      this.tryReconcile();
      if (session.readFailed) this.scheduleReadRetry(session);
    } catch (error) {
      if (request !== this.accountScopeRequest || this.destroyed) return;
      if (previous) {
        previous.ready = false;
        previous.reconcilePending = true;
        // Show retained edits only for the resolved bucket; persistence stays unbound until retry.
        if (storageKey === previous.storageKey) {
          this.unresolvedData = previous.data;
          this.hooks.onChange('availability');
        }
      }
      console.error(`${this.tag} Failed to resolve account scope:`, error);
      // Keep persistence unbound on failure. A global fallback has no known owner.
      if (this.fence.canWrite) this.scheduleAccountScopeRetry(request);
    }
  }

  /** Retry background scope resolution; an ownerless global fallback could overwrite another account. */
  protected scheduleAccountScopeRetry(request: number): void {
    if (this.destroyed || request !== this.accountScopeRequest) return;
    const delay = ACCOUNT_SCOPE_RETRY_DELAYS[this.accountScopeRetryAttempt];
    if (delay === undefined) return;
    this.accountScopeRetryAttempt += 1;
    this.accountScopeRetry = window.setTimeout(() => {
      this.accountScopeRetry = null;
      if (this.destroyed || request !== this.accountScopeRequest) return;
      void this.retryAccountScope();
    }, delay);
  }

  protected async retryAccountScope(): Promise<void> {
    this.accountScopeRetrying = true;
    try {
      await this.refreshAccountScope();
    } finally {
      this.accountScopeRetrying = false;
    }
    if (this.destroyed || !this.dataSession) return;
    await this.loadData();
    if (this.destroyed) return;
    this.hooks.onChange('title');
    this.hooks.onChange('data');
  }

  protected clearAccountScopeRetry(): void {
    if (this.accountScopeRetry === null) return;
    window.clearTimeout(this.accountScopeRetry);
    this.accountScopeRetry = null;
  }

  protected fenceChanged(): void {
    const sessions = new Set(this.dataSessions.values());
    if (this.dataSession) sessions.add(this.dataSession);
    if (this.releasingSession) sessions.add(this.releasingSession);
    if (!this.fence.canWrite) {
      this.clearAccountScopeRetry();
      this.clearReadRetry();
      for (const session of sessions) {
        session.loadVersion += 1;
        session.backup.destroy();
        session.pauseDebounce();
      }
      if (this.fence.reloadRequired) {
        this.accountScopeRequest += 1;
        if (this.releasingSession) {
          this.dataSession = this.releasingSession;
          this.releasingSession = null;
          this.activeStorageKey = this.dataSession.storageKey;
          this.resolvedAccountScope = this.dataSession.accountScope;
        }
        for (const session of sessions) {
          session.cancelPendingSave();
        }
      } else this.hooks.onRecovery('unreadable');
    } else {
      // Run after the authority check settles; accepted writes drain before any fresh read.
      void Promise.resolve().then(async () => {
        if (this.destroyed || !this.fence.canWrite) return;
        for (const session of sessions) this.drainPendingSave(session);
        if (!this.dataSession || this.scopeRefreshPending) await this.refreshAccountScope();
        if (this.dataSession?.ready) this.dataSession.markReady();
        await this.loadData();
      });
    }
    this.hooks.onChange('availability');
  }
}
