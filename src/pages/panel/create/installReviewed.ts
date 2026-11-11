import { importLocalPlugin } from '@/features/plugins/local/localPluginImport';
import {
  type LocalPluginRecordMap,
  loadLocalPluginRecords,
} from '@/features/plugins/local/localPluginStore';
import type { CheckedPluginReply } from '@/features/plugins/local/pluginReply';
import type { ManifestIssue } from '@/features/plugins/manifest/validate';
import { isScriptedManifest } from '@/features/plugins/scripted/types';
import type { PluginManifest } from '@/features/plugins/types';
import { setPluginEnabledWithSiteAccess } from '@/pages/popup/utils/pluginEnablement';
import { enableScriptedWithSiteAccess } from '@/pages/popup/utils/scriptedEnablement';

export type AcceptedReply = Extract<CheckedPluginReply, { ok: true }>;

export type InstallOutcome =
  | {
      readonly kind: 'installed';
      readonly manifest: PluginManifest;
      /** False when the browser refused the site access it needs: installed, still off. */
      readonly enabled: boolean;
      /** The version it replaced ran a native op or code, which keeps running until the page reloads (D7). */
      readonly reload: boolean;
    }
  /** The install under this id changed since the review: nothing was enabled; review again. */
  | { readonly kind: 'changed' }
  | { readonly kind: 'failed'; readonly issues: readonly ManifestIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keepsRunning(manifest: unknown): boolean {
  if (!isRecord(manifest) || !isRecord(manifest.contributes)) return false;
  if (manifest.tier === 'scripted') return true;
  const ops = manifest.contributes.domOps;
  return Array.isArray(ops) && ops.some((op) => isRecord(op) && op.op === 'native');
}

/**
 * "Install and turn on": import exactly the reviewed object, only over the
 * install the review saw, then switch on exactly what was imported. The
 * import lands disabled like every import; the enable goes through the
 * unchanged-check, so an import that raced in between stays off.
 */
export async function installReviewed(
  checked: AcceptedReply,
  pageUrl: string,
): Promise<InstallOutcome> {
  const none: LocalPluginRecordMap = {};
  const replaced = (await loadLocalPluginRecords().catch(() => none))[checked.manifest.id];
  const imported = await importLocalPlugin(checked.raw, undefined, {
    expectedInstalled: checked.installed,
  });
  if (!imported.ok)
    return imported.changedSinceReview
      ? { kind: 'changed' }
      : { kind: 'failed', issues: imported.issues };
  // A scripted plugin turns on bound to the hash of what was reviewed, never of what was stored.
  const toggled = isScriptedManifest(checked.manifest)
    ? await enableScriptedWithSiteAccess(checked.manifest, pageUrl)
    : await setPluginEnabledWithSiteAccess(imported.manifest, true, pageUrl, () => {});
  if (toggled === 'changed') return { kind: 'changed' };
  return {
    kind: 'installed',
    manifest: imported.manifest,
    enabled: toggled === 'enabled',
    reload: keepsRunning(replaced?.manifest),
  };
}

/** A second click on "Turn on" when the first enable could not get site access. */
export async function turnOnInstalled(manifest: PluginManifest, pageUrl: string): Promise<boolean> {
  const toggled = isScriptedManifest(manifest)
    ? await enableScriptedWithSiteAccess(manifest, pageUrl)
    : await setPluginEnabledWithSiteAccess(manifest, true, pageUrl, () => {});
  return toggled === 'enabled';
}
