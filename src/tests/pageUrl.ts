/**
 * Where the jsdom test page is, and whether it asked to load another document.
 *
 * jsdom's `window`, `document`, `location` and `top` cannot be redefined in a
 * browser realm: the VM pools run tests in one, so replacing `location` with
 * `Object.defineProperty` or `vi.stubGlobal` fails there. Moving the page
 * itself works in every pool, and `location`, `document.URL`, the origin and
 * the History API all agree on the new URL.
 */
import type { JSDOM } from 'jsdom';
import { type Mock, onTestFinished, vi } from 'vitest';

declare const jsdom: JSDOM;

const startUrl = location.href;

/**
 * Puts the page at `url`, resolved against the current one, without a
 * navigation: no history entry, no events, nothing reloads.
 */
export function setPageUrl(url: string | URL): void {
  jsdom.reconfigure({ url: new URL(url, location.href).href });
}

/** Puts the page back at the URL this test file started at. */
export function resetPageUrl(): void {
  jsdom.reconfigure({ url: startUrl });
}

const NAVIGATION_REPORT = 'Not implemented: navigation to another Document';

/**
 * A mock called once for each full page load the page asks for until the
 * current test ends: `location.reload()`, and `assign`, `replace` or `href`
 * to another document. jsdom loads nothing and reports each one on its
 * virtual console. It ignores a same-URL `assign` or `href`, which a browser
 * would reload, so those go uncounted. History API routes are not page loads.
 */
export function watchFullPageLoads(): Mock<() => void> {
  const loaded = vi.fn<() => void>();
  const onReport = (error: Error): void => {
    if (error.message === NAVIGATION_REPORT) loaded();
  };
  jsdom.virtualConsole.on('jsdomError', onReport);
  onTestFinished(() => {
    jsdom.virtualConsole.off('jsdomError', onReport);
  });
  return loaded;
}
