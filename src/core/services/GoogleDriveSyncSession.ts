/** Captured at enqueue time; ending a session invalidates its running and queued work. */
import type { SyncProvider } from '@/core/types/sync';
import type { CloudUploadReceipt } from '@/core/types/syncUploadReceipt';
import {
  isSafariGoogleDriveAccountChangedError,
  isSafariGoogleDriveUnsentRefusal,
  type SafariDriveAccountBinding,
} from '@/core/utils/safariGoogleDrive';
import { startMachine } from '@/features/plugins/runtime/stateMachine';

type EndCause =
  | { kind: 'cancelled' }
  | { kind: 'auth-lost'; error: unknown }
  | { kind: 'drive-account-changed' };
type SessionState =
  | { status: 'loading' }
  | { status: 'active'; provider: SyncProvider; driveAccount: string | null }
  // An ended session keeps its account: the writes it made went there.
  | { status: 'ended'; cause: EndCause; driveAccount: string | null };
type SessionEvent =
  | { type: 'ready'; provider: SyncProvider }
  | { type: 'end'; cause: EndCause }
  | { type: 'drive-account'; account: string };

function transition(state: SessionState, event: SessionEvent): SessionState {
  if (state.status === 'ended') return state;
  const driveAccount = state.status === 'active' ? state.driveAccount : null;
  switch (event.type) {
    case 'ready':
      return state.status === 'loading'
        ? { status: 'active', provider: event.provider, driveAccount: null }
        : state;
    case 'end':
      return { status: 'ended', cause: event.cause, driveAccount };
    case 'drive-account':
      // The first answer binds the session; an answer from another account ends it.
      if (state.status !== 'active' || state.driveAccount === event.account) return state;
      return state.driveAccount === null
        ? { ...state, driveAccount: event.account }
        : { status: 'ended', cause: { kind: 'drive-account-changed' }, driveAccount };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export class SyncSessionEndedError extends Error {
  constructor(message = 'Cloud session changed during transfer') {
    super(message);
  }
}

/**
 * The Voyager app signed in another Google account during the transfer. Nothing is applied
 * locally and nothing reaches the new account; an upload may have written to the old one.
 */
export class DriveAccountChangedError extends SyncSessionEndedError {
  readonly code = 'account_changed';

  /**
   * @param unsent The refused call sent nothing Drive could apply: this session or the native
   *   side refused it before it started.
   * @param uploadReceipt The upload's writes the session's own account already holds.
   */
  constructor(
    readonly unsent = true,
    readonly uploadReceipt?: CloudUploadReceipt,
  ) {
    super('The Google Drive account changed during the transfer');
  }
}

/** A refused call that left Drive as it was, so it needs no upload receipt. */
export function isUnsentDriveCall(error: unknown): boolean {
  return error instanceof DriveAccountChangedError && error.unsent;
}

/** The refusal of a call an earlier attempt may already have sent to Drive. */
export function asSentRefusal(error: unknown): unknown {
  return isUnsentDriveCall(error) || isSafariGoogleDriveUnsentRefusal(error)
    ? new DriveAccountChangedError(false)
    : error;
}

/** No retry can succeed: the session ended, or the native side refused it for a new account. */
export function endsSyncSession(error: unknown): boolean {
  return error instanceof SyncSessionEndedError || isSafariGoogleDriveAccountChangedError(error);
}

export class GoogleDriveSyncSession implements SafariDriveAccountBinding {
  private readonly machine = startMachine<SessionState, SessionEvent>(
    { id: 'cloud-sync-session', transition },
    { status: 'loading' },
  );

  constructor(provider?: SyncProvider) {
    if (provider) this.activate(provider);
  }

  activate(provider: SyncProvider): void {
    this.machine.send({ type: 'ready', provider });
  }
  end(cause: EndCause = { kind: 'cancelled' }): void {
    this.machine.send({ type: 'end', cause });
    void this.machine.stop();
  }

  get isActive(): boolean {
    return this.machine.state.status === 'active';
  }

  get provider(): SyncProvider {
    const state = this.machine.state;
    if (state.status === 'active') return state.provider;
    this.assertActive();
    throw new SyncSessionEndedError();
  }

  /** The account the session's first answer named; an ended session keeps it. */
  get driveAccount(): string | null {
    const state = this.machine.state;
    return state.status === 'loading' ? null : state.driveAccount;
  }

  bindDriveAccount(account: string): void {
    this.machine.send({ type: 'drive-account', account });
  }

  endForDriveAccountChange(): void {
    this.end({ kind: 'drive-account-changed' });
  }

  get endedForDriveAccountChange(): boolean {
    const state = this.machine.state;
    return state.status === 'ended' && state.cause.kind === 'drive-account-changed';
  }

  assertActive(): void {
    this.throwIfEnded(true);
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    this.throwIfEnded(true);
    try {
      const value = await operation();
      // The operation finished, so whatever it wrote may have landed.
      this.throwIfEnded(false);
      return value;
    } catch (error) {
      // A refusal from an inner call, or from the native side, knows what its call sent.
      if (error instanceof DriveAccountChangedError && this.endedForDriveAccountChange) throw error;
      this.throwIfEnded(isSafariGoogleDriveUnsentRefusal(error));
      throw error;
    }
  }

  private throwIfEnded(unsent: boolean): void {
    const state = this.machine.state;
    if (state.status === 'active') return;
    if (state.status === 'ended' && state.cause.kind === 'auth-lost') throw state.cause.error;
    if (state.status === 'ended' && state.cause.kind === 'drive-account-changed')
      throw new DriveAccountChangedError(unsent);
    throw new SyncSessionEndedError();
  }
}
