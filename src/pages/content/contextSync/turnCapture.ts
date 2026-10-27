import { preservesGeminiContentFrames, readGeminiContentLeaves } from '@/core/gemini/content/reads';
import {
  GEMINI_TURN_PROFILE_KEYS,
  resolveGeminiSelectorOperationInView,
  type GeminiSelectorView,
} from '@/core/gemini/selectors';
import { GEMINI_CONTEXT_TEXT_PROFILE_KEYS } from '@/core/gemini/selectors/contentKeys';
import {
  acceptsGeminiTurnView,
  readGeminiTurnCollection,
  readGeminiTurnMatches,
} from '@/core/gemini/turnIntegrity';
import { filterTopLevel, sameItems } from '@/core/utils/array';
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

/** A renamed extraction boundary must preserve every native leaf of its original turn. */
function repairedContents(
  hosts: readonly HTMLElement[],
  original: HTMLElement[],
  candidates: HTMLElement[],
  fallbackHosts: Set<HTMLElement>,
): HTMLElement[] | null {
  if (original.length && !sameItems(candidates, original)) return null;
  const accepted: HTMLElement[] = [];
  for (const host of filterTopLevel([...hosts])) {
    const candidate = candidates.find((element) => host.contains(element));
    if (!candidate) return null;
    if (!original.includes(candidate)) {
      const native = readGeminiContentLeaves(host);
      // Equal text cannot prove a partial clone or another turn's extraction boundary.
      if (
        !preservesGeminiContentFrames(candidate, host) ||
        !sameItems(readGeminiContentLeaves(candidate), native)
      )
        return null;
      fallbackHosts.add(candidate);
    }
    accepted.push(candidate);
  }
  return sameItems(accepted, candidates) ? accepted : null;
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
  const repaired = (selected: GeminiSelectorView) =>
    [...GEMINI_TURN_PROFILE_KEYS, ...GEMINI_CONTEXT_TEXT_PROFILE_KEYS].some((key) =>
      selected.remoteKeys.has(key),
    );
  if (!repaired(view)) return bundled;

  // Both roles must share one complete, independently owned turn collection before capture starts.
  return (
    resolveGeminiSelectorOperationInView<ContextTurns | null>(
      view,
      (accepted) => {
        if (!repaired(accepted)) return bundled;
        if (!acceptsGeminiTurnView(accepted, doc)) return null;
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
        const queries = accepted.remoteKeys.has('context.users')
          ? repairedContents(
              users,
              originalUsers,
              readGeminiTurnMatches(doc.body, accepted.profiles['context.users'], true),
              fallbackHosts,
            )
          : contents(users, originalUsers, fallbackHosts);
        const replies = accepted.remoteKeys.has('context.responses')
          ? repairedContents(
              responses,
              originalResponses,
              readGeminiTurnMatches(doc.body, accepted.profiles['context.responses'], true),
              fallbackHosts,
            )
          : contents(responses, originalResponses, fallbackHosts);
        if (!queries || !replies) return null;
        return {
          queries,
          responses: replies,
          remote: true,
          fallbackHosts,
        };
      },
      // An orphan reply cannot establish a dialogue whose user turn was not captured.
      (result) => result !== null && result.queries.length > 0,
    ).value ?? bundled
  );
}
