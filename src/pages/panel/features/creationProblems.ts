import { useMemo } from 'react';

import {
  CREATION_CHECK_MESSAGES,
  type CreationCheck,
  type CreationProblem,
  parseCreationChecks,
} from '@/features/plugins/local/creation/creationChecks';
import type { PluginStatus } from '@/features/plugins/runtime/pluginStatus';
import type { ScriptedRunState } from '@/features/plugins/scripted/types';
import type { TabRequester } from '@/pages/popup/hooks/currentTab';

import { usePageFact } from '../hooks/pageFact';

/** A page that just moved or a creation just switched on is still rendering. */
const CHECK_SETTLE_MS = 1500;

/** A restyling creation the page runs, so its check means something. */
export interface WatchedCreation {
  readonly id: string;
  readonly version: string;
}

/**
 * A restyling creation's problem: it is on, the page reports it running, and
 * the page checked this very version and found nothing it matches. Anything
 * unknown (no status, no check, an older version's check) is no problem.
 */
export function restylingProblem(
  enabled: boolean,
  status: PluginStatus | undefined,
  check: CreationCheck | undefined,
): CreationProblem | null {
  const running = status?.kind === 'mounted' || status?.kind === 'no-effect';
  if (!enabled || !running || !check || check.version !== status.version) return null;
  return check.verdict === 'nothing' ? 'nothing-matches' : null;
}

/** A creation that runs code has a problem the AI can fix only when it froze a page. */
export function codeProblem(state: ScriptedRunState): CreationProblem | null {
  return state.kind === 'paused' && state.reason === 'crash-guard' ? 'froze' : null;
}

/** Whether the creations running on this page find anything here, asked again when either changes. */
export function useCreationChecks(
  requestTab: TabRequester | null,
  pageUrl: string,
  watched: readonly WatchedCreation[],
): ReadonlyMap<string, CreationCheck> {
  const key =
    requestTab && watched.length > 0
      ? [pageUrl, ...watched.map(({ id, version }) => `${id}@${version}`).sort()].join('\n')
      : null;
  const state = usePageFact<readonly CreationCheck[]>(
    key,
    async () =>
      requestTab
        ? parseCreationChecks(await requestTab({ type: CREATION_CHECK_MESSAGES.check }))
        : null,
    CHECK_SETTLE_MS,
  );
  return useMemo(
    () => new Map(state.status === 'known' ? state.fact.map((check) => [check.id, check]) : []),
    [state],
  );
}
