/**
 * Exclusive page resources a plugin's `native` ops take, derived from package
 * metadata. A manifest cannot declare or understate them.
 *
 * Only runtimes proven to be one per page are listed: the formula-copy service
 * is a singleton with its own generation counter, and Vim input keeps its state
 * in module scope. Send shortcuts also claim the composer mode on every site, so conflicting
 * modes are visible instead of leaving the later listener silently inactive. A timeline rail
 * also owns page navigation and one visual surface, including the fixed-id Gemini builtin. The
 * folders runtime owns the site's folder data session and its sidebar surface: two runtimes
 * would open two repositories on one bucket. The site check is one launcher and one picker,
 * which takes the page's presses while it runs.
 */
import { OFFICIAL_PLUGIN_IDS } from '../sites/featureOwners';
import type { PluginManifest } from '../types';

export type ResourceId = string;

const HANDLER_RESOURCES: Readonly<Record<string, readonly ResourceId[]>> = {
  formulaCopy: ['formula-copy-service'],
  vimInput: ['vim-input-runtime'],
  sendShortcut: ['composer-send-key-mode'],
  turnNavigator: ['timeline-rail'],
  folders: ['folders-surface'],
  siteCheck: ['site-check-launcher'],
  conversationExport: ['conversation-export-surface'],
  promptManager: ['prompt-manager-surface'],
};

/** One resource claimed by one `native` op, kept per op so repeats stay visible. */
export interface ResourceClaim {
  readonly resource: ResourceId;
  readonly handler: string;
  /** Index of the op in `contributes.domOps`; -1 names a fixed builtin runtime. */
  readonly opIndex: number;
}

export function handlerResources(handler: string): readonly ResourceId[] {
  return Object.prototype.hasOwnProperty.call(HANDLER_RESOURCES, handler)
    ? HANDLER_RESOURCES[handler]
    : [];
}

/** Every claim of every `native` op, in op order, repeats included. */
export function opResourceClaims(manifest: PluginManifest): readonly ResourceClaim[] {
  const claims: ResourceClaim[] = [];
  (manifest.contributes.domOps ?? []).forEach((op, opIndex) => {
    if (op.op !== 'native') return;
    for (const resource of handlerResources(op.handler)) {
      claims.push({ resource, handler: op.handler, opIndex });
    }
  });
  // The fixed-id rail has no native op, but still excludes another rail and holds its release.
  if (manifest.id === OFFICIAL_PLUGIN_IDS.geminiTimeline) {
    for (const resource of handlerResources('turnNavigator')) {
      claims.push({ resource, handler: 'turnNavigator', opIndex: -1 });
    }
  }
  // A confirmed batch drains after disable; re-enable must wait for that destructive run.
  if (
    manifest.id === OFFICIAL_PLUGIN_IDS.geminiBatchDelete ||
    manifest.id === OFFICIAL_PLUGIN_IDS.aistudioBatchDelete
  ) {
    claims.push({ resource: 'batch-delete-run', handler: 'batchDelete', opIndex: -1 });
  }
  return claims;
}

/** The distinct resources the plugin holds while mounted. */
export function claimedResources(manifest: PluginManifest): readonly ResourceId[] {
  return [...new Set(opResourceClaims(manifest).map((claim) => claim.resource))];
}

/**
 * Resources the manifest claims more than once (two `vimInput` ops, or two
 * handlers sharing one runtime). Such a plugin never runs: the engine would
 * start the singleton twice and the later op would overwrite the first.
 */
export function duplicateResourceClaims(manifest: PluginManifest): readonly ResourceId[] {
  const seen = new Set<ResourceId>();
  const repeated = new Set<ResourceId>();
  for (const { resource } of opResourceClaims(manifest)) {
    if (seen.has(resource)) repeated.add(resource);
    seen.add(resource);
  }
  return [...repeated];
}
