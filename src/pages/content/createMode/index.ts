/**
 * Create mode on the page, a permanent page service: the panel's "Create on
 * this page" opens a new chat here and fills its composer with the creation
 * message (`local/creationMessage.ts`). Voyager never sends it; the user
 * reviews it and presses send. The panel reaches this module only through the
 * background's tab relay, never through window messages.
 */
import { isEmptyComposer } from '@/core/services/composer/emptyComposer';
import { createToaster } from '@/core/ui/toast/toaster';
import { authoringSiteForUrl } from '@/features/plugins/local/authoringSites';
import {
  type CreateStartReply,
  parseCreateStartRequest,
} from '@/features/plugins/local/creation/messages';
import { buildCreationMessage } from '@/features/plugins/local/creationMessage';
import { getTranslationSync } from '@/utils/i18n';
import type { TranslationKey } from '@/utils/translations';

import { findChatInput } from '../chatInput';
import type { StopNativeFeature } from '../featureLifecycle';
import { startCreationFill } from './fill';
import type { FillResult } from './fillMachine';
import { newChatTarget } from './newChat';

const TOAST_MS = 6_000;

const FILL_MESSAGES: Readonly<Record<Exclude<FillResult, 'left'>, TranslationKey>> = {
  filled: 'createModeFilled',
  busy: 'createModeComposerBusy',
  'no-new-chat': 'createModeNoNewChat',
  'no-composer': 'createModeNoComposer',
};

type MessageListener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];

export interface CreateModeDeps {
  /** The page's main composer; the site's own finder by default. */
  readonly find?: () => HTMLElement | null;
}

export function startCreateMode(deps: CreateModeDeps = {}): StopNativeFeature {
  if (window.top !== window) return () => {};
  const site = authoringSiteForUrl(location.href);
  const target = site ? newChatTarget(site.id) : null;
  if (!site || !target) return () => {};

  const toaster = createToaster();
  const find = deps.find ?? (() => findChatInput({ online: true }));
  let stopFill: (() => void) | null = null;

  const notify = (result: Exclude<FillResult, 'left'>): void => {
    toaster.show({
      message: getTranslationSync(FILL_MESSAGES[result]),
      tone: result === 'filled' ? 'success' : 'error',
      durationMs: TOAST_MS,
    });
  };

  const begin = (request: string): CreateStartReply => {
    // Leaving a chat with a typed message could lose it, so refuse before moving.
    const current = find();
    if (current && !isEmptyComposer(current)) return { ok: false, reason: 'busy' };
    stopFill?.();
    stopFill = startCreationFill(buildCreationMessage(request, site, getTranslationSync), {
      target,
      find,
      notify: (result) => {
        if (result !== 'left') notify(result);
      },
    });
    return { ok: true };
  };

  const listener: MessageListener = (message, _sender, sendResponse) => {
    const start = parseCreateStartRequest(message);
    if (!start) return;
    sendResponse(begin(start.request));
  };
  chrome.runtime.onMessage.addListener(listener);

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    try {
      chrome.runtime.onMessage.removeListener(listener);
    } catch {
      // The extension may have been reloaded while the page stayed open.
    }
    stopFill?.();
    stopFill = null;
    toaster.destroy();
  };
}
