/**
 * When the user sent a message, in which conversation, and which user turn it
 * produced: the one signal folder Activity and catalog timeline timestamps
 * share. Only a send counts: opening a chat, the host re-rendering its
 * transcript or loading older messages never reports one.
 *
 * A send is a submit from the site's composer (Enter, its send button or the
 * form) with a prompt or a file in it, in a chat whose route already names it.
 * It is reported once the message it produced shows up as the newest user
 * turn, holding exactly the prompt that was submitted. Leaving the chat
 * forgets the send, and so does waiting 30 seconds. Chats the host keeps
 * nowhere (ChatGPT's temporary chats) report nothing. Everything here fails
 * closed: a missed send is fine, a send pinned to the wrong turn is not.
 */
import { getPageSelectorSiteId, getSiteSelectorView } from '@/core/selectors';
import { hasComposerAttachments, readComposerText } from '@/core/services/composer/draft';
import { textWithLatexSource } from '@/core/utils/userLatexSource';
import { isTemporaryChat } from '@/features/plugins/builtin/chatgptTemporaryHandoff/handoff';
import type { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { matchesAnyPattern } from '@/features/plugins/sites/matchPattern';
import { parseSiteConversation } from '@/features/plugins/sites/siteConversation';
import type { SiteAdapter } from '@/features/plugins/types';
import { isSendActionButton } from '@/pages/content/sendBehavior/sendButton';

import { startPendingSend } from './pendingSend';
import { sendInputsOf } from './sendInputs';
import {
  sendTargets,
  sendUserTurnSelector,
  type TrackingTargets,
  type SendTargetSource,
} from './sendTargets';

/** A site's send inputs (`sendInputsOf`), plus how to tell a chat the host keeps nowhere. */
export interface SendSite extends SendTargetSource {
  /** Whether the open chat is one the host keeps nowhere. */
  readonly isEphemeral?: () => boolean;
}

export interface UserSend {
  /** `<site>:conv:<id>`, read from the route. */
  readonly conversationKey: string;
  /** The host's key for the user turn the send produced. */
  readonly turnKey: string;
  /** When the user sent it. */
  readonly at: number;
}

/** Chats a site keeps nowhere, by site id; a send there is never reported. */
const EPHEMERAL_CHECKS: Readonly<Record<string, () => boolean>> = { chatgpt: isTemporaryChat };

/** Whether the chat open on `siteId` is one the host keeps nowhere (ChatGPT's temporary chats). */
export function isEphemeralChat(siteId: string): boolean {
  return EPHEMERAL_CHECKS[siteId]?.() === true;
}

/** `adapter`'s send inputs, or `null` when it lacks any (see `sendInputsOf`). */
export function sendSiteOf(adapter: SiteAdapter | null): SendSite | null {
  // Keep capability discovery usable by Node; page snapshots belong to the send owner.
  const inputs = sendInputsOf(adapter);
  if (!inputs) return null;
  // Freeze candidates, not today's proof: Angular/React may mount the repaired editor later.
  const selectorView =
    typeof document !== 'undefined' && getPageSelectorSiteId(document) === inputs.siteId
      ? getSiteSelectorView(inputs.siteId)
      : undefined;
  return { ...inputs, selectorView, isEphemeral: EPHEMERAL_CHECKS[inputs.siteId] };
}

/** The key `attributes` give the user turn `turn`, from it or its nearest ancestor holding one. */
export function readTurnKey(turn: Element, attributes: readonly string[]): string | null {
  const holder = turn.closest(attributes.map((name) => `[${name}]`).join(', '));
  if (!holder) return null;
  for (const name of attributes) {
    const key = holder.getAttribute(name);
    if (key !== null) return key;
  }
  return null;
}

/** The conversation sends at `href` are reported under, or `null` where none can be. */
export function sendConversationKey(site: SendSite, href: string): string | null {
  if (!matchesAnyPattern(href, site.matches)) return null;
  const namespace = { siteId: site.siteId, conversationIdPattern: site.conversationIdPattern };
  return parseSiteConversation(namespace, href)?.key ?? null;
}

/** Text compared without whitespace, which the composer and the rendered message lay out differently. */
const compact = (text: string): string => text.replace(/[\s\u200b]+/g, '');

/**
 * Calls `report` once per send, with its conversation, the turn it produced
 * and when it was sent. Everything it starts is paid back with `scope`.
 */
export function trackUserSends(
  scope: PluginScope,
  site: SendSite,
  report: (send: UserSend) => void,
  doc: Document = document,
): void {
  let stopPending: (() => void) | null = null;
  scope.effect(() => () => {
    stopPending?.();
    stopPending = null;
  });
  /** Set while one submission's events arrive: its Enter or click, then its form's submit. */
  let submitting = false;

  const keyedTurns = (selector: string): Array<{ turn: Element; key: string }> =>
    Array.from(doc.querySelectorAll(selector), (turn) => ({
      turn,
      key: readTurnKey(turn, site.turnKeyAttributes),
    })).filter((entry): entry is { turn: Element; key: string } => entry.key !== null);
  const routeConversation = (): string | null => sendConversationKey(site, location.href);

  /** Whether a submit carries a prompt or a file; the host sends nothing from an empty composer. */
  const hasDraft = (fields: readonly Element[], form: Element | null): boolean =>
    fields.some((field) => field instanceof HTMLElement && readComposerText(field).trim() !== '') ||
    (form !== null && hasComposerAttachments(form));

  const onSend = (
    fields: readonly Element[],
    form: Element | null,
    targets: TrackingTargets,
  ): void => {
    if (scope.isDisposed || submitting || site.isEphemeral?.()) return;
    // An empty submit sends nothing; armed, it would claim whichever chat's turn mounted next.
    if (!hasDraft(fields, form)) return;
    // A chat without its id in the route yet has nothing to key a send by.
    const conversationKey = routeConversation();
    if (!conversationKey) return;
    const prompt = compact(
      fields.map((field) => (field instanceof HTMLElement ? readComposerText(field) : '')).join(''),
    );
    // One submission dispatches its events in one task; a later send is its own, with its own time.
    submitting = true;
    scope.timer(() => (submitting = false), 0);
    stopPending?.();
    stopPending = startPendingSend(
      {
        sentAt: Date.now(),
        conversationKey,
        known: new Set(keyedTurns(targets.userTurn).map(({ key }) => key)),
        prompt,
      },
      {
        doc,
        signal: scope.signal,
        conversation: routeConversation,
        report,
        newest: () => {
          const newest = keyedTurns(sendUserTurnSelector(site, doc)).at(-1);
          return newest
            ? { key: newest.key, readPrompt: () => compact(textWithLatexSource(newest.turn)) }
            : null;
        },
      },
    );
  };

  const composerForm = (target: Element, selectors: TrackingTargets): Element | null => {
    // A repaired editor may no longer match the bundled root selector; keep its proved owner.
    const form = selectors.remoteComposer ? selectors.provedRoot : target.closest('form');
    if (selectors.remoteComposer && !form?.contains(target)) return null;
    return form?.querySelector(selectors.composer) ? form : null;
  };
  const sendFrom = (form: Element, targets: TrackingTargets): void =>
    onSend(Array.from(form.querySelectorAll(targets.composer)), form, targets);

  // Capture phase: these run before the host handles the send and renders its message.
  scope.on(
    doc,
    'keydown',
    (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      if (!(event.target instanceof Element)) return;
      // One event owns one proof; later DOM mutations only need to prove the resulting turns.
      const targets = sendTargets(site, doc);
      const field = event.target.closest(targets.composer);
      if (field) {
        onSend(
          [field],
          targets.remoteComposer ? composerForm(field, targets) : field.closest('form'),
          targets,
        );
      }
    },
    { capture: true },
  );
  scope.on(
    doc,
    'click',
    (event) => {
      const targets = sendTargets(site, doc);
      const selector = targets.remoteComposer ? targets.sendButton : 'button';
      const button =
        event.target instanceof Element && selector ? event.target.closest(selector) : null;
      if (targets.remoteComposer) {
        if (!button || button.matches(':disabled, [aria-disabled="true"]')) return;
      } else if (
        !(button instanceof HTMLButtonElement) ||
        button.disabled ||
        !isSendActionButton(button)
      ) {
        return;
      }
      const form = composerForm(button, targets);
      if (form) sendFrom(form, targets);
    },
    { capture: true },
  );
  scope.on(
    doc,
    'submit',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const targets = sendTargets(site, doc);
      const form = composerForm(event.target, targets);
      if (form) sendFrom(form, targets);
    },
    { capture: true },
  );
}
