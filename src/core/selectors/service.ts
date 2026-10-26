import { type Machine, startMachine } from '@/features/plugins/runtime/stateMachine';

import { getBundledSiteSelectorView, getSiteBundledRevision } from './bundle';
import { SITE_SELECTOR_CONTRACTS } from './contracts';
import { CHATGPT_PAGE_HOOK_KEYS } from './contracts/chatgptSemantics';
import {
  type SiteSelectorSettlement,
  type HydrationEvent,
  type HydrationState,
  createHydrationEffects,
  hydrationTransition,
} from './hydration';
import { BUNDLED_LOCATOR_SITES, locatorSiteForHost } from './sites';
import type { SiteSelectorOperation, SiteSelectorView } from './types';
import { isSelectorRecord, readSiteSelectorGroups } from './validation';

export interface SiteSelectorInitialization {
  readonly host: string;
  readonly doc: Document;
  readonly lifetime: AbortSignal;
  readonly read: () => Promise<unknown>;
  readonly invalidatedBy?: (invalidate: () => void) => () => void;
  readonly bundledRevision?: number;
  readonly timeoutMs?: number;
}

export interface SiteSelectorLifetime {
  readonly ready: Promise<SiteSelectorSettlement>;
  readonly stop: () => void;
  readonly isCurrent: () => boolean;
}

/** One owner per site in a content-script instance; feature reads never touch storage. */
export class SiteSelectorService<Key extends string = string> {
  private view: SiteSelectorView<Key>;
  private active: Machine<HydrationState, HydrationEvent> | null = null;

  constructor(private readonly siteId: string) {
    this.view = this.bundle();
  }

  private bundle(): SiteSelectorView<Key> {
    return getBundledSiteSelectorView(this.siteId) as SiteSelectorView<Key>;
  }

  getView(): SiteSelectorView<Key> {
    return this.view;
  }

  initialize(input: SiteSelectorInitialization): SiteSelectorLifetime {
    this.active?.send({ type: 'retire' });
    this.view = this.bundle();
    let settle: (settlement: SiteSelectorSettlement) => void = () => undefined;
    const ready = new Promise<SiteSelectorSettlement>((resolve) => {
      settle = resolve;
    });
    const hydration = startMachine<HydrationState, HydrationEvent>(
      {
        id: 'siteSelectorHydration',
        transition: hydrationTransition,
        effects: createHydrationEffects({
          lifetime: input.lifetime,
          timeoutMs: input.timeoutMs ?? 250,
          read: input.read,
          toView: (raw) => toRemoteView(this.siteId, raw, input),
          invalidatedBy: input.invalidatedBy,
          install: (view) => {
            this.view = view as SiteSelectorView<Key>;
          },
          release: (view) => {
            // An old initializer cannot clear the snapshot installed by its replacement.
            if (this.view === view) this.view = this.bundle();
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
    read: (view: SiteSelectorView<Key>) => T,
    isUsable: (value: T) => boolean,
  ): SiteSelectorOperation<T, Key> {
    return resolveSiteSelectorOperationInView(this.view, read, isUsable);
  }
}

const SERVICES: Readonly<Record<string, SiteSelectorService>> = Object.freeze(
  Object.fromEntries(
    BUNDLED_LOCATOR_SITES.map((site) => [site.id, new SiteSelectorService(site.id)]),
  ),
);

export function initializeSiteSelectors(
  siteId: string,
  input: SiteSelectorInitialization,
): SiteSelectorLifetime {
  return SERVICES[siteId].initialize(input);
}

export function getSiteSelectorView(siteId: string): SiteSelectorView {
  return SERVICES[siteId]?.getView() ?? getBundledSiteSelectorView(siteId);
}

/** Pure read, then one whole-operation fallback. Owners prove identity before committing effects. */
export function resolveSiteSelectorOperationInView<T, Key extends string = string>(
  view: SiteSelectorView<Key>,
  read: (view: SiteSelectorView<Key>) => T,
  isUsable: (value: T) => boolean,
): SiteSelectorOperation<T, Key> {
  const bundle = getBundledSiteSelectorView(view.siteId) as SiteSelectorView<Key>;
  if (view.remoteKeys.size === 0) return { value: read(bundle), view: bundle };
  try {
    const value = read(view);
    if (isUsable(value)) return { value, view };
  } catch {
    // No rejected remote collection is combined with bundled descendants.
  }
  return { value: read(bundle), view: bundle };
}

export function resolveSiteSelectorOperation<T>(
  siteId: string,
  read: (view: SiteSelectorView) => T,
  isUsable: (value: T) => boolean,
): SiteSelectorOperation<T> {
  return SERVICES[siteId].resolve(read, isUsable);
}

/** One source mapping serves startup's no-op check and the validated hydration read. */
function siteSelectorCandidates(
  siteId: string,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const contract = SITE_SELECTOR_CONTRACTS[siteId];
  const semantic = BUNDLED_LOCATOR_SITES.find((site) => site.id === siteId)?.selectors ?? {};
  const candidates: Record<string, unknown> = isSelectorRecord(raw.locators)
    ? { ...raw.locators }
    : {};
  // Semantic keys have one source, site.selectors; a duplicate locator must not override it.
  for (const key of contract.keys) {
    if (!Object.hasOwn(semantic, key)) continue;
    delete candidates[key];
    if (isSelectorRecord(raw.selectors) && Object.hasOwn(raw.selectors, key))
      candidates[key] = [raw.selectors[key]];
  }
  if (siteId === 'chatgpt') {
    for (const [key, field] of Object.entries(CHATGPT_PAGE_HOOK_KEYS)) {
      delete candidates[key];
      if (isSelectorRecord(raw.pageHooks) && Object.hasOwn(raw.pageHooks, field))
        candidates[key] = [raw.pageHooks[field]];
    }
  }
  return candidates;
}

export function hasSiteSelectorChanges(siteId: string, raw: unknown): boolean {
  if (!isSelectorRecord(raw)) return false;
  const candidates = siteSelectorCandidates(siteId, raw);
  const bundle = getBundledSiteSelectorView(siteId).profiles;
  return SITE_SELECTOR_CONTRACTS[siteId].keys.some(
    (key) =>
      Object.hasOwn(candidates, key) &&
      JSON.stringify(candidates[key]) !== JSON.stringify(bundle[key]),
  );
}

function toRemoteView(
  siteId: string,
  raw: unknown,
  input: SiteSelectorInitialization,
): SiteSelectorView | null {
  if (locatorSiteForHost(input.host) !== siteId || !isSelectorRecord(raw) || raw.id !== siteId)
    return null;
  const revision = raw.catalogRevision;
  if (
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision <= (input.bundledRevision ?? getSiteBundledRevision())
  )
    return null;
  const candidates = siteSelectorCandidates(siteId, raw);
  if (raw.locators !== undefined && !isSelectorRecord(raw.locators)) return null;
  const accepted = readSiteSelectorGroups(siteId, candidates, (selector) => {
    input.doc.querySelector(selector);
    return true;
  });
  if (!accepted) return null;
  const profiles = { ...getBundledSiteSelectorView(siteId).profiles };
  const remoteKeys = new Set<string>();
  for (const [key, list] of Object.entries(accepted.profiles)) {
    if (JSON.stringify(list) === JSON.stringify(profiles[key])) continue;
    profiles[key] = list;
    remoteKeys.add(key);
  }
  return Object.freeze({ siteId, profiles: Object.freeze(profiles), remoteKeys, revision });
}
