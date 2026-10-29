/**
 * Voyager's one confirm: a card with the message above the actions, opened next
 * to the control that asked, or centred when none did. It answers the question
 * and nothing more; what happened afterwards is reported through the toast.
 */
import { SHADOW_RTL_ATTR } from '@/pages/content/folder/shadowHost';
import { getTranslationSync } from '@/utils/i18n';

import confirmCss from './confirm.css?raw';
import { type Popover, type PopoverAlign, type PopoverSide, openPopover } from './layer';

/**
 * On the anchor while its confirm is open, so the row being asked about can
 * look selected; the pointer is usually over another row by then.
 */
export const CONFIRM_ANCHOR_ATTR = 'data-gv-confirm-anchor';

export type ConfirmChoice<C extends string> = {
  readonly id: C;
  readonly label: string;
  /**
   * Default `primary`. A danger confirm paints its primary choice red, unless a
   * choice is `danger` itself: that one is then the destructive answer, in red
   * text, and the primary stays the safe one.
   */
  readonly emphasis?: 'primary' | 'secondary' | 'danger';
};

export type ConfirmRequest<C extends string> = {
  readonly message: string;
  /** Lines listed under the message, such as each kind an upload would shrink. */
  readonly details?: readonly string[];
  /**
   * The control that asked. Leave it out only when no control did, such as a
   * step of a running export: the card then sits centred in the viewport.
   */
  readonly anchor?: HTMLElement;
  /** Default `below`; it flips when the viewport has no room. */
  readonly side?: PopoverSide;
  /**
   * Default `start`. `end` lines the card up with the anchor's inline end, where
   * a row's trailing action sits, so its buttons land under that action.
   */
  readonly align?: PopoverAlign;
  /** An owning panel may use a different theme from the page. */
  readonly scheme?: 'light' | 'dark';
  /**
   * Default: the page's direction (`body.gv-rtl`). An extension page that sets
   * `dir` on its own root, such as the popup, passes it here.
   */
  readonly dir?: 'ltr' | 'rtl';
  /** A danger confirm focuses Cancel, so Enter right after opening it never destroys. */
  readonly tone: 'danger' | 'neutral';
  /** Rendered after Cancel, in order. */
  readonly choices: readonly [ConfirmChoice<C>, ...ConfirmChoice<C>[]];
  /** Default: the shared Cancel label. */
  readonly cancelLabel?: string;
  /** The owner's lifetime: aborting answers null and removes the card. */
  readonly signal?: AbortSignal;
};

let current: { popover: Popover; settle: (answer: null) => void } | null = null;

/**
 * Ask, and resolve the chosen id, or null on Cancel, Escape, an outside press,
 * the anchor leaving the page or the viewport, an aborted signal, or a newer
 * confirm. The page may have changed meanwhile: re-check what the answer acts on.
 */
export function askConfirm<C extends string = 'confirm'>(
  request: ConfirmRequest<C>,
): Promise<C | null> {
  current?.popover.close();
  current?.settle(null);
  current = null;
  if (request.signal?.aborted) return Promise.resolve(null);

  return new Promise<C | null>((resolve) => {
    let settled = false;
    const settle = (answer: C | null): void => {
      if (settled) return;
      settled = true;
      request.anchor?.removeAttribute(CONFIRM_ANCHOR_ATTR);
      if (current?.popover === popover) current = null;
      resolve(answer);
    };

    const popover = openPopover({
      anchor: request.anchor,
      side: request.side ?? 'below',
      align: request.align,
      css: confirmCss,
      signal: request.signal,
      onDismiss: () => settle(null),
    });

    // Keep the panel override separate from the scheme mirrored from the page.
    if (request.scheme) popover.host.dataset.gvUiScheme = request.scheme;
    if (request.dir) popover.host.toggleAttribute(SHADOW_RTL_ATTR, request.dir === 'rtl');

    const card = document.createElement('div');
    card.className = 'gv-confirm';
    card.dataset.tone = request.tone;
    if (request.choices.some((choice) => choice.emphasis === 'danger'))
      card.dataset.destructive = 'choice';
    card.setAttribute('role', 'alertdialog');
    card.setAttribute('aria-labelledby', 'gv-confirm-message');
    const message = document.createElement('p');
    message.className = 'gv-confirm-message';
    message.id = 'gv-confirm-message';
    message.dir = 'auto';
    message.textContent = request.message;
    const actions = document.createElement('div');
    actions.className = 'gv-confirm-actions';
    const details = request.details?.length ? document.createElement('ul') : null;
    if (details) {
      details.className = 'gv-confirm-details';
      details.id = 'gv-confirm-details';
      for (const line of request.details ?? []) {
        const item = document.createElement('li');
        item.dir = 'auto';
        item.textContent = line;
        details.append(item);
      }
      card.setAttribute('aria-describedby', details.id);
    }

    const button = (
      label: string,
      emphasis: 'cancel' | 'primary' | 'secondary' | 'danger',
      answer: C | null,
    ) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'gv-confirm-button';
      element.dataset.emphasis = emphasis;
      element.textContent = label;
      element.addEventListener('click', () => {
        popover.close();
        settle(answer);
      });
      actions.append(element);
      return element;
    };

    const cancel = button(request.cancelLabel ?? getTranslationSync('pm_cancel'), 'cancel', null);
    const choices = request.choices.map((choice) =>
      button(choice.label, choice.emphasis ?? 'primary', choice.id),
    );
    card.append(...(details ? [message, details, actions] : [message, actions]));
    popover.root.append(card);
    popover.place();
    request.anchor?.setAttribute(CONFIRM_ANCHOR_ATTR, '');

    current = { popover, settle };
    const primary = [...choices]
      .reverse()
      .find((element) => element.dataset.emphasis === 'primary');
    const initial = request.tone === 'danger' ? cancel : (primary ?? choices[0]);
    initial.focus({ preventScroll: true });
  });
}
