/**
 * The popup's and the panel's view of scripted creations. Chrome shows
 * `chrome.userScripts` only to contexts created after the user allowed user
 * scripts, so the background worker that was running when the toggle flipped
 * may still miss it while a freshly opened popup or panel sees it. When that
 * happens this page runs the registrar itself: it takes its dependencies as
 * parameters, and registrations belong to the extension, not the context that
 * made them. The background does nothing in that state (its pass returns when
 * the API is missing), so the two never race. Once the worker restarts it sees
 * the API and owns the registrations again.
 */
import { getVoyagerBuildTarget } from '@/core/utils/browser';

import { SCRIPTED_MESSAGE, type ScriptedStatus } from './messages';
import { createScriptedRegistrar } from './registrar';
import { loadScriptedPlugins, loadScriptedState } from './state';
import { readAvailabilityHere, readScriptedStatus, userScriptsHere } from './status';
import type { ScriptedPauseReason, ScriptedRunState, UserScriptsAvailability } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const PAUSE_REASONS: readonly ScriptedPauseReason[] = [
  'user-scripts-off',
  'unsupported',
  'stopped-all',
  'crash-guard',
  'needs-review',
  'world-setup',
];
const BROWSERS = ['safari', 'firefox', 'mobile', 'old'] as const;

function parseAvailability(value: unknown): UserScriptsAvailability | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === 'available') return { kind: 'available' };
  if (value.kind === 'toggle-off') {
    return value.needs === 'allow-user-scripts' || value.needs === 'developer-mode'
      ? { kind: 'toggle-off', needs: value.needs }
      : undefined;
  }
  const browser = BROWSERS.find((candidate) => candidate === value.browser);
  return value.kind === 'unsupported' && browser ? { kind: 'unsupported', browser } : undefined;
}

function parseRunState(value: unknown): ScriptedRunState | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === 'off' || value.kind === 'running') return { kind: value.kind };
  const reason = PAUSE_REASONS.find((candidate) => candidate === value.reason);
  return value.kind === 'paused' && reason ? { kind: 'paused', reason } : undefined;
}

/** A status reply from the background, or the probe frame, as it crosses in. */
export function parseScriptedStatus(value: unknown): ScriptedStatus | undefined {
  if (!isRecord(value) || value.ok !== true || typeof value.stopped !== 'boolean') return undefined;
  const availability = parseAvailability(value.availability);
  if (!availability || !Array.isArray(value.plugins)) return undefined;
  const plugins: { id: string; runState: ScriptedRunState }[] = [];
  for (const entry of value.plugins as unknown[]) {
    const runState = isRecord(entry) ? parseRunState(entry.runState) : undefined;
    if (!isRecord(entry) || typeof entry.id !== 'string' || !runState) return undefined;
    plugins.push({ id: entry.id, runState });
  }
  return { ok: true, availability, stopped: value.stopped, plugins };
}

async function askBackground(
  type: typeof SCRIPTED_MESSAGE.status | typeof SCRIPTED_MESSAGE.recheck,
): Promise<ScriptedStatus | undefined> {
  try {
    return parseScriptedStatus(await chrome.runtime.sendMessage({ type }));
  } catch {
    return undefined;
  }
}

/** Ask the background to open this extension's details page; false when it could not. */
export async function openExtensionDetails(): Promise<boolean> {
  try {
    const reply: unknown = await chrome.runtime.sendMessage({ type: SCRIPTED_MESSAGE.openDetails });
    return isRecord(reply) && reply.ok === true;
  } catch {
    return false;
  }
}

/** The address of the page with the "Allow User Scripts" toggle, for the user to paste. */
export function extensionDetailsAddress(): string {
  const scheme = getVoyagerBuildTarget() === 'edge' ? 'edge' : 'chrome';
  return `${scheme}://extensions/?id=${chrome.runtime.id}`;
}

export interface ScriptedClient {
  /**
   * Status as the best-informed context sees it. `recheck` asks the
   * background to probe and reconcile again, after the user flipped the toggle.
   */
  refresh(kind: 'status' | 'recheck'): Promise<ScriptedStatus>;
}

export function createScriptedClient(): ScriptedClient {
  const registrar = createScriptedRegistrar({
    readAvailability: readAvailabilityHere,
    readPlugins: loadScriptedPlugins,
    readState: loadScriptedState,
    userScripts: userScriptsHere,
  });
  return {
    async refresh(kind) {
      const [here, background] = await Promise.all([
        readAvailabilityHere(),
        askBackground(kind === 'recheck' ? SCRIPTED_MESSAGE.recheck : SCRIPTED_MESSAGE.status),
      ]);
      if (background?.availability.kind === 'available') return background;
      if (here.kind === 'available') {
        await registrar.reconcile();
        return readScriptedStatus(here, registrar.unconfigured());
      }
      return background ?? readScriptedStatus(here);
    },
  };
}
