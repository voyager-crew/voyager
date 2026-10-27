import { acceptsGeminiContentCollection } from '@/core/gemini/content/reads';
import {
  GEMINI_TURN_PROFILE_KEYS,
  getBundledGeminiSelectorView,
  resolveGeminiSelectorOperationInView,
  type GeminiSelectorView,
} from '@/core/gemini/selectors';
import {
  acceptsGeminiTurnView,
  isGeminiTurnMatch,
  readGeminiTurnMatches,
} from '@/core/gemini/turnIntegrity';
import { filterTopLevel } from '@/core/utils/array';

/** Direct exports use the same paired content preflight as conversation exports. */
export function checkedGeminiContentView(
  element: HTMLElement,
  role: 'user' | 'assistant',
  view: GeminiSelectorView,
): GeminiSelectorView {
  if (!view.remoteKeys.has('content.answer') && !view.remoteKeys.has('content.userLines'))
    return view;
  const repairedTurns = GEMINI_TURN_PROFILE_KEYS.some((key) => view.remoteKeys.has(key));
  if (
    repairedTurns &&
    (!element.ownerDocument.body.contains(element) ||
      !isGeminiTurnMatch(element) ||
      !acceptsGeminiTurnView(view, element.ownerDocument))
  )
    return getBundledGeminiSelectorView();
  const owner = element.closest<HTMLElement>('.conversation-container');
  const collect = (selector: string): HTMLElement[] =>
    !owner
      ? []
      : repairedTurns
        ? readGeminiTurnMatches(owner, [selector])
        : filterTopLevel(Array.from(owner.querySelectorAll<HTMLElement>(selector)));
  // A renamed counterpart still participates in the all-or-nothing content proof.
  const users =
    role === 'user' && !repairedTurns
      ? [element]
      : collect(
          repairedTurns
            ? [...view.profiles['turn.user'], ...view.profiles['turn.userWithHosts']].join(',')
            : 'user-query, .user-query-container',
        );
  const assistants =
    role === 'assistant' && !repairedTurns
      ? [element]
      : collect(
          repairedTurns
            ? [
                ...view.profiles['turn.assistant'],
                ...view.profiles['turn.assistantWithHosts'],
                ...view.profiles['turn.assistantFallback'],
              ].join(',')
            : 'model-response, .model-response, response-container, .response-container',
        );
  if (
    repairedTurns &&
    !(role === 'user' ? users : assistants).some((host) => host.contains(element))
  )
    return getBundledGeminiSelectorView();
  // Rejecting either half must also reject repairs in its paired prompt or answer.
  return resolveGeminiSelectorOperationInView(
    view,
    (candidate) => candidate,
    (candidate) =>
      acceptsGeminiContentCollection(
        role === 'user' ? [element] : users,
        role === 'assistant' ? [element] : assistants,
        candidate,
      ),
  ).value;
}
