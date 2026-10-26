/**
 * The first gates of `initializeFeatures`, before any Gemini or AI Studio
 * start point. A host that a custom-website entry covers (an entry such as
 * `google.com` covers gemini.google.com) gets the Prompt Manager only; Gemini
 * Enterprise (business.gemini.google, Enterprise URL hints, Enterprise DOM
 * hints) gets the Prompt Manager panel only. Either way initialization ends
 * here, so no start point runs and no packaged official plugin is admitted.
 */
import { isGeminiEnterpriseEnvironment } from '@/core/utils/gemini';

import { readPromptCoverage } from './prompt/promptManagerEngine';

export type InitializationEntry = 'custom-coverage' | 'enterprise' | 'start-points';

export interface InitializationEntryDeps {
  /** Wraps every await, so a retired page stops at it (see `pageInitSteps`). */
  settle: <T>(work: Promise<T>) => Promise<T>;
  followCoverage: (host: string) => Promise<void>;
  /** Mounted between the two gates, as it always was. */
  mountEdgeNotice: () => Promise<unknown>;
  startEnterprisePanel: () => Promise<void>;
  readCoverage?: (host: string) => Promise<boolean>;
  /** Freeze already available page data after the existing coverage read, before any mount. */
  beforeMount?: () => void;
}

export async function enterInitialization(
  page: Pick<Location, 'host' | 'hostname' | 'pathname' | 'search' | 'hash'>,
  doc: Document,
  deps: InitializationEntryDeps,
): Promise<InitializationEntry> {
  const readCoverage = deps.readCoverage ?? readPromptCoverage;
  const covered = await deps.settle(readCoverage(page.host));
  deps.beforeMount?.();
  if (covered) {
    await deps.settle(deps.followCoverage(page.host));
    return 'custom-coverage';
  }

  await deps.settle(deps.mountEdgeNotice());

  const isEnterprise = isGeminiEnterpriseEnvironment(
    { hostname: page.hostname, pathname: page.pathname, search: page.search, hash: page.hash },
    doc,
  );
  if (isEnterprise) {
    await deps.settle(deps.startEnterprisePanel());
    return 'enterprise';
  }
  return 'start-points';
}
