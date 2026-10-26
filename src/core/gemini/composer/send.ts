import {
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  type GeminiSelectorView,
} from '@/core/gemini/selectors';
import { hasPendingComposerUpload } from '@/core/services/composer/sendGuards';
import {
  editableKindOf,
  findSendButton,
  findSendButtonInContainer,
  findSendContainer,
} from '@/core/services/composer/sendKeys/sendKeyDom';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/composer-send-packaged.json';
import {
  isSemanticSendActionButton,
  isUnavailableSendControl,
  isUpdateActionButton,
} from '@/pages/content/sendBehavior/sendButton';

import { isNativeComposerElementVisible, isNativeComposerInput } from './native';

interface NativeOwner {
  readonly container: HTMLElement;
  readonly button: HTMLButtonElement;
}

/** Read the owner independently from remote classes, without invoking an action. */
function findNativeOwner(input: HTMLElement): NativeOwner | null {
  // A response editor or Voyager panel can also contain Run; it cannot prove a chat send.
  if (!isNativeComposerInput(input)) return null;
  let parent = input.parentElement;
  while (parent && parent !== input.ownerDocument.body) {
    const inputs = Array.from(
      parent.querySelectorAll<HTMLElement>(packaged['composer.keyEditables']),
    ).filter((element) => editableKindOf(element) !== null);
    // A common ancestor of two editors cannot prove whose draft its button submits.
    if (inputs.length !== 1 || inputs[0] !== input) return null;
    const buttons = Array.from(parent.querySelectorAll('button')).filter(
      (element) => element.offsetParent !== null && isNativeComposerElementVisible(element),
    );
    // A blocked or editing submission owns this input; climbing past it can borrow another Send.
    if (buttons.some((button) => isUnavailableSendControl(button) || isUpdateActionButton(button)))
      return null;
    const sendButtons = buttons.filter(isSemanticSendActionButton);
    // Multiple visible sends leave ownership ambiguous; never guess from DOM order.
    if (sendButtons.length > 1) return null;
    if (sendButtons.length === 1) return { container: parent, button: sendButtons[0] };
    parent = parent.parentElement;
  }
  return null;
}

function hasPendingAncestorUpload(input: HTMLElement): boolean {
  let owner = input.parentElement;
  while (owner && owner !== input.ownerDocument.body) {
    if (hasPendingComposerUpload(owner)) return true;
    owner = owner.parentElement;
  }
  return false;
}

/** One send read owns the input, its container, upload check and eventual clickable control. */
export function findGeminiSendButton(
  input: HTMLElement,
  view: GeminiSelectorView = getGeminiSelectorView(),
): HTMLElement | null {
  const bundled = getBundledGeminiSelectorView().profiles['composer.sendContainers'];
  const fallback = () => findSendButton(input, bundled);
  if (!view.remoteKeys.has('composer.sendContainers')) return fallback();
  try {
    if (!input.isConnected || editableKindOf(input) === null) return fallback();
    const container = findSendContainer(input, view.profiles['composer.sendContainers']);
    if (!container) return fallback();
    const oldContainer = findSendContainer(input, bundled);
    if (oldContainer) {
      // A smaller remote owner can hide an upload; a larger one can borrow another editor's send.
      if (container !== oldContainer) return fallback();
      return findSendButtonInContainer(container);
    }
    const native = findNativeOwner(input);
    // A renamed wrapper is usable only when native semantics prove this exact input/button unit.
    if (!native || native.container !== container) return fallback();
    // Without a known wrapper, an inner match must not leave the upload preview outside its read.
    if (hasPendingAncestorUpload(input)) return fallback();
    const button = findSendButtonInContainer(container);
    if (button !== native.button) return fallback();
    return button;
  } catch {
    return fallback();
  }
}
