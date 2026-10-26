import { acceptsGeminiContentCollection } from '@/core/gemini/content/reads';
import {
  resolveGeminiSelectorOperationInView,
  type GeminiSelectorView,
} from '@/core/gemini/selectors';
import { filterTopLevel } from '@/core/utils/array';

/** Direct exports use the same paired content preflight as conversation exports. */
export function checkedGeminiContentView(
  element: HTMLElement,
  role: 'user' | 'assistant',
  view: GeminiSelectorView,
): GeminiSelectorView {
  if (!view.remoteKeys.has('content.answer') && !view.remoteKeys.has('content.userLines'))
    return view;
  const owner = element.closest('.conversation-container');
  const collect = (selector: string): HTMLElement[] =>
    owner ? filterTopLevel(Array.from(owner.querySelectorAll<HTMLElement>(selector))) : [];
  const users = role === 'user' ? [element] : collect('user-query, .user-query-container');
  const assistants =
    role === 'assistant'
      ? [element]
      : collect('model-response, .model-response, response-container, .response-container');
  // Rejecting either half must also reject repairs in its paired prompt or answer.
  return resolveGeminiSelectorOperationInView(
    view,
    (candidate) => candidate,
    (candidate) => acceptsGeminiContentCollection(users, assistants, candidate),
  ).value;
}
