import {
  GEMINI_TURN_PROFILE_KEYS,
  resolveGeminiTurnOperation,
  type GeminiSelectorView,
} from '@/core/gemini/selectors';
import { readGeminiTurnCollection, readGeminiTurnMatches } from '@/core/gemini/turnIntegrity';
import { filterTopLevel } from '@/core/utils/array';
import type { AdapterConfig } from '@/features/contextSync/types';

interface ContextTurns {
  readonly queries: HTMLElement[];
  readonly responses: HTMLElement[];
  readonly remote: boolean;
  readonly fallbackHosts: ReadonlySet<HTMLElement>;
}

/** Keep the original extraction boundaries where they survive inside a proven turn. */
function contents(
  hosts: readonly HTMLElement[],
  original: HTMLElement[],
  fallbackHosts: Set<HTMLElement>,
): HTMLElement[] {
  return filterTopLevel([...hosts]).flatMap((host) => {
    const existing = original.filter((element) => host.contains(element));
    if (!existing.length) fallbackHosts.add(host);
    return existing.length ? existing : [host];
  });
}

export function readContextTurns(
  adapter: AdapterConfig,
  view: GeminiSelectorView,
  doc: Document = document,
): ContextTurns {
  const query = (selectors: readonly string[]) =>
    Array.from(doc.querySelectorAll<HTMLElement>(selectors.join(',')));
  const bundled = {
    queries: adapter.user_selector && adapter.ai_selector ? query(adapter.user_selector) : [],
    responses: adapter.user_selector && adapter.ai_selector ? query(adapter.ai_selector) : [],
    remote: false,
    fallbackHosts: new Set<HTMLElement>(),
  };
  if (!GEMINI_TURN_PROFILE_KEYS.some((key) => view.remoteKeys.has(key))) return bundled;

  // Both roles must share one complete, independently owned turn collection before capture starts.
  return resolveGeminiTurnOperation(
    (accepted) => {
      if (!GEMINI_TURN_PROFILE_KEYS.some((key) => accepted.remoteKeys.has(key))) return bundled;
      const primary = readGeminiTurnCollection(accepted, doc, false);
      const hosts = readGeminiTurnCollection(accepted, doc, true);
      const users = accepted.remoteKeys.has('turn.user') ? primary.users : hosts.users;
      const responses =
        accepted.remoteKeys.has('turn.assistant') ||
        accepted.remoteKeys.has('turn.assistantFallback')
          ? primary.assistants
          : hosts.assistants;
      const fallbackHosts = new Set<HTMLElement>();
      const originalUsers = adapter.user_selector
        ? readGeminiTurnMatches(doc.body, adapter.user_selector, true)
        : [];
      const originalResponses = adapter.ai_selector
        ? readGeminiTurnMatches(doc.body, adapter.ai_selector, true)
        : [];
      return {
        queries: contents(users, originalUsers, fallbackHosts),
        responses: contents(responses, originalResponses, fallbackHosts),
        remote: true,
        fallbackHosts,
      };
    },
    ({ queries }) => queries.length > 0,
    view,
  ).value;
}
