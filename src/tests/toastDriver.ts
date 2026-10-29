/**
 * Reads and presses the shared toasts the way a user does, by text, label and
 * the tone the toast exposes, so call-site tests do not depend on its markup.
 */
const HOST = '[data-gv-layer="toast"]';

export type ToastSnapshot = {
  readonly element: HTMLElement;
  readonly title: string;
  /** The message without its detail. */
  readonly message: string;
  readonly detail: string;
  readonly tone: string | null;
  readonly pending: boolean;
  readonly role: string | null;
};

function snapshot(element: HTMLElement): ToastSnapshot {
  const message = element.querySelector('.gv-toast-message');
  const title = element.querySelector<HTMLElement>('.gv-toast-title');
  const detail = element.querySelector<HTMLElement>('.gv-toast-detail');
  return {
    element,
    title: title && !title.hidden ? (title.textContent ?? '') : '',
    message: message?.firstChild?.textContent ?? '',
    detail: detail && !detail.hidden ? (detail.textContent ?? '') : '',
    tone: element.getAttribute('data-tone'),
    pending: element.hasAttribute('data-pending'),
    role: element.getAttribute('role'),
  };
}

function buttons(element: HTMLElement): HTMLButtonElement[] {
  return Array.from(element.querySelectorAll<HTMLButtonElement>('button')).filter(
    (button) => !button.hidden,
  );
}

export const toastDriver = {
  /** Every open toast, in the order it was shown. */
  all(): ToastSnapshot[] {
    return Array.from(document.querySelectorAll(HOST)).flatMap((host) =>
      Array.from(host.shadowRoot?.querySelectorAll<HTMLElement>('.gv-toast') ?? []).map(snapshot),
    );
  },
  messages(): string[] {
    return toastDriver.all().map((toast) => toast.message);
  },
  /** The open toast whose title or message contains `text`. */
  find(text: string): ToastSnapshot | undefined {
    return toastDriver
      .all()
      .find((toast) => toast.message.includes(text) || toast.title.includes(text));
  },
  /** Labels of the buttons a toast offers, by visible text or accessible name. */
  labels(toast: ToastSnapshot): string[] {
    return buttons(toast.element).map(
      (button) => button.getAttribute('aria-label') ?? button.textContent ?? '',
    );
  },
  /** Puts the pointer on the toast, or takes it away. */
  hover(toast: ToastSnapshot): void {
    toast.element.dispatchEvent(new PointerEvent('pointerenter'));
  },
  leave(toast: ToastSnapshot): void {
    toast.element.dispatchEvent(new PointerEvent('pointerleave'));
  },
  /** Moves keyboard focus onto the toast's first button. */
  focusInside(toast: ToastSnapshot): void {
    buttons(toast.element)[0]?.focus();
  },
  press(toast: ToastSnapshot, label: string): void {
    const button = buttons(toast.element).find(
      (candidate) =>
        candidate.getAttribute('aria-label') === label || candidate.textContent === label,
    );
    if (!button) throw new Error(`No toast button labelled "${label}"`);
    button.click();
  },
};
