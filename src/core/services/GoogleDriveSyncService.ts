/** Owns one session-bound queue and the shared Drive file cache. */
import type { SyncMode, SyncProvider, SyncState } from '@/core/types/sync';
import { DEFAULT_SYNC_STATE } from '@/core/types/sync';
import { requestSafariGoogleDriveSession } from '@/core/utils/safariGoogleDrive';
import { createWriteQueue } from '@/features/storage/writeQueue';

import { GoogleDriveAuth, isSafariRuntime } from './GoogleDriveAuth';
import { GoogleDriveBackupFolder } from './GoogleDriveBackupFolder';
import { GoogleDriveFiles } from './GoogleDriveFiles';
import { BACKUP_FOLDER_RECOVERY_FILE_NAMES } from './GoogleDriveSyncPayloads';
import { GoogleDriveSyncSession } from './GoogleDriveSyncSession';
import { loadPersistedSyncState, savePersistedSyncState } from './GoogleDriveSyncStateStorage';
import type { GoogleDriveSyncTransfer } from './GoogleDriveSyncTransfer';
import { createGoogleDriveTurnPort } from './GoogleDriveTurnPort';
import { logger } from './LoggerService';
import { settleGoogleDriveConnect } from './googleDriveConnectIntent';

export class GoogleDriveSyncService {
  private readonly serialize = createWriteQueue();
  private session = new GoogleDriveSyncSession();
  private transferSession: GoogleDriveSyncSession | null = null;
  private state: SyncState = { ...DEFAULT_SYNC_STATE };
  private stateChangeCallback: ((state: SyncState) => void) | null = null;
  private readonly stateLoadPromise: Promise<void>;
  private nativeAuthorizationRead: { session: GoogleDriveSyncSession; read: Promise<void> } | null =
    null;
  private readonly auth = new GoogleDriveAuth(() => this.state.provider);
  private readonly files = new GoogleDriveFiles(
    new GoogleDriveBackupFolder(BACKUP_FOLDER_RECOVERY_FILE_NAMES),
    {
      getProvider: () =>
        this.transferSession ? this.transferSession.provider : this.state.provider,
      getDriveAccount: () => this.transferSession ?? undefined,
      onAuthLost: (error) => {
        const ended = this.transferSession;
        if (!ended || ended !== this.session || !ended.isActive) return;
        ended.end({ kind: 'auth-lost', error });
        this.files.reset();
        this.replaceSession(this.state.provider);
        this.updateState({
          isAuthenticated: false,
          error: error instanceof Error ? error.message : 'Download failed',
        });
      },
    },
  );

  constructor() {
    this.stateLoadPromise = this.loadState();
  }

  /** Capture the session now, before this request waits behind another operation. */
  runExclusive<T>(run: (transfer: GoogleDriveSyncTransfer) => Promise<T>): Promise<T> {
    const session = this.session;
    return this.serialize(async () => {
      await this.stateLoadPromise;
      try {
        session.assertActive();
        this.transferSession = session;
        const port = createGoogleDriveTurnPort({
          session,
          files: this.files,
          auth: this.auth,
          getState: () => this.getState(),
          updateState: (state) => {
            if (session === this.session) this.updateState(state);
          },
          saveState: async () => {
            if (session === this.session) await this.saveState();
          },
        });
        return await session.run(() => run(port));
      } finally {
        this.transferSession = null;
        if (session.endedForDriveAccountChange) this.replaceSessionForDriveAccount(session);
        this.updateState({ isSyncing: false });
      }
    });
  }

  onStateChange(callback: (state: SyncState) => void): void {
    this.stateChangeCallback = callback;
  }

  /**
   * Ensure state is loaded before returning
   */
  async getState(): Promise<SyncState> {
    await this.stateLoadPromise;
    return { ...this.state };
  }

  async setMode(mode: SyncMode): Promise<void> {
    this.state.mode = mode;
    await this.saveState();
    this.notifyStateChange();
  }

  async setProvider(provider: SyncProvider): Promise<void> {
    await this.stateLoadPromise;
    if (provider === 'icloud' && !isSafariRuntime()) {
      throw new Error('iCloud sync is available only in Safari');
    }
    if (provider === this.state.provider) return;

    this.session.end();
    await this.auth.clear();
    this.state.provider = provider;
    this.state.isAuthenticated = false;
    this.state.isSyncing = false;
    this.state.error = null;
    this.files.reset();
    this.replaceSession(provider);
    await this.saveState();
    this.notifyStateChange();
  }

  async authenticate(interactive: boolean = true): Promise<boolean> {
    try {
      this.updateState({ isSyncing: true, error: null });
      const token = await this.auth.getToken(interactive);
      if (!token) {
        // If not interactive and no token, just return false silently
        if (!interactive) {
          this.updateState({ isAuthenticated: false, isSyncing: false });
          return false;
        }
        throw new Error('Failed to obtain auth token');
      }
      this.updateState({ isAuthenticated: true, isSyncing: false });
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
      console.error('[GoogleDriveSyncService] Authentication failed:', error);
      this.updateState({ isAuthenticated: false, isSyncing: false, error: errorMessage });
      return false;
    }
  }

  /**
   * Safari signs in to Drive in the Voyager app, so the popup asks again whenever it opens or
   * returns, in any sync mode. Only a definite native answer changes the state. A connect the
   * popup started and the app completed turns a disabled sync on in manual mode, which never
   * transfers anything by itself.
   */
  refreshNativeAuthorization(): Promise<void> {
    // A read belongs to the session it was asked in; a later session asks again.
    const session = this.session;
    if (this.nativeAuthorizationRead?.session === session) return this.nativeAuthorizationRead.read;
    const read = this.readNativeAuthorization(session).finally(() => {
      if (this.nativeAuthorizationRead?.read === read) this.nativeAuthorizationRead = null;
    });
    this.nativeAuthorizationRead = { session, read };
    return read;
  }

  /**
   * Sign-out and a provider change end `session`, so an answer that arrives after either is
   * dropped instead of marking Drive connected again or switching another provider's sync on.
   */
  private async readNativeAuthorization(session: GoogleDriveSyncSession): Promise<void> {
    const answersCurrentDrive = () =>
      session === this.session && session.isActive && this.state.provider === 'googleDrive';
    await this.stateLoadPromise;
    if (!isSafariRuntime() || !answersCurrentDrive()) return;
    let native;
    try {
      native = await requestSafariGoogleDriveSession(false);
    } catch (error) {
      // An unreachable native side says nothing about the session; keep what the card shows.
      logger.warn('[GoogleDriveSyncService] Native Drive session unavailable', {
        error: String(error),
      });
      return;
    }
    if (!answersCurrentDrive()) return;
    if (native.driveAccount) {
      // The app signed in another account since this session's transfers began: end them, and
      // let a new session describe the new account.
      session.bindDriveAccount(native.driveAccount);
      if (session.endedForDriveAccountChange) {
        session = this.replaceSessionForDriveAccount(session);
        session.bindDriveAccount(native.driveAccount);
      }
    }
    this.updateState({ isAuthenticated: native.signedIn });
    const connected = await settleGoogleDriveConnect(native.signedIn ? native.signedInAt : null);
    if (connected && answersCurrentDrive() && this.state.mode === 'disabled') {
      await this.setMode('manual');
    }
  }

  async signOut(): Promise<void> {
    await this.stateLoadPromise;
    this.session.end();
    if (this.state.provider === 'icloud') {
      this.files.reset();
      this.updateState({ isAuthenticated: false, isSyncing: false, error: null });
      this.replaceSession(this.state.provider);
      await this.saveState();
      return;
    }

    await this.auth.signOutGoogle();
    await this.auth.clear();
    this.files.reset();
    this.updateState({ isAuthenticated: false, isSyncing: false, lastSyncTime: null, error: null });
    this.replaceSession(this.state.provider);
    await this.saveState();
  }

  /** A session ended by a change of Drive account gives way to one for the new account. */
  private replaceSessionForDriveAccount(ended: GoogleDriveSyncSession): GoogleDriveSyncSession {
    if (ended === this.session) {
      this.files.reset();
      this.replaceSession(this.state.provider);
    }
    return this.session;
  }

  /** Publishing a replacement always retires the prior session, including overlapping cleanup. */
  private replaceSession(provider: SyncProvider): void {
    this.session.end();
    this.session = new GoogleDriveSyncSession(provider);
  }

  private async loadState(): Promise<void> {
    try {
      this.state = await loadPersistedSyncState();
      if (this.state.mode !== 'disabled') {
        const token = await this.auth.getToken(false);
        this.state.isAuthenticated = !!token;
      }
    } catch (error) {
      console.error('[GoogleDriveSyncService] Failed to load state:', error);
    } finally {
      this.session.activate(this.state.provider);
    }
  }

  private async saveState(): Promise<void> {
    try {
      await savePersistedSyncState(this.state);
    } catch (error) {
      console.error('[GoogleDriveSyncService] Failed to save state:', error);
    }
  }

  private updateState(partial: Partial<SyncState>): void {
    this.state = { ...this.state, ...partial };
    this.notifyStateChange();
  }

  private notifyStateChange(): void {
    if (this.stateChangeCallback) {
      this.stateChangeCallback({ ...this.state });
    }
  }
}

export const googleDriveSyncService = new GoogleDriveSyncService();
