/** Keep Prompt Manager's unsaved UI across adapter changes outside its dependencies. */
import { getBundledSiteSelectorView } from '@/core/selectors/bundle';
import { getSiteSelectorContract } from '@/core/selectors/contracts';
import { PROMPT_FAB_LOCATOR_KEY } from '@/core/services/composer/inputPlacement';
import { CHAT_INPUT_LOCATOR_KEY } from '@/core/services/composer/siteInputReads';

import { isSameSiteAdapter } from '../remote/siteOverride';
import { promptCoverageBindingFor } from '../storage/promptCoverageBinding';
import type { PluginManifest, SiteAdapter } from '../types';
import type { DeclarativeEngine } from './declarativeEngine';

/** A mixed plugin shares its primitive scope and must keep the normal rebuild behavior. */
export function isStandalonePromptManager(manifest: PluginManifest): boolean {
  const ops = manifest.contributes.domOps ?? [];
  return (
    promptCoverageBindingFor(manifest.id) !== null &&
    !manifest.contributes.styles?.length &&
    ops.length === 1 &&
    ops[0].op === 'native' &&
    ops[0].handler === 'promptManager'
  );
}

function dependencies(adapter: SiteAdapter | null): string {
  const bundled =
    adapter && getSiteSelectorContract(adapter.id)
      ? getBundledSiteSelectorView(adapter.id).profiles
      : undefined;
  return JSON.stringify([
    adapter?.id,
    adapter?.prompt,
    // The panel inserts into the composer; its engine health counts user turns.
    ['composer', 'composerRoot', 'sendButton', 'userTurn'].map((key) => adapter?.selectors[key]),
    // Publishing unchanged defaults must not discard a draft started on the bundle.
    [CHAT_INPUT_LOCATOR_KEY, PROMPT_FAB_LOCATOR_KEY].map(
      (key) => adapter?.locators?.[key] ?? bundled?.[key],
    ),
  ]);
}

export function reloadWithPromptManager(options: {
  readonly engine: DeclarativeEngine;
  readonly previous: SiteAdapter | null;
  readonly next: SiteAdapter | null;
  readonly manifests: readonly PluginManifest[];
  readonly stale: readonly string[];
  readonly pushed: Map<string, string>;
  readonly targetsPage: (manifest: PluginManifest) => boolean;
  readonly create: () => DeclarativeEngine;
}): DeclarativeEngine {
  const sameDependencies = dependencies(options.previous) === dependencies(options.next);
  const candidates = options.manifests.filter(
    (manifest) => isStandalonePromptManager(manifest) && options.targetsPage(manifest),
  );
  if (isSameSiteAdapter(options.previous, options.next)) {
    const stale = new Set(options.stale);
    // Input locator updates do not rebuild other plugins, but can move this panel's trigger.
    if (!sameDependencies) for (const manifest of candidates) stale.add(manifest.id);
    for (const id of stale) {
      void options.engine.unmount(id);
      options.pushed.delete(id);
    }
    return options.engine;
  }
  const next = options.create();
  const retained = new Set<string>();
  if (sameDependencies) {
    for (const manifest of candidates) {
      if (options.engine.handoffPromptManager(manifest.id, next)) retained.add(manifest.id);
    }
  }
  options.engine.unmountAll();
  // Losing this fingerprint would updateSettings({}) and restart the retained primitive.
  for (const id of options.pushed.keys()) {
    if (!retained.has(id)) options.pushed.delete(id);
  }
  return next;
}
