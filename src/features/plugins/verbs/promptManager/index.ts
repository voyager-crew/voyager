/** PluginHost owns the panel's lifetime; its existing engine owns the behavior. */
import { CleanupManager } from '@/core/utils/cleanupManager';
import { createPromptManagerEngine } from '@/pages/content/prompt/promptManagerEngine';
import { resolvePromptSiteAdapter } from '@/pages/content/prompt/resolvePromptSiteAdapter';

import type { ManifestIssue } from '../../manifest/validate';
import { startMachine } from '../../runtime/stateMachine';
import { getPrimitiveContract } from '../contracts';
import type { Primitive } from '../types';

type State =
  | { readonly status: 'starting' }
  | { readonly status: 'mounted'; readonly stop: () => void };
type Event = { readonly type: 'mounted'; readonly stop: () => void };

function transition(state: State, event: Event): State {
  return state.status === 'starting' ? { status: 'mounted', stop: event.stop } : state;
}

export const promptManagerPrimitive: Primitive<Readonly<Record<string, never>>> = {
  contract: getPrimitiveContract('promptManager')!,
  validateParams(raw: unknown) {
    if (raw !== undefined && (typeof raw !== 'object' || raw === null || Array.isArray(raw))) {
      return { success: false, error: [{ path: 'params', message: 'must be an object' }] };
    }
    const issues: ManifestIssue[] = Object.keys(raw ?? {}).map((key) => ({
      path: `params.${key}`,
      message: 'unknown parameter',
    }));
    return issues.length ? { success: false, error: issues } : { success: true, data: {} };
  },
  activate(scope, _params, context) {
    context.setTargetCounter(() => context.doc.querySelectorAll('#gv-pm-trigger').length);
    // The content entry has always kept Prompt Manager out of catalog subframes.
    const view = context.doc.defaultView;
    if (!view || view.top !== view.self) return;
    const machine = startMachine<State, Event>(
      {
        id: 'prompt-manager',
        transition,
        effects: {
          starting(stay) {
            stay.scope.effect(async () => {
              const cleanup = new CleanupManager();
              const engine = createPromptManagerEngine(
                resolvePromptSiteAdapter(context.doc.URL),
                cleanup,
                scope.signal,
              );
              await engine.startPanel();
              const stop = () => cleanup.executeCleanups();
              // Only the mounted state adopts a successful start. A cancelled
              // start remains owned here, including its late-arriving teardown.
              if (stay.signal.aborted) return stop;
              stay.send({ type: 'mounted', stop });
              return () => {};
            }, 'prompt-manager:start');
          },
          mounted(stay) {
            stay.scope.effect(() => stay.state().stop, 'prompt-manager:panel');
          },
        },
      },
      { status: 'starting' },
    );
    scope.effect(() => () => machine.stop(), 'prompt-manager:lifetime');
  },
};
