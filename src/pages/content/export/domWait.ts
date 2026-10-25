/**
 * Resolve with the first element matching any selector, waiting for DOM
 * mutations until `timeoutMs` (0 = no timeout). Resolves `null` on timeout or
 * when `signal` aborts, and never rejects; the observer and timer are always
 * released once settled.
 */
export function waitForAnyElement(
  selectors: string[] | (() => string[]),
  timeoutMs: number = 10000,
  signal?: AbortSignal,
): Promise<Element | null> {
  return new Promise((resolve) => {
    const find = (): Element | null => {
      const current = typeof selectors === 'function' ? selectors() : selectors;
      for (const s of current) {
        const el = document.querySelector(s);
        if (el) return el;
      }
      return null;
    };
    const present = find();
    if (present || signal?.aborted) return resolve(present);

    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = (value: Element | null) => {
      try {
        obs.disconnect();
      } catch {}
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort = () => settle(null);
    const obs = new MutationObserver(() => {
      const found = find();
      if (found) settle(found);
    });

    try {
      obs.observe(document.body, { childList: true, subtree: true });
    } catch {}
    signal?.addEventListener('abort', onAbort, { once: true });
    if (timeoutMs > 0) timer = setTimeout(() => settle(null), timeoutMs);
  });
}

/** Single-selector form of {@link waitForAnyElement} with a 6 s default. */
export function waitForElement(
  selector: string,
  timeoutMs: number = 6000,
  signal?: AbortSignal,
): Promise<Element | null> {
  return waitForAnyElement([selector], timeoutMs, signal);
}
