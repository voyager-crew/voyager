/** Captured at enqueue time; ending a session invalidates its running and queued work. */
import type { SyncProvider } from '@/core/types/sync';
import type { SafariDriveAccountBinding } from '@/core/utils/safariGoogleDrive';
import { startMachine } from '@/features/plugins/runtime/stateMachine';

type EndCause =
  | { kind: 'cancelled' }
  | { kind: 'auth-lost'; error: unknown }
  | { kind: 'drive-account-changed' };
type SessionState =
  | { status: 'loading' }
  | { status: 'active'; provider: SyncProvider; driveAccount: string | null }
  | { status: 'ended'; cause: EndCause };
type SessionEvent =
  | { type: 'ready'; provider: SyncProvider }
  | { type: 'end'; cause: EndCause }
  | { type: 'drive-account'; account: string };

function transition(state: SessionState, event: SessionEvent): SessionState {
  if (state.status === 'ended') return state;
  switch (event.type) {
    case 'ready':
      return state.status === 'loading'
        ? { status: 'active', provider: event.provider, driveAccount: null }
        : state;
    case 'end':
      return { status: 'ended', cause: event.cause };
    case 'drive-account':
      // The first answer binds the session; an answer from another account ends it.
      if (state.status !== 'active' || state.driveAccount === event.account) return state;
      return state.driveAccount === null
        ? { ...state, driveAccount: event.account }
        : { status: 'ended', cause: { kind: 'drive-account-changed' } };
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

/** The Voyager app signed in another Google account during the transfer; nothing was applied. */
export class DriveAccountChangedError extends SyncSessionEndedError {
  readonly code = 'account_changed';

  constructor() {
    super('The Google Drive account changed during the transfer');
  }
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

  get driveAccount(): string | null {
    const state = this.machine.state;
    return state.status === 'active' ? state.driveAccount : null;
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
    const state = this.machine.state;
    if (state.status === 'active') return;
    if (state.status === 'ended' && state.cause.kind === 'auth-lost') throw state.cause.error;
    if (state.status === 'ended' && state.cause.kind === 'drive-account-changed')
      throw new DriveAccountChangedError();
    throw new SyncSessionEndedError();
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    this.assertActive();
    try {
      const value = await operation();
      this.assertActive();
      return value;
    } catch (error) {
      this.assertActive();
      throw error;
    }
  }
}
