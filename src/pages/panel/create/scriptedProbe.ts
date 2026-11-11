/**
 * A fresh extension context for the panel. The panel frame stays open while
 * the user flips "Allow User Scripts" in another tab, and Chrome shows
 * `chrome.userScripts` only to contexts created after that, so "I turned it
 * on" loads the panel page again in a hidden child frame. That frame skips
 * the panel bootstrap, probes and reconciles (`createScriptedClient`), posts
 * the status to this frame and is removed.
 */
import { PANEL_PAGE_PATH } from '@/features/panel/protocol';
import { createScriptedClient, parseScriptedStatus } from '@/features/plugins/scripted/client';
import type { ScriptedStatus } from '@/features/plugins/scripted/messages';

export const SCRIPTED_PROBE_HASH = '#scripted-probe';
const PROBED = 'gv.scripted.probed';
const PROBE_TIMEOUT_MS = 8_000;

export function isScriptedProbeFrame(): boolean {
  return location.hash === SCRIPTED_PROBE_HASH && window.parent !== window;
}

/** The child side: report once, to this extension's own origin only. */
export async function runScriptedProbe(): Promise<void> {
  const status = await createScriptedClient()
    .refresh('recheck')
    .catch(() => undefined);
  window.parent.postMessage({ type: PROBED, status }, location.origin);
}

/** The panel side: the status a context created now sees, or undefined when none answered. */
export function probeInFreshFrame(): Promise<ScriptedStatus | undefined> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    const finish = (status: ScriptedStatus | undefined): void => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      frame.remove();
      resolve(status);
    };
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
      const data: unknown = event.data;
      if (typeof data !== 'object' || data === null || !('type' in data) || data.type !== PROBED) {
        return;
      }
      finish(parseScriptedStatus('status' in data ? data.status : undefined));
    };
    const timer = setTimeout(() => finish(undefined), PROBE_TIMEOUT_MS);
    window.addEventListener('message', onMessage);
    frame.src = `${chrome.runtime.getURL(PANEL_PAGE_PATH)}${SCRIPTED_PROBE_HASH}`;
    document.body.append(frame);
  });
}
