/**
 * Create mode on the page, a permanent page service:
 *
 * - the panel's "Create on this page" opens a new chat here and fills its
 *   composer with the creation message (`local/creationMessage.ts`). Voyager
 *   never sends it; the user reviews it and presses send.
 * - in that chat, each JSON object in a reply gets a control
 *   (`replyControls.ts`). "Preview" holds the block and opens the panel, which
 *   fetches it once (`gv.create.pending`), checks it again and installs it;
 *   under a block the gate refuses, a plain reason and "Ask it to fix", which
 *   appends the gate's problems to the composer.
 *
 * The panel also asks which chat model the page shows (`gv.create.model`,
 * `geminiModel.ts`), to warn before the user writes for a model that usually
 * cannot write a plugin.
 *
 * The panel reaches this module only through the background's tab relay,
 * never through window messages.
 */
import { insertIntoComposer } from '@/core/services/composer';
import { isEmptyComposer } from '@/core/services/composer/emptyComposer';
import { createToaster } from '@/core/ui/toast/toaster';
import { authoringSiteForUrl } from '@/features/plugins/local/authoringSites';
import { buildCreationFixMessage } from '@/features/plugins/local/creation/fixMessage';
import {
  CREATE_MODE_MESSAGES,
  type CreateStartReply,
  parseCreateStartRequest,
} from '@/features/plugins/local/creation/messages';
import type { CreationCandidate } from '@/features/plugins/local/creation/types';
import { buildCreationMessage } from '@/features/plugins/local/creationMessage';
import {
  loadLocalPluginRecords,
  subscribeLocalPlugins,
} from '@/features/plugins/local/localPluginStore';
import { getTranslationSync } from '@/utils/i18n';
import type { TranslationKey } from '@/utils/translations';

import { findChatInput } from '../chatInput';
import type { StopNativeFeature } from '../featureLifecycle';
import { voyagerPanelOpener } from '../panelShell/opener';
import { startCreationFill } from './fill';
import type { FillResult } from './fillMachine';
import { createModelWarningReader } from './geminiModel';
import { newChatTarget } from './newChat';
import { createPendingReview } from './pending';
import type { ReplyControlAction } from './replyControl';
import { startReplyControls } from './replyControls';

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
  readonly openReview?: () => boolean;
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

  const readModelWarning = createModelWarningReader(site.id);
  const pending = createPendingReview();
  const openReview = deps.openReview ?? (() => voyagerPanelOpener.openReview());

  const sendProblemsBack = (candidate: CreationCandidate): void => {
    if (candidate.verdict.kind !== 'rejected') return;
    const composer = find();
    const fix = buildCreationFixMessage(
      candidate.verdict.issues,
      getTranslationSync('createModeFixIntro'),
    );
    // After whatever the user already typed, a blank line apart; never sent.
    const written =
      composer !== null &&
      insertIntoComposer(composer, isEmptyComposer(composer) ? fix : `\n\n${fix}`, 'append');
    toaster.show({
      message: getTranslationSync(written ? 'createModeProblemsFilled' : 'createModeNoComposer'),
      tone: written ? 'success' : 'error',
      durationMs: TOAST_MS,
    });
  };

  const onAction = (action: ReplyControlAction, candidate: CreationCandidate): void => {
    if (action === 'problems') {
      sendProblemsBack(candidate);
      return;
    }
    pending.put({ text: candidate.text, siteId: candidate.siteId });
    openReview();
  };

  const stopControls = startReplyControls({
    doc: document,
    adapter: site,
    loadRecords: loadLocalPluginRecords,
    subscribeRecords: subscribeLocalPlugins,
    onAction,
  });

  const listener: MessageListener = (message, _sender, sendResponse) => {
    const start = parseCreateStartRequest(message);
    if (start) {
      sendResponse(begin(start.request));
      return;
    }
    if (typeof message !== 'object' || message === null || !('type' in message)) return;
    if (message.type === CREATE_MODE_MESSAGES.pending) sendResponse({ candidate: pending.take() });
    if (message.type === CREATE_MODE_MESSAGES.model)
      sendResponse({ warning: readModelWarning?.() ?? null });
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
    stopControls();
    toaster.destroy();
  };
}
