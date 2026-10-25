import { type Machine, startMachine } from '@/features/plugins/runtime/stateMachine';

import { getBundledGeminiTurnView, getGeminiBundledRevision } from './bundle';
import {
  type GeminiSelectorSettlement,
  type HydrationEvent,
  type HydrationState,
  createHydrationEffects,
  hydrationTransition,
} from './hydration';
import {
  GEMINI_TURN_PROFILE_KEYS,
  type GeminiTurnOperation,
  type GeminiTurnProfileKey,
  type GeminiTurnView,
} from './types';
import { readGeminiSelectorFile } from './validation';

export interface GeminiSelectorInitialization {
  readonly host: string;
  readonly doc: Document;
  readonly lifetime: AbortSignal;
  readonly read: () => Promise<unknown>;
  /** Subscribes to changes that make a pending read stale; unsubscribed once it settles. */
  readonly invalidatedBy?: (invalidate: () => void) => () => void;
  readonly bundledRevision?: number;
  readonly timeoutMs?: number;
}

export interface GeminiSelectorLifetime {
  readonly ready: Promise<GeminiSelectorSettlement>;
  readonly stop: () => void;
  /** False once stopped, replaced or past the page lifetime. */
  readonly isCurrent: () => boolean;
}

/** One state owner per content-script instance; consumers never read storage. */
export class GeminiSelectorService {
  private view = getBundledGeminiTurnView();
  private active: Machine<HydrationState, HydrationEvent> | null = null;

  getView(): GeminiTurnView {
    return this.view;
  }

  initialize(input: GeminiSelectorInitialization): GeminiSelectorLifetime {
    this.active?.send({ type: 'retire' });
    this.view = getBundledGeminiTurnView();
    let settle: (settlement: GeminiSelectorSettlement) => void = () => undefined;
    const ready = new Promise<GeminiSelectorSettlement>((resolve) => {
      settle = resolve;
    });
    const hydration = startMachine<HydrationState, HydrationEvent>(
      {
        id: 'geminiSelectorHydration',
        transition: hydrationTransition,
        effects: createHydrationEffects({
          lifetime: input.lifetime,
          timeoutMs: input.timeoutMs ?? 250,
          read: input.read,
          toView: (raw) => toRemoteView(raw, input),
          invalidatedBy: input.invalidatedBy,
          install: (view) => {
            this.view = view;
          },
          release: (view) => {
            // A retired initializer must not clear the snapshot owned by its replacement.
            if (this.view === view) this.view = getBundledGeminiTurnView();
          },
          settle: (settlement) => settle(settlement),
        }),
      },
      input.lifetime.aborted ? { status: 'retired', view: null } : { status: 'reading' },
    );
    this.active = hydration;
    return {
      ready,
      stop: () => hydration.send({ type: 'retire' }),
      isCurrent: () => hydration.state.status !== 'retired',
    };
  }

  resolve<T>(
    read: (view: GeminiTurnView) => T,
    isUsable: (value: T) => boolean,
  ): GeminiTurnOperation<T> {
    const view = this.view;
    const bundle = getBundledGeminiTurnView();
    if (view.remoteKeys.size === 0) return { value: read(bundle), view: bundle };
    try {
      const value = read(view);
      if (isUsable(value)) return { value, view };
    } catch {
      // Query errors cannot combine a rejected remote collection with bundled descendants.
    }
    return { value: read(bundle), view: bundle };
  }
}

const service = new GeminiSelectorService();

export function initializeGeminiSelectors(
  input: GeminiSelectorInitialization,
): GeminiSelectorLifetime {
  return service.initialize(input);
}

export function getGeminiTurnView(): GeminiTurnView {
  return service.getView();
}

/** The callback is a pure read; the owner commits IDs/DOM/storage only after selecting its view. */
export function resolveGeminiTurnOperation<T>(
  read: (view: GeminiTurnView) => T,
  isUsable: (value: T) => boolean,
): GeminiTurnOperation<T> {
  return service.resolve(read, isUsable);
}

function toRemoteView(raw: unknown, input: GeminiSelectorInitialization): GeminiTurnView | null {
  const file = readGeminiSelectorFile(raw, input.host);
  const floor = input.bundledRevision ?? getGeminiBundledRevision();
  if (!file || file.catalogRevision <= floor) return null;
  const profiles = { ...getBundledGeminiTurnView().profiles };
  const remoteKeys = new Set<GeminiTurnProfileKey>();
  for (const key of GEMINI_TURN_PROFILE_KEYS) {
    const list = file.selectors[key];
    if (!list) continue;
    // One unsupported selector rejects the whole page patch, before any consumer sees it.
    for (const selector of list) input.doc.querySelector(selector);
    if (JSON.stringify(list) === JSON.stringify(profiles[key])) continue;
    profiles[key] = list;
    remoteKeys.add(key);
  }
  return Object.freeze({
    profiles: Object.freeze(profiles),
    remoteKeys,
    revision: file.catalogRevision,
  });
}
