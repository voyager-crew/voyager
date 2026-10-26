import { type Machine, startMachine } from '@/features/plugins/runtime/stateMachine';

import { acceptsGeminiTurnView } from '../turnIntegrity';
import { getBundledGeminiSelectorView, getGeminiBundledRevision } from './bundle';
import {
  type GeminiSelectorSettlement,
  type HydrationEvent,
  type HydrationState,
  createHydrationEffects,
  hydrationTransition,
} from './hydration';
import {
  GEMINI_SELECTOR_PROFILE_GROUPS,
  GEMINI_TURN_PROFILE_KEYS,
  type GeminiSelectorOperation,
  type GeminiSelectorProfileKey,
  type GeminiSelectorView,
  type GeminiTurnOperation,
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
  private view = getBundledGeminiSelectorView();
  private active: Machine<HydrationState, HydrationEvent> | null = null;

  getView(): GeminiSelectorView {
    return this.view;
  }

  initialize(input: GeminiSelectorInitialization): GeminiSelectorLifetime {
    this.active?.send({ type: 'retire' });
    this.view = getBundledGeminiSelectorView();
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
            if (this.view === view) this.view = getBundledGeminiSelectorView();
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
    read: (view: GeminiSelectorView) => T,
    isUsable: (value: T) => boolean,
  ): GeminiSelectorOperation<T> {
    return resolveGeminiSelectorOperationInView(this.view, read, isUsable);
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

export function getGeminiSelectorView(): GeminiSelectorView {
  return service.getView();
}

/** Read against one captured snapshot, falling back by rerunning the complete pure operation. */
export function resolveGeminiSelectorOperationInView<T>(
  view: GeminiSelectorView,
  read: (view: GeminiSelectorView) => T,
  isUsable: (value: T) => boolean,
): GeminiSelectorOperation<T> {
  const bundle = getBundledGeminiSelectorView();
  if (view.remoteKeys.size === 0) return { value: read(bundle), view: bundle };
  try {
    const value = read(view);
    if (isUsable(value)) return { value, view };
  } catch {
    // Query errors cannot combine a rejected remote collection with bundled descendants.
  }
  return { value: read(bundle), view: bundle };
}

export function resolveGeminiSelectorOperation<T>(
  read: (view: GeminiSelectorView) => T,
  isUsable: (value: T) => boolean,
): GeminiSelectorOperation<T> {
  return service.resolve(read, isUsable);
}

/** The callback is a pure read; the owner commits IDs/DOM/storage only after selecting its view. */
export function resolveGeminiTurnOperation<T>(
  read: (view: GeminiTurnView) => T,
  isUsable: (value: T) => boolean,
  view: GeminiTurnView = service.getView(),
): GeminiTurnOperation<T> {
  if (!GEMINI_TURN_PROFILE_KEYS.some((key) => view.remoteKeys.has(key))) {
    const bundle = getBundledGeminiSelectorView();
    return { value: read(bundle), view: bundle };
  }
  if (!acceptsGeminiTurnView(view)) {
    const bundle = getBundledGeminiSelectorView();
    return { value: read(bundle), view: bundle };
  }
  return resolveGeminiSelectorOperationInView(view, read, isUsable);
}

function toRemoteView(
  raw: unknown,
  input: GeminiSelectorInitialization,
): GeminiSelectorView | null {
  const file = readGeminiSelectorFile(raw, input.host);
  const floor = input.bundledRevision ?? getGeminiBundledRevision();
  if (!file || file.catalogRevision <= floor) return null;
  const profiles = { ...getBundledGeminiSelectorView().profiles };
  const remoteKeys = new Set<GeminiSelectorProfileKey>();
  for (const group of GEMINI_SELECTOR_PROFILE_GROUPS) {
    const changed: Array<readonly [GeminiSelectorProfileKey, readonly string[]]> = [];
    try {
      for (const key of group) {
        const list = file.selectors[key];
        if (!list) continue;
        for (const selector of list) input.doc.querySelector(selector);
        if (JSON.stringify(list) !== JSON.stringify(profiles[key])) changed.push([key, list]);
      }
    } catch {
      // One unsupported selector drops its whole surface, before any consumer sees it.
      continue;
    }
    for (const [key, list] of changed) {
      profiles[key] = list;
      remoteKeys.add(key);
    }
  }
  return Object.freeze({
    profiles: Object.freeze(profiles),
    remoteKeys,
    revision: file.catalogRevision,
  });
}
