import type { Toaster } from '@/core/ui/toast/types';
import { type Machine, startMachine } from '@/features/plugins/runtime/stateMachine';

import { watchRouteChanges } from '../utils/routeWatcher';
import {
  type AutoApplyEvent,
  type AutoApplyPorts,
  type AutoApplyState,
  type LockSession,
  autoApplyTransition,
  createAutoApplyEffects,
  sessionOf,
} from './autoApplyMachine';
import { ModelPicker } from './modelPicker';
import { findModelFocusInput } from './modelPickerSelectors';
import { DefaultModelPreferences } from './preferences';

const RECENT_COMPOSER_ACTIVITY_MS = 8000;
const NAVIGATION_SETTLE_MS = 150;
const REFOCUS_DELAY_MS = 120;
/** Long enough to read and act on, short enough not to camp on the page. */
const FAILURE_TOAST_MS = 12000;
export const AUTO_APPLY_FAILURE_CHANNEL = 'default-model-failure';

/** Runs `callback` after `delayMs` unless `signal` aborts first. */
function scheduleUntilAborted(signal: AbortSignal, callback: () => void, delayMs: number): void {
  if (signal.aborted) return;
  const cancel = () => window.clearTimeout(id);
  const id = window.setTimeout(() => {
    signal.removeEventListener('abort', cancel);
    callback();
  }, delayMs);
  signal.addEventListener('abort', cancel, { once: true });
}

/** One enabled period: its lock machine and everything it attached to the page. */
interface AutoApplyRun {
  /**
   * Ends the route watcher, host listeners, navigation-settle and refocus
   * timers. Abort listeners run synchronously, so nothing is left once `stop`
   * returns, unlike an async scope teardown.
   */
  readonly controller: AbortController;
  readonly machine: Machine<AutoApplyState, AutoApplyEvent>;
}

export class DefaultModelAutoApply {
  private run: AutoApplyRun | null = null;
  private lastCheckedPath: string | null = null;
  // Once a session gives up, show a one-time toast suggesting the user pause
  // the feature. The flag lives as long as this instance, which is one enabled
  // period, so revisiting /app many times in a broken session does not spam toasts.
  private failureToastShown = false;
  private lastComposerActivityPath: string | null = null;
  private lastComposerActivityAt = 0;

  public constructor(
    private readonly preferences: DefaultModelPreferences,
    private readonly picker: ModelPicker,
    private readonly toaster: Toaster,
  ) {}

  public start(): void {
    if (this.run) return;
    const controller = new AbortController();
    const { signal } = controller;
    const machine = startMachine<AutoApplyState, AutoApplyEvent>(
      {
        id: 'default-model-auto-apply',
        transition: autoApplyTransition,
        effects: createAutoApplyEffects(this.portsFor(signal)),
      },
      { status: 'idle' },
    );
    this.run = { controller, machine };

    this.subscribeToComposerActivity(signal);
    this.requestCheck();
    // One shared watcher covers browser history events and page-world SPA
    // navigations without stacking per-feature History API wrappers.
    const stopRouteWatcher = watchRouteChanges(() => {
      const currentPath = window.location.pathname;
      if (currentPath !== this.lastCheckedPath && this.isNewConversation()) {
        this.lastCheckedPath = currentPath;
        this.requestCheckAfterSettle(signal);
      }
    });
    signal.addEventListener('abort', stopRouteWatcher, { once: true });

    // A click on the already-active /app new-chat link does not change href, so
    // the shared watcher cannot observe it. Keep only this semantic exception;
    // all real URL changes go through watchRouteChanges.
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const link = target?.closest<HTMLAnchorElement>('a[href]');
        if (!link) return;
        try {
          const destination = new URL(link.href, window.location.href);
          if (destination.href === window.location.href && this.isNewConversation()) {
            this.requestCheckAfterSettle(signal);
          }
        } catch {
          // Ignore malformed host links.
        }
      },
      { capture: true, signal },
    );
  }

  public stop(): void {
    const run = this.run;
    if (!run) return;
    this.run = null;
    run.controller.abort();
    void run.machine.stop();
    this.lastComposerActivityPath = null;
    this.lastComposerActivityAt = 0;
  }

  private portsFor(signal: AbortSignal): AutoApplyPorts {
    return {
      planLock: () => this.planLock(),
      currentPath: () => window.location.pathname,
      shouldYield: () => this.shouldYieldToUserComposerActivity(),
      readPill: (session) => {
        const lines = this.picker.readTriggerPillLines();
        return {
          modelOk: !session.model || this.preferences.modelMatchesLines(session.model, lines),
          thinkingOk:
            !session.thinking || this.preferences.thinkingMatchesLines(session.thinking, lines),
        };
      },
      selectModel: (target, interaction) => this.picker.selectModel(target, interaction),
      selectThinking: (target, interaction) => this.picker.selectThinking(target, interaction),
      focusInput: (session) => this.focusChatInputAfterAutoSwitch(signal, session),
      notifyFailure: () => this.maybeNotifyAutoApplyFailure(),
    };
  }

  /** Starts a check of the current page when it is a new conversation. */
  private requestCheck(): void {
    // Only lock on new conversation pages
    if (!this.isNewConversation()) return;
    this.lastCheckedPath = window.location.pathname;
    this.run?.machine.send({ type: 'check' });
  }

  /** Waits briefly after an SPA navigation so the URL and pill have settled. */
  private requestCheckAfterSettle(signal: AbortSignal): void {
    scheduleUntilAborted(signal, () => this.requestCheck(), NAVIGATION_SETTLE_MS);
  }

  /**
   * Loads the defaults and decides whether this new chat needs a lock session.
   * Defaults remain visible in the cache while enforcement is paused.
   */
  private async planLock(): Promise<LockSession | null> {
    const { model: targetModel, thinking: targetThinking } =
      await this.preferences.reloadDefaults();
    // Keep the raw value for the in-menu star display, but never *enforce*
    // Standard: it is Gemini's built-in default thinking level, so locking to it
    // is always a no-op that can only make the picker flash open on an
    // already-correct chat. Treat a Standard target as "no thinking preference".
    const enforcedThinking = this.preferences.isPageDefaultThinkingLevel(targetThinking)
      ? null
      : targetThinking;

    if (!targetModel && !enforcedThinking) return null;

    // Skip when the only target is the Flash/Fast model and there is no thinking
    // preference left to enforce — Gemini already defaults to Flash, so a no-op
    // lock loop just wastes ticks.
    if (targetModel && this.preferences.isFastModel(targetModel) && !enforcedThinking) {
      return null;
    }

    // Nothing to do when the picker already shows the starred model + thinking
    // level. A one-line pill ("Pro") already means Pro + Standard — Gemini hides
    // the thinking line at Standard. Bail before starting the 1s lock loop so an
    // already-correct new chat never spins up (or briefly opens) the picker. The
    // `lines.length` guard keeps the startup case — pill not painted yet — on
    // the loop path.
    const pillLines = this.picker.readTriggerPillLines();
    if (pillLines.length) {
      const modelOk = !targetModel || this.preferences.modelMatchesLines(targetModel, pillLines);
      const thinkingOk =
        !enforcedThinking || this.preferences.thinkingMatchesLines(enforcedThinking, pillLines);
      if (modelOk && thinkingOk) return null;
    }

    return { lockPath: window.location.pathname, model: targetModel, thinking: enforcedThinking };
  }

  private maybeNotifyAutoApplyFailure() {
    if (this.failureToastShown) return;
    this.failureToastShown = true;
    this.showAutoApplyFailureToast();
  }

  private showAutoApplyFailureToast() {
    this.toaster.show({
      channel: AUTO_APPLY_FAILURE_CHANNEL,
      tone: 'warning',
      durationMs: FAILURE_TOAST_MS,
      message:
        chrome.i18n.getMessage('defaultModelAutoApplyFailed') ||
        "Default model couldn't auto-apply after 3 tries. Gemini may have changed its menu — you can turn this feature off for now.",
      action: {
        label:
          chrome.i18n.getMessage('defaultModelAutoApplyFailedAction') || 'Turn off in settings',
        run: (handle) => {
          void this.requestOpenPopup().then((opened) => {
            if (opened) {
              handle.dismiss();
              return;
            }
            // Firefox/Safari (or any host that refuses a programmatic popup):
            // say how to get there by hand; the button has nothing left to do.
            handle.update({
              message:
                chrome.i18n.getMessage('defaultModelAutoApplyFailedFallback') ||
                'Click the Voyager icon in your toolbar to open the popup, then turn off “Default Model” in “Conversations”.',
              action: undefined,
            });
          });
        },
      },
    });
  }

  private async requestOpenPopup(): Promise<boolean> {
    try {
      const response = (await chrome.runtime.sendMessage({ type: 'gv.openPopup' })) as
        | { ok?: boolean }
        | undefined;
      return response?.ok === true;
    } catch {
      return false;
    }
  }

  private isNewConversation() {
    const path = window.location.pathname;
    // Supports multi-profile paths like /u/0/app as well as /app.
    // Also supports Gem paths like /gem/xyz or /u/0/gem/xyz
    return /^\/(u\/\d+\/)?(app\/?|gem\/.*)$/.test(path);
  }

  /** A route change or a newer session inside the delay must not focus the next page. */
  private focusChatInputAfterAutoSwitch(signal: AbortSignal, session: LockSession): void {
    scheduleUntilAborted(
      signal,
      () => {
        const state = this.run?.machine.state;
        if (!state || sessionOf(state) !== session) return;
        if (window.location.pathname !== session.lockPath) return;
        const input = this.findChatInputElement();
        if (!input) return;

        try {
          input.focus({ preventScroll: true });
        } catch {
          input.focus();
        }
      },
      REFOCUS_DELAY_MS,
    );
  }

  private findChatInputElement(): HTMLElement | null {
    return findModelFocusInput();
  }

  private subscribeToComposerActivity(signal: AbortSignal): void {
    const recordActivity = (event: Event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!this.isChatInputElement(target)) return;
      this.lastComposerActivityPath = window.location.pathname;
      this.lastComposerActivityAt = Date.now();
    };
    document.addEventListener('input', recordActivity, { capture: true, signal });
    document.addEventListener('keydown', recordActivity, { capture: true, signal });
  }

  private isChatInputElement(element: HTMLElement | null): boolean {
    if (!element) return false;
    const input = this.findChatInputElement();
    return Boolean(input && (element === input || input.contains(element)));
  }

  private shouldYieldToUserComposerActivity(): boolean {
    // Opening the picker steals focus while the user is composing.
    const input = this.findChatInputElement();
    const text = input ? this.getChatInputText(input).trim() : '';
    if (text.length > 0) return true;

    return (
      this.lastComposerActivityPath === window.location.pathname &&
      Date.now() - this.lastComposerActivityAt < RECENT_COMPOSER_ACTIVITY_MS
    );
  }

  private getChatInputText(input: HTMLElement): string {
    if (input instanceof HTMLTextAreaElement) {
      return input.value;
    }
    return input.innerText ?? input.textContent ?? '';
  }
}
