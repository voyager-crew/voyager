import { isVoyagerLayerEvent } from '@/core/ui/layer';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/menu-packaged.json';
import { type Machine, startMachine } from '@/features/plugins/runtime/stateMachine';

import { promptPageScope } from '../prompt/promptPageScope';
import { watchMenuActionIdentity, watchMenuPageScope } from './menuIdentity';
import {
  associatedMenuTrigger,
  hasOnlineMenuTargets,
  rememberOnlineMenuPanel,
  usesOnlineMenuPanel,
} from './menuTargets';
import { resolveSidebarConversationTarget } from './sidebarConversationTarget';

export { associatedMenuTrigger } from './menuTargets';

const RETIRE_ACTION_EVENT = 'gv-retire-online-menu-action';

class OnlineMenuActions {
  private readonly readers = new WeakMap<HTMLElement, () => boolean>();
  remember(button: HTMLElement, read: () => boolean): void {
    this.readers.set(button, read);
  }
  isCurrent(button: HTMLElement): boolean {
    return this.readers.get(button)?.() ?? false;
  }
}
const onlineMenuActions = new OnlineMenuActions();

export function isOnlineMenuActionCurrent(button: HTMLElement): boolean {
  return onlineMenuActions.isCurrent(button);
}

export function retireOnlineMenuAction(button: Element): void {
  button.dispatchEvent(new Event(RETIRE_ACTION_EVENT));
}

export function retireOnlineMenuActions(selector: string, root: ParentNode = document): void {
  root.querySelectorAll(selector).forEach(retireOnlineMenuAction);
}

export function onlineMenuActionIsCurrent(panel: HTMLElement, button: HTMLElement): () => boolean {
  if (!usesOnlineMenuPanel(panel)) return () => true;
  rememberOnlineMenuPanel(panel);
  const trigger = associatedMenuTrigger(panel);
  const triggerParent = trigger?.parentElement;
  const sidebar = trigger?.closest(packaged['menu.sidebar']);
  const sidebarIdentity = () => {
    const target = sidebar && trigger ? resolveSidebarConversationTarget(trigger) : null;
    return target ? `${target.conversationId}\u0000${target.url}` : null;
  };
  const originalSidebarIdentity = sidebarIdentity();
  const identity = promptPageScope();
  const current = () =>
    button.isConnected &&
    panel.contains(button) &&
    panel.isConnected &&
    trigger !== null &&
    trigger.isConnected &&
    trigger.parentElement === triggerParent &&
    sidebarIdentity() === originalSidebarIdentity &&
    associatedMenuTrigger(panel) === trigger &&
    identity === promptPageScope();
  const action = startMachine<{ status: 'open' } | { status: 'ended' }, { type: 'cancel' }>(
    {
      id: 'onlineConversationMenuAction',
      transition: () => ({ status: 'ended' }),
      effects: {
        open: (stay) => {
          const cancel = () => stay.send({ type: 'cancel' });
          button.addEventListener(RETIRE_ACTION_EVENT, cancel);
          stay.scope.effect(() => () => button.removeEventListener(RETIRE_ACTION_EVENT, cancel));
          const outside = (event: Event) => {
            if (isVoyagerLayerEvent(event)) return;
            const node = event.target;
            if (node instanceof Node && (panel.contains(node) || trigger?.contains(node))) return;
            cancel();
          };
          const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') cancel();
          };
          document.addEventListener('pointerdown', outside, true);
          document.addEventListener('click', outside, true);
          document.addEventListener('keydown', escape, true);
          stay.scope.effect(() => () => {
            document.removeEventListener('pointerdown', outside, true);
            document.removeEventListener('click', outside, true);
            document.removeEventListener('keydown', escape, true);
          });
          stay.scope.effect(() =>
            watchMenuActionIdentity(panel, button, trigger, sidebar, () => {
              if (!current()) cancel();
            }),
          );
          stay.scope.effect(() => watchMenuPageScope(cancel));
        },
        ended: () => {
          // A cancelled action must not leave an inert item in a menu Gemini kept open.
          if (button.isConnected) button.remove();
        },
      },
    },
    { status: 'open' },
  );
  const isCurrent = () => {
    if (!current()) action.send({ type: 'cancel' });
    return action.state.status === 'open';
  };
  onlineMenuActions.remember(button, isCurrent);
  return isCurrent;
}

type TaskState = { status: 'waiting' } | { status: 'running' } | { status: 'ended' };
type TaskEvent = { type: 'run' } | { type: 'cancel' };

/** Each delayed injection owns its phase, so dismissals cannot revive a recycled panel. */
export function createMenuTaskQueue(): {
  schedule(run: () => void, delay: number): void;
  stop(): void;
} {
  const tasks = new Set<Machine<TaskState, TaskEvent>>();
  return {
    schedule(run, delay) {
      const online = hasOnlineMenuTargets();
      const identity = online ? promptPageScope() : '';
      const task = startMachine<TaskState, TaskEvent>(
        {
          id: 'conversationMenuInjection',
          transition: (state, event) =>
            event.type === 'cancel'
              ? { status: 'ended' }
              : state.status === 'waiting'
                ? { status: 'running' }
                : state,
          effects: {
            waiting: (stay) => {
              if (online) {
                const cancel = () => stay.send({ type: 'cancel' });
                const outside = (event: Event) => {
                  if (isVoyagerLayerEvent(event)) return;
                  const node = event.target;
                  if (
                    node instanceof Element &&
                    node.closest(
                      `${packaged['menu.nativePanels']}, ${packaged['menu.conversationTriggers']}, ${packaged['menu.responseTrigger']}`,
                    )
                  )
                    return;
                  cancel();
                };
                const escape = (event: KeyboardEvent) => {
                  if (event.key === 'Escape') cancel();
                };
                document.addEventListener('pointerdown', outside, true);
                document.addEventListener('click', outside, true);
                document.addEventListener('keydown', escape, true);
                stay.scope.effect(() => () => {
                  document.removeEventListener('pointerdown', outside, true);
                  document.removeEventListener('click', outside, true);
                  document.removeEventListener('keydown', escape, true);
                });
                stay.scope.effect(() => watchMenuPageScope(cancel));
              }
              const timer = window.setTimeout(() => stay.send({ type: 'run' }), delay);
              stay.scope.effect(() => () => window.clearTimeout(timer));
            },
            running: (stay) => {
              if (!online || identity === promptPageScope()) run();
              stay.send({ type: 'cancel' });
            },
          },
        },
        { status: 'waiting' },
      );
      tasks.add(task);
      task.subscribe((state) => {
        if (state.status === 'ended') tasks.delete(task);
      });
    },
    stop() {
      for (const task of tasks) task.send({ type: 'cancel' });
      tasks.clear();
    },
  };
}
