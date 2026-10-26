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
import { textWithLatexSource } from '@/core/utils/userLatexSource';
import {
  hasComposerAttachments,
  readComposerText,
} from '@/features/plugins/builtin/chatgptTemporaryHandoff/composerDelivery';
import { isTemporaryChat } from '@/features/plugins/builtin/chatgptTemporaryHandoff/handoff';
import type { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { matchesAnyPattern } from '@/features/plugins/sites/matchPattern';
import { parseSiteConversation } from '@/features/plugins/sites/siteConversation';
import type { SiteAdapter } from '@/features/plugins/types';

import { startPendingSend } from './pendingSend';
import { type SendInputs, sendInputsOf } from './sendInputs';
import { sendTargets } from './sendTargets';

/** A site's send inputs (`sendInputsOf`), plus how to tell a chat the host keeps nowhere. */
export interface SendSite extends SendInputs {
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
  const inputs = sendInputsOf(adapter);
  return inputs && { ...inputs, isEphemeral: EPHEMERAL_CHECKS[inputs.siteId] };
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

  const keyedTurns = (): Array<{ turn: Element; key: string }> =>
    Array.from(doc.querySelectorAll(sendTargets(site, doc).userTurn), (turn) => ({
      turn,
      key: readTurnKey(turn, site.turnKeyAttributes),
    })).filter((entry): entry is { turn: Element; key: string } => entry.key !== null);
  const routeConversation = (): string | null => sendConversationKey(site, location.href);

  /** Whether a submit carries a prompt or a file; the host sends nothing from an empty composer. */
  const hasDraft = (fields: readonly Element[], form: Element | null): boolean =>
    fields.some((field) => field instanceof HTMLElement && readComposerText(field).trim() !== '') ||
    (form !== null && hasComposerAttachments(form));

  const onSend = (fields: readonly Element[], form: Element | null): void => {
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
        known: new Set(keyedTurns().map(({ key }) => key)),
        prompt,
      },
      {
        doc,
        signal: scope.signal,
        conversation: routeConversation,
        report,
        newest: () => {
          const newest = keyedTurns().at(-1);
          return newest
            ? { key: newest.key, prompt: compact(textWithLatexSource(newest.turn)) }
            : null;
        },
      },
    );
  };

  const composerForm = (target: Element): Element | null => {
    const selectors = sendTargets(site, doc);
    const form = selectors.composerRoot ? target.closest(selectors.composerRoot) : null;
    return form?.querySelector(selectors.composer) ? form : null;
  };
  const sendFrom = (form: Element): void =>
    onSend(Array.from(form.querySelectorAll(sendTargets(site, doc).composer)), form);

  // Capture phase: these run before the host handles the send and renders its message.
  scope.on(
    doc,
    'keydown',
    (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      const field =
        event.target instanceof Element
          ? event.target.closest(sendTargets(site, doc).composer)
          : null;
      if (field) onSend([field], composerForm(field));
    },
    { capture: true },
  );
  scope.on(
    doc,
    'click',
    (event) => {
      const sendButton = sendTargets(site, doc).sendButton;
      const button =
        event.target instanceof Element && sendButton ? event.target.closest(sendButton) : null;
      if (!button || button.matches(':disabled, [aria-disabled="true"]')) return;
      const form = composerForm(button);
      if (form) sendFrom(form);
    },
    { capture: true },
  );
  scope.on(
    doc,
    'submit',
    (event) => {
      const form = event.target instanceof Element ? composerForm(event.target) : null;
      if (form) sendFrom(form);
    },
    { capture: true },
  );
}
