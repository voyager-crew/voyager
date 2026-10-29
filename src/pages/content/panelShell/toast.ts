/**
 * The shell's toast: one 40px pill at the bottom center that springs in and
 * can offer 撤销. Without an action it stays 4.2s; with one it stays about 10s
 * and waits while the pointer or focus is on it (decision Q17). Marked as a
 * Voyager layer so other surfaces' outside-press handlers leave it alone.
 *
 * The shared createToaster serves the corner stack; this is the spec's centered toast with a key cap.
 */
import { LAYER_ATTR } from '@/core/ui/layer';
import { isRTLLanguage } from '@/core/utils/rtl';
import { isUserEvent } from '@/core/utils/userEvent';
import { getCachedLanguage } from '@/utils/i18n';

import { shellText } from './text';

const SHOW_MS = 4200;
const UNDO_MS = 10_000;
const OPEN_CLASS = 'gv-ps-toast-open';

export interface ToastMessage {
  /** The text; rendered again when Voyager's language changes while it shows. */
  render(): Node[];
  undo?: () => void;
}

export interface ShellToast {
  show(message: ToastMessage): void;
  dismiss(): void;
  contains(node: Node): boolean;
  /** Follows a language change. */
  relabel(): void;
  destroy(): void;
}

export function createShellToast(): ShellToast {
  let element: HTMLDivElement | null = null;
  let text: HTMLSpanElement | null = null;
  let undoButton: HTMLButtonElement | null = null;
  let current: ToastMessage | null = null;
  let timer: number | null = null;
  /** Time left to show, and when the running countdown started. */
  let remaining = 0;
  let startedAt = 0;
  let hovered = false;
  let focused = false;
  /** Once destroyed, a late caller (a reply after the shell stopped) shows nothing. */
  let destroyed = false;

  const clearTimer = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };

  const dismiss = (): void => {
    clearTimer();
    current = null;
    hovered = focused = false;
    element?.classList.remove(OPEN_CLASS);
  };

  /** Counts down what is left, unless the user is on a toast that offers an action. */
  const run = (): void => {
    clearTimer();
    if (!current || (current.undo && (hovered || focused))) return;
    startedAt = Date.now();
    timer = window.setTimeout(dismiss, remaining);
  };

  const hold = (): void => {
    if (timer === null || !current?.undo) return;
    remaining = Math.max(0, remaining - (Date.now() - startedAt));
    clearTimer();
  };

  const onEnter = (): void => {
    hovered = true;
    hold();
  };
  const onLeave = (): void => {
    hovered = false;
    run();
  };
  const onFocusIn = (): void => {
    focused = true;
    hold();
  };
  const onFocusOut = (event: FocusEvent): void => {
    if (event.relatedTarget instanceof Node && element?.contains(event.relatedTarget)) return;
    focused = false;
    run();
  };

  const onUndo = (event: Event): void => {
    // Undo writes the synced hide setting: a page script's click() must not.
    if (!isUserEvent(event)) return;
    const undo = current?.undo;
    dismiss();
    undo?.();
  };

  const remove = (): void => {
    undoButton?.removeEventListener('click', onUndo);
    element?.removeEventListener('pointerenter', onEnter);
    element?.removeEventListener('pointerleave', onLeave);
    element?.removeEventListener('focusin', onFocusIn);
    element?.removeEventListener('focusout', onFocusOut);
    element?.remove();
    element = text = undoButton = null;
  };

  const render = (): void => {
    if (!element || !text || !undoButton || !current) return;
    element.dir = isRTLLanguage(getCachedLanguage() ?? 'en') ? 'rtl' : 'ltr';
    text.replaceChildren(...current.render());
    undoButton.textContent = shellText('panelShellUndo');
    undoButton.hidden = !current.undo;
  };

  const ensure = (): HTMLDivElement => {
    if (element?.isConnected) return element;
    // The page wiped it: start over with a fresh one.
    remove();
    const toast = document.createElement('div');
    toast.className = 'gv-ps-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.setAttribute(LAYER_ATTR, 'toast');
    text = document.createElement('span');
    text.className = 'gv-ps-toast-text';
    undoButton = document.createElement('button');
    undoButton.type = 'button';
    undoButton.className = 'gv-ps-toast-undo';
    undoButton.addEventListener('click', onUndo);
    toast.addEventListener('pointerenter', onEnter);
    toast.addEventListener('pointerleave', onLeave);
    toast.addEventListener('focusin', onFocusIn);
    toast.addEventListener('focusout', onFocusOut);
    toast.append(text, undoButton);
    document.body.appendChild(toast);
    element = toast;
    return toast;
  };

  return {
    show(message) {
      if (destroyed) return;
      const toast = ensure();
      clearTimer();
      current = message;
      render();
      if (!toast.classList.contains(OPEN_CLASS)) {
        // Start from the closed style so the spring plays.
        void toast.offsetWidth;
        toast.classList.add(OPEN_CLASS);
      }
      remaining = message.undo ? UNDO_MS : SHOW_MS;
      run();
    },
    dismiss,
    contains: (node) => element?.contains(node) ?? false,
    relabel: render,
    destroy() {
      destroyed = true;
      dismiss();
      remove();
    },
  };
}
