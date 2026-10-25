import { getBundledGeminiTurnSelectors } from '@/core/gemini/turnSelectors';
import { getSendKeyCoordinator } from '@/core/services/composer/sendKeys/sendKeyCoordinator';
import { findSendButton } from '@/core/services/composer/sendKeys/sendKeyDom';
import { SEND_SITE_POLICIES } from '@/core/services/composer/sendKeys/sendSitePolicies';
import type { DraftPolicy } from '@/features/plugins/verbs/draftSave/draftPolicy';

import { isSendKeyboardEvent } from '../sendBehavior/sendButton';

interface Options {
  readonly doc: Document;
  readonly policy: DraftPolicy;
  readonly onSent: (path: string) => void;
  readonly onIntent?: () => void;
  readonly signal?: AbortSignal;
}

/** A send intent must acquire evidence before it may remove a user's source draft. */
export function startGeminiDraftSendDetection({ doc, policy, onSent, onIntent, signal }: Options): {
  checkSent(): void;
  stop(): void;
} {
  const view = doc.defaultView ?? window;
  // Remote turn discovery must never supply the evidence that deletes a saved draft.
  const userSelector = getBundledGeminiTurnSelectors('turn.userWithHosts').join(',');
  const normalize = (text: string) => policy.sanitize.fn(text).replace(/\s+/g, ' ').trim();
  let stopped = false;
  let intent: {
    path: string;
    identity: string;
    field: HTMLElement;
    text: string;
    turns: Set<Element>;
    turnIds: Set<string>;
    destination: string | null;
  } | null = null;
  let expiry: number | null = null;
  let poll: number | null = null;
  const idOf = (turn: Element): string =>
    turn.getAttribute('data-turn-id') ??
    turn.querySelector('[data-turn-id]')?.getAttribute('data-turn-id') ??
    '';

  function clear(): void {
    intent = null;
    if (expiry !== null) view.clearTimeout(expiry);
    if (poll !== null) view.clearInterval(poll);
    expiry = poll = null;
  }

  function checkSent(): void {
    const pending = intent;
    if (!pending || stopped || signal?.aborted) return;
    if (!policy.eligible(location, doc) || policy.restoreIdentity(doc) !== pending.identity) {
      clear();
      return;
    }
    const path = policy.keyFor(location);
    let sent = false;
    if (path === pending.path) {
      sent = pending.field.isConnected && policy.isEmpty(pending.field);
    } else {
      // An empty destination composer also occurs during sidebar navigation; it proves no send.
      const source = pending.path.replace(/\/$/, '');
      const suffix = path?.startsWith(`${source}/`) ? path.slice(source.length + 1) : '';
      if (
        !/^\/(?:u\/\d+\/)?(?:app|gem\/[^/]+)\/?$/.test(pending.path) ||
        !suffix ||
        suffix.includes('/') ||
        (pending.destination !== null && pending.destination !== path)
      ) {
        clear();
        return;
      }
      pending.destination = path;
      sent = Array.from(doc.querySelectorAll(userSelector)).some((turn) => {
        const id = idOf(turn);
        if (pending.turns.has(turn) || (id && pending.turnIds.has(id))) return false;
        const lines = turn.querySelectorAll('.query-text-line');
        const text = lines.length
          ? Array.from(lines, (line) => line.textContent ?? '').join('\n')
          : (turn.textContent ?? '');
        return normalize(text) === pending.text;
      });
    }
    if (sent) {
      clear();
      onSent(pending.path);
    }
  }

  function arm(field: HTMLElement): void {
    const path = policy.keyFor(location);
    if (
      stopped ||
      signal?.aborted ||
      path === null ||
      !policy.eligible(location, doc) ||
      policy.isEmpty(field)
    )
      return;
    if (!findSendButton(field, SEND_SITE_POLICIES.gemini.sendContainerSelectors)) return;
    clear();
    const turns = new Set(doc.querySelectorAll(userSelector));
    intent = {
      path,
      identity: policy.restoreIdentity(doc),
      field,
      text: normalize(policy.readText(field)),
      turns,
      turnIds: new Set(Array.from(turns, idOf).filter(Boolean)),
      destination: null,
    };
    onIntent?.();
    expiry = view.setTimeout(clear, 2000);
    poll = view.setInterval(checkSent, 250);
  }

  function keydown(event: KeyboardEvent): void {
    if (
      event.defaultPrevented ||
      !isSendKeyboardEvent(event, getSendKeyCoordinator('gemini')?.effectiveSendKey() ?? 'host')
    )
      return;
    const field = policy.findInput(doc);
    if (field && event.target instanceof Node && field.contains(event.target)) arm(field);
  }
  function click(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest('a[href]');
    if (link && new URL(link.getAttribute('href')!, location.href).pathname !== location.pathname) {
      clear();
      return;
    }
    const field = policy.findInput(doc);
    if (!field) return;
    const button = findSendButton(field, SEND_SITE_POLICIES.gemini.sendContainerSelectors);
    if (button?.contains(event.target)) arm(field);
  }
  function submit(event: Event): void {
    const field = policy.findInput(doc);
    if (
      !event.defaultPrevented &&
      field &&
      event.target instanceof Node &&
      event.target.contains(field)
    )
      arm(field);
  }
  function input(event: Event): void {
    if (!intent || !(event.target instanceof Node) || !intent.field.contains(event.target)) return;
    if (!policy.isEmpty(intent.field) && normalize(policy.readText(intent.field)) !== intent.text)
      clear();
    else checkSent();
  }
  doc.addEventListener('keydown', keydown, true);
  doc.addEventListener('click', click, true);
  doc.addEventListener('submit', submit, true);
  doc.addEventListener('input', input, true);
  function stop(): void {
    stopped = true;
    clear();
    signal?.removeEventListener('abort', stop);
    doc.removeEventListener('keydown', keydown, true);
    doc.removeEventListener('click', click, true);
    doc.removeEventListener('submit', submit, true);
    doc.removeEventListener('input', input, true);
  }
  // Retire manual listeners immediately, before the async scope ledger reaches this effect.
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  return { checkSent, stop };
}
