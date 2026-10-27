import { readChatInput } from '@/core/gemini/composer/inputs';
import { findOwnedGeminiMainInputs } from '@/core/gemini/composer/ownedInput';
import { findGeminiSendButton } from '@/core/gemini/composer/send';
import {
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  resolveGeminiSelectorOperationInView,
  type GeminiSelectorOperation,
} from '@/core/gemini/selectors';
import { locatorSiteForHost } from '@/core/selectors/sites';
import { isEditable } from '@/core/services/composer/find';

import { findChatInput } from '../chatInput';

/** The project owns its input read; changing a prompt's profile cannot redirect instructions. */
export function resolveProjectInput(
  startedFrom?: Element,
): GeminiSelectorOperation<HTMLElement | null> {
  const key = 'project.inputs';
  const view = getGeminiSelectorView();
  const bundle = getBundledGeminiSelectorView();
  if (!view.remoteKeys.has(key) || locatorSiteForHost(location.hostname) !== 'gemini')
    return { value: findChatInput(), view: bundle };
  const collect = (selectors: readonly string[]) => [
    ...new Set(
      selectors.flatMap((selector) =>
        Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(isEditable),
      ),
    ),
  ];
  const bundled = collect(bundle.profiles[key]);
  const operation = resolveGeminiSelectorOperationInView(
    view,
    (candidate) => ({
      inputs: collect(candidate.profiles[key]),
      input: readChatInput(candidate.profiles[key]),
    }),
    ({ inputs, input }) => {
      // A remote input must belong to the exact clicked send, not a different composer.
      if (startedFrom && (!input || findGeminiSendButton(input, bundle) !== startedFrom))
        return false;
      // A partial or reordered set could prepend private instructions to another draft.
      if (bundled.length)
        return (
          inputs.length === bundled.length &&
          inputs.every((input, index) => input === bundled[index])
        );
      const native = findOwnedGeminiMainInputs(document);
      return inputs.length === 1 && native.length === 1 && inputs[0] === native[0];
    },
  );
  return { value: operation.value.input, view: operation.view };
}

export function findProjectInput(startedFrom?: Element): HTMLElement | null {
  return resolveProjectInput(startedFrom).value;
}
