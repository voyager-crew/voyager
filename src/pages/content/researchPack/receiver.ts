/**
 * Receiving end of "Continue in ChatGPT / Claude", on the new chat tab the
 * background opened (see `features/researchPack/services/handoff.ts`).
 *
 * Order: peek → wait for the composer → claim → check again → insert. Only a
 * fresh new-chat page peeks, so ordinary page loads stay free of timers.
 * Claiming only once the composer exists means a login redirect or a slow
 * page leaves the record to expire instead of spending it. The pack goes only
 * into the site's main composer, only while it is empty and the tab is still
 * on the new-chat page; anything else inserts nothing. Nothing is sent: the
 * user reviews the pack and presses send.
 *
 * The text goes in through the shared composer writer, without sending.
 */
import {
  getBundledSiteSelectorView,
  getSiteSelectorView,
  resolveSiteSelectorOperationInView,
} from '@/core/selectors';
import { findComposer, insertIntoComposer } from '@/core/services/composer';
import { isEmptyComposer } from '@/core/services/composer/emptyComposer';
import { acceptsSiteInputs, inputCandidates } from '@/core/services/composer/siteInputReads';
import { createToaster } from '@/core/ui/toast/toaster';
import { startMachine } from '@/features/plugins/runtime/stateMachine';
import {
  HANDOFF_MESSAGES,
  type HandoffMessage,
  type HandoffTarget,
  handoffNewChatTargetForUrl,
} from '@/features/researchPack/services/handoff';
import { getTranslationSync } from '@/utils/i18n';
import type { TranslationKey } from '@/utils/translations';

import type { StopNativeFeature } from '../featureLifecycle';
import { navigationApi } from './navigationApi';
import {
  receiverTransition,
  receiverEffects,
  type ReceiverState,
  type ReceiverEvent,
} from './receiverMachine';

export const RECEIVER_POLL_MS = 150;
/** The same element on this many polls in a row: the app has finished mounting it. */
export { RECEIVER_STABLE_POLLS } from './receiverMachine';
export const RECEIVER_COMPOSER_TIMEOUT_MS = 20_000;
export const RECEIVER_TOAST_MS = 6_000;

export interface ResearchPackReceiverDeps {
  send?: (message: HandoffMessage) => Promise<unknown>;
  insert?: (text: string, input: HTMLElement) => boolean;
  pageUrl?: () => string;
  isTopFrame?: () => boolean;
  t?: (key: TranslationKey) => string;
  /** `window.navigation`; null (no Navigation API) makes the receiver refuse. */
  navigation?: EventTarget | null;
}

interface NavigateEventLike extends Event {
  readonly destination?: { readonly url?: string };
}

/**
 * Every same-document navigation, as it happens: `navigate` fires for the
 * page's own pushState, replaceState, traversals and hash changes with the
 * destination before it commits, and `currententrychange` once it has. No
 * polling, so a round trip cannot slip between two checks (see `navigationApi`).
 */
function watchHandoffRoute(navigation: EventTarget, onChange: (href?: string) => void): () => void {
  const onNavigate = (event: Event) => onChange((event as NavigateEventLike).destination?.url);
  const onEntryChange = () => onChange();
  navigation.addEventListener('navigate', onNavigate);
  navigation.addEventListener('currententrychange', onEntryChange);
  return () => {
    navigation.removeEventListener('navigate', onNavigate);
    navigation.removeEventListener('currententrychange', onEntryChange);
  };
}

/**
 * Each site's main composer, never the adapter's generic `contenteditable`
 * fallback, which also matches canvases and edit-message boxes. The same
 * selectors identify these composers for Vim input and slash prompts.
 */
/** The site's main composer, or null when there is none or more than one is usable. */
export function findHandoffComposer(
  target: HandoffTarget,
  doc: Document = document,
): HTMLElement | null {
  const bundle = getBundledSiteSelectorView(target);
  const view = getSiteSelectorView(target);
  const read = (selectors: readonly string[]) =>
    findComposer(selectors.join(','), { doc, requireUnique: true });
  const key = 'input.handoff';
  if (!view.remoteKeys.has(key)) return read(bundle.profiles[key]);
  const expected = inputCandidates(doc, bundle.profiles[key]);
  return resolveSiteSelectorOperationInView(
    view,
    (candidate) => ({
      input: read(candidate.profiles[key]),
      elements: inputCandidates(doc, candidate.profiles[key]),
    }),
    ({ elements }) => acceptsSiteInputs(target, doc, elements, expected),
  ).value.input;
}

/** Put the caret at the end so the insertion can never replace a selection. */
function collapseSelectionToEnd(composer: HTMLElement): void {
  const selection = composer.ownerDocument.getSelection();
  if (!selection) return;
  const range = composer.ownerDocument.createRange();
  range.selectNodeContents(composer);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function isClaim(value: unknown): value is { ok: true; markdown: string } {
  if (!value || typeof value !== 'object') return false;
  const record = value as { ok?: unknown; markdown?: unknown };
  return record.ok === true && typeof record.markdown === 'string' && record.markdown.length > 0;
}

export function startResearchPackReceiver(deps: ResearchPackReceiverDeps = {}): StopNativeFeature {
  const pageUrl = deps.pageUrl ?? (() => window.location.href);
  const isTopFrame = deps.isTopFrame ?? (() => window.top === window);
  const target = handoffNewChatTargetForUrl(pageUrl());
  const navigation = 'navigation' in deps ? deps.navigation : navigationApi();
  if (!target || !isTopFrame() || !navigation) return () => {};
  const startDocument = document;
  const send = deps.send ?? ((message: HandoffMessage) => chrome.runtime.sendMessage(message));
  const insert =
    deps.insert ??
    ((text: string, input: HTMLElement) => insertIntoComposer(input, text, 'append'));
  const t = deps.t ?? getTranslationSync;
  const toaster = createToaster();
  let stopRoute: (() => void) | null = null;
  const current = () =>
    document === startDocument && handoffNewChatTargetForUrl(pageUrl()) === target;
  const machine = startMachine<ReceiverState, ReceiverEvent>(
    {
      id: 'researchPackReceiver',
      transition: receiverTransition,
      effects: receiverEffects({
        pollMs: RECEIVER_POLL_MS,
        timeoutMs: RECEIVER_COMPOSER_TIMEOUT_MS,
        requireOriginalComposer: getSiteSelectorView(target).remoteKeys.has('input.handoff'),
        peek: async () => {
          const peek = await send({ type: HANDOFF_MESSAGES.peek });
          return Boolean(
            peek && typeof peek === 'object' && 'pending' in peek && peek.pending === true,
          );
        },
        find: () => findHandoffComposer(target),
        empty: isEmptyComposer,
        claim: async () => {
          const claim = await send({ type: HANDOFF_MESSAGES.claim });
          return isClaim(claim) ? claim.markdown : null;
        },
        current,
        insert: (markdown, input) => {
          collapseSelectionToEnd(input);
          return insert(markdown, input);
        },
        finish: (result) => {
          stopRoute?.();
          stopRoute = null;
          if (result !== 'silent')
            toaster.show({
              message: t(
                result === 'ready' ? 'researchPackHandoffReady' : 'researchPackHandoffFailed',
              ),
              tone: result === 'ready' ? 'success' : 'error',
              durationMs: RECEIVER_TOAST_MS,
            });
        },
      }),
    },
    { status: 'peeking' },
  );
  stopRoute = watchHandoffRoute(navigation, (href) => {
    if (document !== startDocument || handoffNewChatTargetForUrl(href ?? pageUrl()) !== target)
      machine.send({
        type: 'finish',
        result: machine.state.status === 'claiming' ? 'failed' : 'silent',
      });
  });
  return () => {
    machine.send({ type: 'finish', result: 'silent' });
    void machine.stop();
    stopRoute?.();
    stopRoute = null;
    toaster.destroy();
  };
}
