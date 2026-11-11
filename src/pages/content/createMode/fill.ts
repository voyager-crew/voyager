import { insertIntoComposer } from '@/core/services/composer';
import { isEmptyComposer } from '@/core/services/composer/emptyComposer';
import { startMachine } from '@/features/plugins/runtime/stateMachine';

import {
  type FillEvent,
  type FillResult,
  type FillState,
  fillEffects,
  fillTransition,
} from './fillMachine';
import { type NewChatTarget, clickNativeControl, isOnNewChat, navigateInApp } from './newChat';

export const FILL_POLL_MS = 150;
export const FILL_CONFIRM_MS = 1_200;
export const FILL_TIMEOUT_MS = 15_000;

export interface CreationFillDeps {
  readonly target: NewChatTarget;
  /** The page's main composer, or null. */
  readonly find: () => HTMLElement | null;
  readonly notify: (result: FillResult) => void;
  readonly insert?: (composer: HTMLElement, text: string) => boolean;
}

/**
 * Open a new chat (unless the page is on one) and put `message` into its
 * empty composer, without sending. Returns the stop, which writes nothing more.
 */
export function startCreationFill(message: string, deps: CreationFillDeps): () => void {
  const { target } = deps;
  const startDocument = document;
  const insert = deps.insert ?? ((composer, text) => insertIntoComposer(composer, text, 'append'));
  const onNewChat = () => document === startDocument && isOnNewChat(target, location);
  const initial: FillState = onNewChat()
    ? { status: 'waiting', previous: null, stable: 0 }
    : { status: 'opening' };
  const machine = startMachine<FillState, FillEvent>(
    {
      id: 'createModeFill',
      transition: fillTransition,
      effects: fillEffects({
        pollMs: FILL_POLL_MS,
        confirmMs: FILL_CONFIRM_MS,
        timeoutMs: FILL_TIMEOUT_MS,
        onNewChat,
        openWithControl: () => {
          const control = target.link(document);
          if (!control) return false;
          clickNativeControl(control);
          return true;
        },
        openWithHistory: () => target.history && navigateInApp(target.path(location)),
        find: deps.find,
        empty: isEmptyComposer,
        insert: (composer) => insert(composer, message),
        finish: (result) => {
          if (result !== 'left') deps.notify(result);
        },
      }),
    },
    initial,
  );
  return () => {
    machine.send({ type: 'finish', result: 'left' });
    void machine.stop();
  };
}
