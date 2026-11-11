/**
 * Create mode on the page, a permanent page service:
 *
 * - the panel's "Create on this page" opens a new chat here and fills its
 *   composer with the creation message (`local/creationMessage.ts`), led by
 *   the outline of the page it started on unless the user left that out
 *   (`pageOutline.ts`; `gv.create.outline` shows the panel the same text).
 *   Voyager never sends it; the user reviews it and presses send.
 * - My creations asks which installed restyling creations find anything on
 *   this page (`gv.create.check`), and "Ask it to fix" opens a new chat the
 *   same way with what the page showed and the plugin as installed
 *   (`gv.create.fix`, `creationRequests.ts`).
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
import {
  CREATION_CHECK_MESSAGES,
  type CreationFixRequest,
  parseCreationFixRequest,
} from '@/features/plugins/local/creation/creationChecks';
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
import { checkInstalledCreations, installedFixMessage } from './creationRequests';
import { startCreationFill } from './fill';
import type { FillResult } from './fillMachine';
import { createModelWarningReader } from './geminiModel';
import { newChatTarget } from './newChat';
import { buildPageOutline } from './pageOutline';
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

  // Leaving a chat with a typed message could lose it, so refuse before moving.
  const composerBusy = (): boolean => {
    const current = find();
    return current !== null && !isEmptyComposer(current);
  };

  const openFilled = (message: string): CreateStartReply => {
    stopFill?.();
    stopFill = startCreationFill(message, {
      target,
      find,
      notify: (result) => {
        if (result !== 'left') notify(result);
      },
    });
    return { ok: true };
  };

  const readModelWarning = createModelWarningReader(site.id);

  const begin = (request: string, structure: boolean): CreateStartReply => {
    if (composerBusy()) return { ok: false, reason: 'busy' };
    // Read now, before the new chat replaces the page the request started on.
    const outline = structure ? buildPageOutline(document, site, location.href) : null;
    return openFilled(buildCreationMessage(request, site, getTranslationSync, outline));
  };

  const page = () => ({ doc: document, site, url: location.href });

  const askToFix = async (request: CreationFixRequest): Promise<CreateStartReply> => {
    if (composerBusy()) return { ok: false, reason: 'busy' };
    const message = installedFixMessage(
      page(),
      await loadLocalPluginRecords(),
      request,
      getTranslationSync,
    );
    return message ? openFilled(message) : { ok: false, reason: 'unsupported' };
  };

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
      sendResponse(begin(start.request, start.structure));
      return;
    }
    const fix = parseCreationFixRequest(message);
    if (fix) {
      void askToFix(fix).then(sendResponse);
      return true;
    }
    const type =
      typeof message === 'object' && message !== null && 'type' in message && message.type;
    if (type === CREATE_MODE_MESSAGES.pending) sendResponse({ candidate: pending.take() });
    else if (type === CREATE_MODE_MESSAGES.model)
      sendResponse({ warning: readModelWarning?.() ?? null });
    else if (type === CREATE_MODE_MESSAGES.outline)
      sendResponse({ outline: buildPageOutline(document, site, location.href) });
    else if (type === CREATION_CHECK_MESSAGES.check) {
      void loadLocalPluginRecords().then((records) =>
        sendResponse({ checks: checkInstalledCreations(page(), records) }),
      );
      return true;
    }
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
