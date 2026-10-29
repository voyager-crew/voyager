export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export type ToastAction = {
  readonly label: string;
  /** The toast stays open; call `handle.dismiss()` or `handle.update()` as the outcome needs. */
  run(handle: ToastHandle): void;
};

export type ToastInput = {
  readonly message: string;
  readonly title?: string;
  /** Default `info`. `error` is announced as an alert, the rest as a status. */
  readonly tone?: ToastTone;
  /** Work still running: a pulsing dot, and the toast is never evicted to make room. */
  readonly pending?: boolean;
  /** `null` keeps the toast until it is dismissed: such a toast is never evicted either. */
  readonly durationMs: number | null;
  /**
   * While the pointer is on the toast or focus is inside it, its timer waits and
   * it is not evicted; leaving resumes the time left. For a toast whose action
   * the person needs time to reach, such as Undo.
   */
  readonly pauseOnHover?: boolean;
  /** Text that changes while the toast is open, such as a countdown. It is its own live region. */
  readonly detail?: string;
  readonly action?: ToastAction;
  /** Renders a close button with this accessible name. */
  readonly dismissLabel?: string;
  /** The user pressed the close button. */
  readonly onDismiss?: () => void;
  /** Makes the message a button; pressing it closes the toast, then calls this. */
  readonly onActivate?: () => void;
  /** A toast shown on an open channel of the same toaster replaces it in place. */
  readonly channel?: string;
};

export type ToastPatch = Partial<Omit<ToastInput, 'channel' | 'onActivate'>>;

export type ToastHandle = {
  readonly isOpen: boolean;
  /** Change the open toast in place. Passing `durationMs` restarts its timer. */
  update(patch: ToastPatch): void;
  dismiss(): void;
};

/**
 * One owner's toasts. Every toaster on the page shares one stack at the
 * bottom-end corner; the toaster scopes channels, the anchor and cleanup.
 */
export type Toaster = {
  show(input: ToastInput): ToastHandle;
  dismiss(channel: string): void;
  /**
   * Show this toaster's toasts beside `element` instead of in the stack, for
   * `ttlMs` from now. A stale or detached anchor sends them back to the stack.
   */
  setAnchor(element: HTMLElement, ttlMs: number): void;
  /** Close this owner's toasts and forget its anchor. The toaster stays usable. */
  clear(): void;
  /** Clear for good: later calls do nothing. */
  destroy(): void;
};
