import { isNativeComposerElementVisible } from '@/core/gemini/composer/native';
import { hasVoyagerOwner } from '@/core/gemini/composer/ownedInput';
import {
  getBundledSiteSelectorView,
  getSiteSelectorView,
  resolveSiteSelectorOperationInView,
} from '@/core/selectors';
import {
  isSemanticSendActionButton,
  isUnavailableSendControl,
  isUpdateActionButton,
} from '@/pages/content/sendBehavior/sendButton';

import { hasPendingComposerUpload } from '../sendGuards';
import { hasSiteContentOwner, nativeSiteComposerRoot } from '../siteInputReads';
import {
  editableKindOf,
  findSendButton,
  findSendButtonInContainer,
  findSendContainer,
} from './sendKeyDom';
import { SEND_SITE_POLICIES } from './sendSitePolicies';

/** Independent HTML input/action association, kept outside the downloaded wrapper list. */
function nativeOwner(input: HTMLElement): { root: HTMLElement; button: HTMLButtonElement } | null {
  if (
    !input.isConnected ||
    editableKindOf(input) === null ||
    hasVoyagerOwner(input) ||
    hasSiteContentOwner('aistudio', input) ||
    !nativeSiteComposerRoot('aistudio', input) ||
    input.closest('[role="dialog"], dialog, [data-turn-role], [data-gv-plugin]')
  )
    return null;
  for (
    let root = input.parentElement;
    root && root !== input.ownerDocument.body;
    root = root.parentElement
  ) {
    const fields = Array.from(
      root.querySelectorAll<HTMLElement>(SEND_SITE_POLICIES.aistudio.editableSelector),
    ).filter((field) => editableKindOf(field) !== null);
    if (fields.length !== 1 || fields[0] !== input || hasPendingComposerUpload(root)) return null;
    const buttons = Array.from(root.querySelectorAll('button')).filter(
      (button) => button.offsetParent !== null && isNativeComposerElementVisible(button),
    );
    if (buttons.some((button) => isUnavailableSendControl(button) || isUpdateActionButton(button)))
      return null;
    const sends = buttons.filter(isSemanticSendActionButton);
    if (sends.length > 1) return null;
    if (sends.length === 1)
      return sends[0].form === input.closest('form') ? { root, button: sends[0] } : null;
  }
  return null;
}

export function findAIStudioSendButton(input: HTMLElement): HTMLElement | null {
  const view = getSiteSelectorView('aistudio');
  const bundle = getBundledSiteSelectorView('aistudio');
  const containers = bundle.profiles['input.sendContainers'];
  if (!view.remoteKeys.has('input.sendContainers')) return findSendButton(input, containers);
  const bundledRoot = findSendContainer(input, containers);
  const native = bundledRoot ? null : nativeOwner(input);
  return resolveSiteSelectorOperationInView(
    view,
    (candidate) => {
      const root = findSendContainer(input, candidate.profiles['input.sendContainers']);
      return { root, button: findSendButtonInContainer(root) };
    },
    ({ root, button }) => {
      if (bundledRoot) return root === bundledRoot;
      // Do not borrow a neighboring prompt's Run button when a wrapper was renamed.
      if (!native || root !== native.root || button !== native.button) return false;
      for (
        let owner = input.parentElement;
        owner && owner !== input.ownerDocument.body;
        owner = owner.parentElement
      ) {
        if (hasPendingComposerUpload(owner)) return false;
      }
      return true;
    },
  ).value.button;
}
