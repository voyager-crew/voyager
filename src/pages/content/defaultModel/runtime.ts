import { createToaster } from '@/core/ui/toast/toaster';

import { DefaultModelAutoApply } from './autoApply';
import { DefaultStars } from './defaultStars';
import { ModelPicker } from './modelPicker';
import { DefaultModelPreferences } from './preferences';
import './styles.css';

type SessionState = 'idle' | 'starting' | 'running' | 'stopped';

/** At most one session runs on a page; a newer one retires the older. */
let activeSession: DefaultModelSession | null = null;

function becomeActive(session: DefaultModelSession): void {
  if (activeSession && activeSession !== session) activeSession.stop();
  activeSession = session;
}

/**
 * One enabled period of the default-model feature: the stars in Gemini's
 * model menu and the automatic application on new chats, with everything they
 * add to the page. The native module runs one while its switch is on; the
 * official plugin runs one while it is mounted. Stopping takes out every star,
 * title wrapper, host listener and timer, cancels a pick in flight and keeps
 * the stored default model and thinking level.
 */
export class DefaultModelSession {
  private readonly picker: ModelPicker;
  private readonly toaster = createToaster();
  private readonly stars: DefaultStars;
  private readonly autoApply: DefaultModelAutoApply;
  private state: SessionState = 'idle';

  public constructor(private readonly preferences = new DefaultModelPreferences()) {
    this.picker = new ModelPicker(preferences);
    this.stars = new DefaultStars(preferences, this.picker, this.toaster);
    this.autoApply = new DefaultModelAutoApply(preferences, this.picker, this.toaster);
  }

  /** Loads the stored defaults, then starts unless `stop` came first. */
  public async start(): Promise<void> {
    if (this.state !== 'idle') return;
    this.state = 'starting';
    becomeActive(this);
    await this.preferences.reloadDefaults();
    // Stopped while the defaults loaded: nothing may attach.
    if (this.state !== 'starting') return;
    this.state = 'running';
    this.stars.start();
    this.autoApply.start();
  }

  /** The defaults this session applies to new chats, once it runs. */
  public get applied(): DefaultModelPreferences | null {
    return this.state === 'running' ? this.preferences : null;
  }

  public stop(): void {
    if (this.state === 'stopped') return;
    this.state = 'stopped';
    if (activeSession === this) activeSession = null;
    this.autoApply.stop();
    this.stars.stop();
    this.toaster.destroy();
  }
}

/**
 * The default model and thinking level new chats on this page get, or null
 * while the feature is off here. Read by Create mode, which opens a new chat.
 */
export function appliedDefaultModel(): DefaultModelPreferences | null {
  return activeSession?.applied ?? null;
}

/**
 * The default-model feature without its switch, running until `signal`
 * aborts. The official plugin starts it while `gvDefaultModelAutoApply` is
 * on, so it never reads that switch itself.
 */
export async function startDefaultModelRuntime({ signal }: { signal: AbortSignal }): Promise<void> {
  if (signal.aborted) return;
  const session = new DefaultModelSession();
  signal.addEventListener('abort', () => session.stop(), { once: true });
  await session.start();
}
