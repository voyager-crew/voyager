import { getBundledGeminiTurnView, getGeminiBundledRevision } from './bundle';
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
  readonly bundledRevision?: number;
  readonly timeoutMs?: number;
}

export interface GeminiSelectorLifetime {
  readonly ready: Promise<void>;
  readonly stop: () => void;
}

/** One state owner per content-script instance; consumers never read storage. */
export class GeminiSelectorService {
  private view = getBundledGeminiTurnView();
  private owner: symbol | null = null;

  getView(): GeminiTurnView {
    return this.view;
  }

  initialize(input: GeminiSelectorInitialization): GeminiSelectorLifetime {
    const owner = Symbol('Gemini selectors');
    this.owner = owner;
    this.view = getBundledGeminiTurnView();
    let settled = false;
    let resolveReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolveReady();
    };
    const stop = () => {
      finish();
      input.lifetime.removeEventListener('abort', stop);
      // A retired initializer must not clear the snapshot owned by its replacement.
      if (this.owner === owner) {
        this.owner = null;
        this.view = getBundledGeminiTurnView();
      }
    };
    if (input.lifetime.aborted) {
      stop();
      return { ready, stop };
    }
    input.lifetime.addEventListener('abort', stop, { once: true });
    // A stalled extension API must not hold feature startup behind a network-sized timeout.
    timer = setTimeout(finish, input.timeoutMs ?? 250);
    void Promise.resolve()
      .then(() => (settled || input.lifetime.aborted || this.owner !== owner ? null : input.read()))
      .then((raw) => {
        if (settled || input.lifetime.aborted || this.owner !== owner) return;
        const file = readGeminiSelectorFile(raw, input.host);
        const floor = input.bundledRevision ?? getGeminiBundledRevision();
        if (!file || file.catalogRevision <= floor) return;
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
        this.view = Object.freeze({
          profiles: Object.freeze(profiles),
          remoteKeys,
          revision: file.catalogRevision,
        });
      })
      .catch(() => {
        // Storage errors and native syntax errors both leave the complete bundled view in place.
      })
      .finally(finish);
    return { ready, stop };
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
