/**
 * Draft auto-save for one site policy: unsent composer text is saved per
 * conversation after a pause in typing and put back into an empty composer when
 * that conversation opens again. A confirmed send drops the draft (catalog sites:
 * Enter, the send button or the form, then the composer emptying; Gemini: its own
 * send detection). Nothing here sends, submits or clears the composer itself.
 *
 * Three independent axes share the session:
 *  - restore: an explicit machine per opened conversation (`draftSessionMachine.ts`);
 *  - save: one pending `{ key, content }` behind a debounce every input restarts;
 *  - send: one armed intent whose timers a new send replaces.
 * They talk through events: input and sends `touch` the restore, a send drops
 * the pending save, and an armed intent decides whether a route change was a send.
 *
 * Every listener and timer is registered on the plugin's scope; disposing it
 * stops the session and leaves stored drafts in place.
 */
import { isUserEvent } from '@/core/utils/userEvent';
import type { Dispose, PluginScope } from '@/features/plugins/runtime/pluginScope';
import type { Machine } from '@/features/plugins/runtime/stateMachine';
import { DraftStore, draftStoreOptions } from '@/pages/content/draftSave/draftStore';
import { registerDraftFlush } from '@/pages/content/draftSave/draftUnloadFlush';
import { startGeminiDraftSendDetection } from '@/pages/content/draftSave/geminiDraftSendDetection';
import { watchRouteChanges } from '@/pages/content/utils/routeWatcher';

import { composerEnterIsOwned } from '../composerEnterOwner';
import { NEW_CHAT_DRAFT } from './draftKey';
import { type DraftPolicy, sanitizeDraftAt } from './draftPolicy';
import {
  type DraftRestoreEvent,
  type DraftRestorePort,
  type DraftRestoreState,
  type DraftWriteResult,
  draftRestoreEffects,
  initialDraftRestoreState,
  startDraftRestore,
} from './draftSessionMachine';

export { DRAFT_RESTORE_DELAY_MS } from './draftSessionMachine';

/** Same pause as Gemini's before typing is written to storage. */
export const DRAFT_SAVE_DEBOUNCE_MS = 1000;
/** How long a send stays armed for the composer to empty or the route to change. */
export const SEND_INTENT_TIMEOUT_MS = 2000;
/** Hosts clear a sent prompt with an editor transaction that fires no `input` event. */
const SEND_CHECK_INTERVAL_MS = 250;
/** How long after a key or cut in the composer its own DOM changes count as the person's edit. */
const KEY_EDIT_WATCH_MS = 1000;

interface SendIntent {
  readonly key: string;
  readonly disposers: readonly Dispose[];
}

export function startSiteDraftSave(scope: PluginScope, policy: DraftPolicy, doc: Document): void {
  const detection = policy.sendDetection;
  const keyHere = (): string | null =>
    policy.eligible(location, doc) ? policy.keyFor(location) : null;
  const composer = (): HTMLElement | null => policy.findInput(doc);

  let currentKey = keyHere();
  let currentIdentity = policy.restoreIdentity(doc);
  let geminiSend: ReturnType<typeof startGeminiDraftSendDetection> | null = null;
  let lastSavedContent = '';
  let pendingSave: { key: string; content: string } | null = null;
  let cancelSaveTimer: Dispose | null = null;
  let sendIntent: SendIntent | null = null;
  /** True only while the restore writes, so its own `input` event is not the person's. */
  let writingDraft = false;

  const store = new DraftStore(
    (key, content) => {
      if (key === currentKey) lastSavedContent = content;
    },
    draftStoreOptions(policy, doc),
  );

  const writeDraft = (content: string): DraftWriteResult => {
    const field = composer();
    if (!field) return 'missed';
    // Whatever is already in the composer is the user's: never write over it.
    if (!policy.isEmpty(field)) return 'occupied';
    writingDraft = true;
    try {
      return policy.write(field, content) ? 'written' : 'missed';
    } finally {
      writingDraft = false;
    }
  };

  const restorePort: DraftRestorePort = {
    identity: () => policy.restoreIdentity(doc),
    // The route watcher polls and an account switch keeps the route: check the live page.
    matches: (key, identity) => keyHere() === key && policy.restoreIdentity(doc) === identity,
    load: async (key) => {
      const saved = await store.load(key);
      return saved === null ? '' : sanitizeDraftAt(policy, 'restore', saved).trim();
    },
    stored: (content) => {
      lastSavedContent = content;
    },
    write: writeDraft,
  };
  const restoreEffects = draftRestoreEffects(restorePort);
  /** The current conversation's restore; started once the listeners below are in place. */
  let restore: Machine<DraftRestoreState, DraftRestoreEvent> | null = null;
  /** The person's input or a send after a restore began makes its draft outdated. */
  const touch = (): void => restore?.send({ type: 'touched' });

  const ownComposer = (target: EventTarget | null): HTMLElement | null => {
    const field = composer();
    return field && target instanceof Node && field.contains(target) ? field : null;
  };

  const flushPendingSave = (): void => {
    if (scope.isDisposed) {
      pendingSave = null;
      return;
    }
    void cancelSaveTimer?.();
    cancelSaveTimer = null;
    const pending = pendingSave;
    pendingSave = null;
    if (!pending) return;
    if (pending.key === currentKey && pending.content === lastSavedContent) return;
    store.save(pending.key, pending.content);
  };

  const discardPendingSave = (key: string): void => {
    if (pendingSave?.key !== key) return;
    void cancelSaveTimer?.();
    cancelSaveTimer = null;
    pendingSave = null;
  };

  const clearSendIntent = (): void => {
    const intent = sendIntent;
    sendIntent = null;
    intent?.disposers.forEach((dispose) => void dispose());
  };

  const dropSentDraft = (key: string): void => {
    discardPendingSave(key);
    store.remove(key);
    touch();
    clearSendIntent();
  };

  const checkSent = (): void => {
    if (!sendIntent || sendIntent.key !== currentKey) return;
    const field = composer();
    if (field && policy.isEmpty(field)) dropSentDraft(sendIntent.key);
  };

  const markSendIntent = (field: HTMLElement): void => {
    // An empty composer sends nothing; armed, it would drop the draft typed next.
    const key = keyHere();
    if (scope.isDisposed || key === null || policy.isEmpty(field)) return;
    touch();
    clearSendIntent();
    sendIntent = {
      key,
      disposers: [
        scope.timer(clearSendIntent, SEND_INTENT_TIMEOUT_MS),
        scope.timer(checkSent, SEND_CHECK_INTERVAL_MS, { repeat: true }),
      ],
    };
  };

  const onInput = (event: Event): void => {
    if (scope.isDisposed) return;
    const field = ownComposer(event.target);
    if (!field) return;
    // Catalog hosts fire their own input while mounting the composer; only a person's outdates a restore.
    if (!writingDraft && (detection.kind === 'gemini' || isUserEvent(event))) touch();
    recordComposer(field);
  };

  /** Lexical (Kimi) applies Backspace, cut and undo itself and cancels the key: no `input` follows. */
  let stopEditWatch: Dispose | null = null;
  const watchKeyEdit = (event: Event): void => {
    const field = ownComposer(event.target);
    if (scope.isDisposed || !field || !isUserEvent(event)) return;
    void stopEditWatch?.();
    const observer = new MutationObserver(() => {
      if (scope.isDisposed || writingDraft || !field.isConnected) return;
      touch();
      recordComposer(field);
    });
    observer.observe(field, { childList: true, characterData: true, subtree: true });
    const stopTimer = scope.timer(() => void stopEditWatch?.(), KEY_EDIT_WATCH_MS);
    stopEditWatch = () => {
      observer.disconnect();
      void stopTimer();
      stopEditWatch = null;
    };
  };

  const recordComposer = (field: HTMLElement): void => {
    geminiSend?.checkSent();
    // The route watcher polls; the live route at the input event names the draft's conversation.
    const key = keyHere();
    if (key === null) return;
    const content = sanitizeDraftAt(policy, 'input', policy.readText(field)).trim();
    if (!content && detection.kind === 'gemini' && key !== currentKey) return;
    if (!content && sendIntent) {
      dropSentDraft(sendIntent.key);
      return;
    }
    pendingSave = { key, content };
    void cancelSaveTimer?.();
    cancelSaveTimer = scope.timer(flushPendingSave, DRAFT_SAVE_DEBOUNCE_MS);
  };

  const onRoute = (): void => {
    if (scope.isDisposed) return;
    const next = keyHere();
    const nextIdentity = policy.restoreIdentity(doc);
    if (next === currentKey && nextIdentity === currentIdentity) return;
    geminiSend?.checkSent();
    const previous = currentKey;
    // Only a first send changes the route; leaving a conversation within the send window
    // (the host ignored that Enter) must keep its draft. Send intents are catalog-only.
    const firstSend =
      detection.kind === 'catalog' &&
      previous === NEW_CHAT_DRAFT &&
      next !== null &&
      next !== NEW_CHAT_DRAFT;
    if (firstSend && sendIntent?.key === previous && currentIdentity === nextIdentity) {
      // A first send moves the new-chat page to the conversation's route: the
      // still-debounced text was just sent and must not be saved back.
      dropSentDraft(previous);
    } else {
      // Leaving a conversation keeps its draft; the pending entry carries its own key.
      flushPendingSave();
    }
    clearSendIntent();
    currentKey = next;
    currentIdentity = nextIdentity;
    lastSavedContent = '';
    // Stopping the previous restore retires its timers and its pending load.
    void restore?.stop();
    restore = startDraftRestore(restoreEffects, initialDraftRestoreState(next, 'afterDelay'));
  };

  if (detection.kind === 'gemini') {
    scope.effect(() => {
      geminiSend = startGeminiDraftSendDetection({
        doc,
        policy,
        signal: scope.signal,
        onSent: dropSentDraft,
        onIntent: touch,
      });
      return geminiSend.stop;
    }, 'draft-save:gemini-send');
  }
  scope.on(doc, 'input', onInput, { capture: true });
  scope.on(doc, 'keydown', watchKeyEdit, { capture: true });
  scope.on(doc, 'cut', watchKeyEdit, { capture: true });
  scope.effect(() => () => void stopEditWatch?.(), 'draft-save:key-edit');
  if (detection.kind === 'catalog') {
    scope.on(
      doc,
      'keydown',
      (event) => {
        // IME confirmation also reports Enter; it only commits text.
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229)
          return;
        // A send shortcut may see this Enter after us and make it a newline; its sends are button clicks.
        if (composerEnterIsOwned(doc)) return;
        const field = ownComposer(event.target);
        if (field) markSendIntent(field);
      },
      { capture: true },
    );
    scope.on(
      doc,
      'click',
      (event) => {
        const sendButton = detection.sendButton;
        if (!sendButton || !(event.target instanceof Element)) return;
        let button: Element | null = null;
        try {
          button = event.target.closest(sendButton);
        } catch {
          return;
        }
        if (!button || button.matches(':disabled, [aria-disabled="true"]')) return;
        const field = composer();
        if (field) markSendIntent(field);
      },
      { capture: true },
    );
    scope.on(
      doc,
      'submit',
      (event) => {
        const field = composer();
        if (field && event.target instanceof Node && event.target.contains(field)) {
          markSendIntent(field);
        }
      },
      { capture: true },
    );
  }
  scope.effect(() => registerDraftFlush(flushPendingSave), 'draft-save:unload-flush');
  if (policy.flushOnPageHide) {
    // A reload or full navigation inside the pause would keep the previous draft, even a cleared one.
    scope.on(doc.defaultView ?? window, 'pagehide', flushPendingSave);
  }
  scope.effect(() => watchRouteChanges(onRoute), 'draft-save:route');
  // Disabling drops the unsaved tail like Gemini's toggle does; stored drafts stay.
  scope.effect(
    () => () => {
      pendingSave = null;
      sendIntent = null;
    },
    'draft-save:state',
  );
  // Started last, once every listener is in place; the restore that is current at disable stops.
  scope.effect(() => {
    restore = startDraftRestore(restoreEffects, initialDraftRestoreState(currentKey, 'now'));
    const stopRestore = () => restore?.stop();
    // Stop when disposal begins, not when the ledger reaches this entry: a load settling while
    // earlier entries tear down would write a draft into a composer the plugin no longer owns.
    scope.signal.addEventListener('abort', () => void stopRestore(), { once: true });
    return stopRestore;
  }, 'draft-save:restore');
}
