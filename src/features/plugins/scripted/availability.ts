import type { VoyagerBuildTarget } from '@/core/utils/browser';
import type { FormFactor } from '@/core/utils/formFactor';

import type { UserScriptsAvailability } from './types';

/** Per-plugin worlds (`worldId`, `configureWorld({ worldId })`) arrived in Chrome 133. */
export const USER_SCRIPTS_MIN_CHROME = 133;
/** From Chrome 138 the API sits behind each extension's "Allow User Scripts" toggle, before it behind Developer mode. */
export const ALLOW_USER_SCRIPTS_TOGGLE_CHROME = 138;

export interface UserScriptsProbe {
  readonly target: VoyagerBuildTarget;
  readonly formFactor: FormFactor;
  /** Undefined when the user agent does not say; treated as a current Chrome. */
  readonly chromeMajor: number | undefined;
  /** `chrome.userScripts` read now: Chrome leaves it undefined while the toggle is off. */
  readonly userScripts: Pick<typeof chrome.userScripts, 'getScripts'> | undefined;
}

export function chromeMajorVersion(userAgent: string): number | undefined {
  const match = /\bChrom(?:e|ium)\/(\d+)/.exec(userAgent);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

/** Never throws: a failing `getScripts` means the user has not allowed user scripts. */
export async function probeUserScripts(probe: UserScriptsProbe): Promise<UserScriptsAvailability> {
  if (probe.target === 'safari' || probe.target === 'firefox') {
    return { kind: 'unsupported', browser: probe.target };
  }
  if (probe.formFactor === 'mobile') return { kind: 'unsupported', browser: 'mobile' };
  const major = probe.chromeMajor;
  if (major !== undefined && major < USER_SCRIPTS_MIN_CHROME) {
    return { kind: 'unsupported', browser: 'old' };
  }
  const needs =
    major === undefined || major >= ALLOW_USER_SCRIPTS_TOGGLE_CHROME
      ? 'allow-user-scripts'
      : 'developer-mode';
  if (!probe.userScripts) return { kind: 'toggle-off', needs };
  try {
    await probe.userScripts.getScripts();
    return { kind: 'available' };
  } catch {
    return { kind: 'toggle-off', needs };
  }
}
