/** Captured at enqueue time; ending a session invalidates its running and queued work. */
import type { SyncProvider } from '@/core/types/sync';
import { startMachine } from '@/features/plugins/runtime/stateMachine';

type EndCause = { kind: 'cancelled' } | { kind: 'auth-lost'; error: unknown };
type SessionState =
  | { status: 'loading' }
  | { status: 'active'; provider: SyncProvider }
  | { status: 'ended'; cause: EndCause };
type SessionEvent = { type: 'ready'; provider: SyncProvider } | { type: 'end'; cause: EndCause };

function transition(state: SessionState, event: SessionEvent): SessionState {
  if (state.status === 'ended') return state;
  switch (event.type) {
    case 'ready':
      return state.status === 'loading' ? { status: 'active', provider: event.provider } : state;
    case 'end':
      return { status: 'ended', cause: event.cause };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export class SyncSessionEndedError extends Error {
  constructor() {
    super('Cloud session changed during transfer');
  }
}

export class GoogleDriveSyncSession {
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

  assertActive(): void {
    const state = this.machine.state;
    if (state.status === 'active') return;
    if (state.status === 'ended' && state.cause.kind === 'auth-lost') throw state.cause.error;
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
