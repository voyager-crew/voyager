import type { Storage } from 'webextension-polyfill';

import {
  type AccountScope,
  accountIsolationService,
} from '@/core/services/AccountIsolationService';
import { validateFolderData } from '@/features/folder/model/folderData';
import { AUTHORITY_FENCE_KEY } from '@/features/folder/owner/authorityFence';
import { LegacyFolderFence } from '@/features/folder/owner/legacyFolderFence';

import { FolderDataSession } from './FolderDataSession';
import { FolderRecoveryWriteGuard } from './FolderRecoveryWriteGuard';
import { type FolderRepositoryHooks, createDebugLog } from './folderRepositoryHooks';
import type { PlatformFolderConfig } from './platformFolderConfig';
import type { IFolderStorageAdapter } from './storage/FolderStorageAdapter';
import { StorageEchoTracker } from './storage/StorageEchoTracker';
import type { FolderWriter } from './storage/folderWriter';
import type { FolderData } from './types';

/**
 * `FolderRepository`'s state: its sessions, fence, retry bookkeeping and the
 * storage listener. The repository is split by responsibility into layers
 * over this one state owner: saves (`FolderRepositorySaves`), loads and
 * recovery (`FolderRepositoryLoads`), and the lifecycle and account scope
 * (`FolderRepository`).
 */
export abstract class FolderRepositoryState {
  protected readonly fence: LegacyFolderFence;
  protected readonly storage: IFolderStorageAdapter;
  protected readonly recoveryWrites: FolderRecoveryWriteGuard;
  readonly writeFolder: FolderWriter;
  protected readonly initializations = new Map<string, Promise<void>>();
  protected dataSession: FolderDataSession | null;
  protected readonly dataSessions = new Map<string, FolderDataSession>();
  protected unresolvedData: FolderData = { folders: [], folderContents: {} };
  protected accountScopeRequest = 0;
  protected scopeRefreshPending = false;
  protected accountScopeRetry: number | null = null;
  protected accountScopeRetryAttempt = 0;
  protected accountScopeRetrying = false;
  protected readRetry: number | null = null;
  protected readRetryAttempt = 0;
  protected isolationEnabled = false;
  protected resolvedAccountScope: AccountScope | null = null;
  protected activeStorageKey: string;
  protected destroyed = false;
  protected readonly storageEchoes = new StorageEchoTracker();
  /** The session a scope refresh released, still told about writes until it rebinds. */
  protected releasingSession: FolderDataSession | null = null;
  protected beforeUnloadFlushHandler: (() => void) | null = null;
  protected readonly tag: string;
  protected readonly debug: (...args: unknown[]) => void;
  protected readonly debugWarn: (...args: unknown[]) => void;
  protected readonly storageChangeHandler = (
    changes: Record<string, Storage.StorageChange>,
    area: string,
  ): void => {
    if (this.destroyed) return;
    if (area === 'local') {
      if (changes[AUTHORITY_FENCE_KEY]) this.fence.observe(changes[AUTHORITY_FENCE_KEY].newValue);
      this.markExternalChanges(changes);
    }
    if (area === 'sync' && this.config.isolationSettingKeys.some((key) => changes[key])) {
      void accountIsolationService
        .isIsolationEnabled({
          platform: this.config.platform,
          pageUrl: window.location.href,
        })
        .then((enabled) => this.setAccountIsolationEnabled(enabled));
    }
  };

  constructor(
    protected readonly config: PlatformFolderConfig,
    storage: IFolderStorageAdapter,
    protected readonly hooks: FolderRepositoryHooks,
  ) {
    this.fence = new LegacyFolderFence(config.storageKey, () => this.fenceChanged());
    this.storage = storage;
    this.recoveryWrites = new FolderRecoveryWriteGuard((_key, operation) =>
      this.fence.write(operation),
    );
    this.writeFolder = this.recoveryWrites.write;
    storage.setWriteGate?.(this.writeFolder);
    this.dataSession = new FolderDataSession(
      config.storageKey,
      config.backupNamespace,
      null,
      validateFolderData,
      () => this.fence.canWrite,
      (operation) => this.fence.write(operation),
    );
    this.activeStorageKey = config.storageKey;
    this.tag = config.logPrefix;
    this.debug = createDebugLog(config, 'log');
    this.debugWarn = createDebugLog(config, 'warn');
  }

  get data(): FolderData {
    return this.dataSession?.data ?? this.unresolvedData;
  }
  set data(value: FolderData) {
    if (this.dataSession) this.dataSession.data = value;
    else this.unresolvedData = value;
  }
  get session(): FolderDataSession | null {
    return this.dataSession;
  }
  get canEdit(): boolean {
    const session = this.dataSession;
    return (
      !this.destroyed &&
      this.fence.canWrite &&
      !!session?.ready &&
      !session.replacingData &&
      !session.readFailed
    );
  }
  get activation(): number {
    return this.accountScopeRequest;
  }
  get storageKey(): string {
    return this.activeStorageKey;
  }
  get accountScope(): AccountScope | null {
    return this.resolvedAccountScope;
  }
  get accountIsolationEnabled(): boolean {
    return this.isolationEnabled;
  }
  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /** Flag external writes for their captured bucket (`FolderRepositorySaves`). */
  protected abstract markExternalChanges(changes: Record<string, Storage.StorageChange>): void;
  /** Release undo admission once an inactive session has drained its accepted work. */
  protected abstract releaseUndoSession(session: FolderDataSession): void;
  abstract setAccountIsolationEnabled(enabled: boolean): Promise<void>;
  /** The write authority changed (`FolderRepository`). */
  protected abstract fenceChanged(): void;
}
