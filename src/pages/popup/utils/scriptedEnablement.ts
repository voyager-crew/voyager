import browser from 'webextension-polyfill';

import { pluginToOriginPatternsForActiveUrl } from '@/features/plugins/runtime/siteRegistration';
import {
  disableScripted,
  enableScriptedIfUnchanged,
  scriptedReviewHash,
} from '@/features/plugins/scripted/state';
import type { ScriptedManifest } from '@/features/plugins/scripted/types';

export type ScriptedTurnOnResult = 'enabled' | 'changed' | 'denied' | 'write_failed';

/**
 * Turn on the scripted creation the user is looking at, from their click.
 * The enable binds to the hash of `reviewed`, the manifest on screen, so a
 * re-import since then is `changed` and nothing turns on. User scripts inject
 * only where Voyager holds host access, so a site Voyager reaches through
 * optional access is asked for in the same click; refusing it turns the
 * creation off again. The enable is written first because Chrome may close
 * the popup while its prompt is open; the background reconciles on the grant.
 */
export async function enableScriptedWithSiteAccess(
  reviewed: ScriptedManifest,
  activeUrl: string | undefined,
): Promise<ScriptedTurnOnResult> {
  const enabled = await enableScriptedIfUnchanged(reviewed.id, await scriptedReviewHash(reviewed));
  if (enabled !== 'enabled') return enabled;
  const origins = pluginToOriginPatternsForActiveUrl(reviewed, activeUrl);
  if (origins.length === 0) return 'enabled';
  try {
    if (await browser.permissions.contains({ origins })) return 'enabled';
    if (await browser.permissions.request({ origins })) return 'enabled';
  } catch {
    // A refused or failed prompt leaves it off below.
  }
  await disableScripted(reviewed.id);
  return 'denied';
}
