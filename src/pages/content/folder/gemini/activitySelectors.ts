import { findOwnedGeminiMainInputs } from '@/core/gemini/composer/ownedInput';
import {
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  resolveGeminiSelectorOperationInView,
  type GeminiSelectorView,
  type GeminiSelectorOperation,
} from '@/core/gemini/selectors';
import { locatorSiteForHost } from '@/core/selectors/sites';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/activity-packaged.json';

interface ActivitySendIntent {
  readonly owner: Element | null;
  readonly inputs: HTMLElement[];
  readonly accepted: boolean;
}

function readInputs(owner: Element | null, selector: string, collect: boolean): HTMLElement[] {
  if (!owner) return [];
  if (collect) return Array.from(owner.querySelectorAll<HTMLElement>(selector));
  const input = owner.querySelector<HTMLElement>(selector);
  return input ? [input] : [];
}

function readIntent(event: Event, view: GeminiSelectorView, collect = false): ActivitySendIntent {
  const selector = view.profiles['activity.inputs'].join(', ');
  if (event.type === 'submit') {
    const form = event.target;
    const inputs = form instanceof HTMLFormElement ? readInputs(form, selector, collect) : [];
    return {
      owner: form instanceof HTMLFormElement ? form : null,
      inputs,
      accepted: inputs.length > 0,
    };
  }
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest(packaged['activity.send'].join(', '));
  if (
    !(button instanceof HTMLElement) ||
    (button instanceof HTMLButtonElement &&
      (button.disabled || button.getAttribute('aria-disabled') === 'true'))
  )
    return { owner: null, inputs: [], accepted: false };
  const owner = button.closest(packaged['activity.owner'].join(', '));
  const inputs = readInputs(owner, selector, collect);
  // Preserve the original optional-chain result on the bundled path.
  return { owner, inputs, accepted: owner === null || inputs.length > 0 };
}

/** One event, one accepted owner and input collection, before the activity timestamp is queued. */
export function resolveActivitySendIntent(
  event: Event,
): GeminiSelectorOperation<ActivitySendIntent> {
  const bundle = getBundledGeminiSelectorView();
  const view = getGeminiSelectorView();
  if (!view.remoteKeys.has('activity.inputs') || locatorSiteForHost(location.hostname) !== 'gemini')
    return { value: readIntent(event, bundle), view: bundle };
  const bundled = readIntent(event, bundle, true);
  return resolveGeminiSelectorOperationInView(
    view,
    (candidate) => readIntent(event, candidate, true),
    (remote) => {
      // A partial match cannot hide the input the native send actually belongs to.
      if (bundled.inputs.length)
        return (
          remote.inputs.length === bundled.inputs.length &&
          remote.inputs.every((input, index) => input === bundled.inputs[index])
        );
      const native = findOwnedGeminiMainInputs(document).filter((input) =>
        remote.owner?.contains(input),
      );
      return remote.inputs.length === 1 && native.length === 1 && remote.inputs[0] === native[0];
    },
  );
}
