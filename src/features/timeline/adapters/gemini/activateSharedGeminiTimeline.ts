import type { Dispose, PluginScope } from '@/features/plugins/runtime/pluginScope';
import { startMachine } from '@/features/plugins/runtime/stateMachine';
import type { PluginSettings } from '@/features/plugins/types';
import type { PrimitiveHandle } from '@/features/plugins/verbs/types';
import {
  GeminiTimelineAdapter,
  type GeminiTimelineOptions,
} from '@/pages/content/timeline/GeminiTimelineAdapter';
import {
  type GeminiTimelineRail,
  startGeminiTimelineRail,
} from '@/pages/content/timeline/startGeminiTimelineRail';
import { whenHistoryTimestampsReady } from '@/pages/content/timestamp/historyTimestampPageService';
import { whenMessageTimestampsReady } from '@/pages/content/timestamp/messageTimestampPageService';

import { TimelineEngine } from '../../TimelineEngine';

type StartupState = { readonly status: 'waiting' } | { readonly status: 'ready' };
type StartupEvent = { readonly type: 'ready' };

const transition = (state: StartupState, event: StartupEvent): StartupState =>
  state.status === 'waiting' && event.type === 'ready' ? { status: 'ready' } : state;

/** Gemini's data backend retains native identity, hierarchy, annotations and page-cache readiness. */
export function activateSharedGeminiTimeline(
  scope: PluginScope,
  options: Pick<GeminiTimelineOptions, 'position' | 'scrollContainer'>,
  settings: PluginSettings | null,
): PrimitiveHandle {
  let currentSettings = settings;
  let rail: GeminiTimelineRail | null = null;
  let stopStart: Dispose | null = null;
  scope.effect(() => {
    const machine = startMachine<StartupState, StartupEvent>(
      {
        id: 'shared-gemini-timeline',
        transition,
        effects: {
          waiting(stay) {
            // Wait for both caches to settle; only history owns admission to shared account data.
            void Promise.all([
              whenHistoryTimestampsReady(stay.signal, { requirePageService: true }),
              whenMessageTimestampsReady(stay.signal),
            ]).then(([historyReady]) => {
              // Message times are optional: a failed read must not hide the rail (TimelineTimestamps.init).
              if (historyReady) stay.send({ type: 'ready' });
            });
          },
          ready(stay) {
            rail = startGeminiTimelineRail({
              signal: stay.signal,
              createEngine: (previousUrl) => {
                const engine = new TimelineEngine(
                  new GeminiTimelineAdapter({ ...options, previousUrl }),
                  stay.signal,
                );
                // The official rail's null keeps every knob on its existing sync key.
                if (currentSettings) engine.updateSettings(currentSettings);
                return engine;
              },
              start: (engine) => {
                void stopStart?.();
                stopStart = stay.scope.effect(
                  () =>
                    engine.init().then(() => {
                      if (!stay.signal.aborted && rail?.engine === engine && currentSettings)
                        engine.updateSettings(currentSettings);
                      return () => engine.destroy();
                    }),
                  'shared-gemini-timeline-start',
                );
              },
            });
            stay.scope.effect(() => () => {
              rail?.stop();
              rail = null;
            });
          },
        },
      },
      { status: 'waiting' },
    );
    // Abort retires the rail before the parent ledger can wait for a slow unrelated disposer.
    const stop = () => void machine.stop();
    scope.signal.addEventListener('abort', stop, { once: true });
    return () => {
      scope.signal.removeEventListener('abort', stop);
      return machine.stop();
    };
  }, 'shared-gemini-timeline');
  return {
    updateSettings(next) {
      currentSettings = next;
      rail?.engine?.updateSettings(next);
    },
  };
}
