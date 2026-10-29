/**
 * The stored preference behind one plugin's switch and settings, whichever
 * storage holds it: a legacy-bound official plugin reads its old sync keys,
 * every other plugin its `gvPluginsState` entry. The popup's list rows and its
 * diagnostics both resolve through here, with the same functions the page's
 * `PluginHost` uses.
 *
 * Without a page lifetime there is no `wasChangedLive`, so a derived switch
 * reads as the stored preference, not as a page that saw live changes decided.
 */
import type { PluginManifest, PluginSettings } from '../types';
import {
  type LegacySettingSnapshot,
  hasEnableBinding,
  resolveEffectiveEnabled,
  resolveEffectiveSettings,
} from './legacySettingBindings';
import { deriveLegacyValueSettings } from './legacyValueBindings';
import type { PluginStateMap } from './pluginState';

export type PluginPreferenceAuthority = 'legacy' | 'plugin-state';

export interface EffectivePluginView {
  readonly enabled: boolean;
  readonly settings: PluginSettings;
  readonly authority: PluginPreferenceAuthority;
}

export function effectivePluginView(
  manifest: PluginManifest,
  state: PluginStateMap,
  legacy: LegacySettingSnapshot,
  url?: string,
): EffectivePluginView {
  const bound = hasEnableBinding(manifest.id);
  return {
    enabled: resolveEffectiveEnabled(state, legacy, manifest.id, undefined, url),
    settings: bound
      ? deriveLegacyValueSettings(manifest.id, legacy)
      : resolveEffectiveSettings(manifest, state),
    authority: bound ? 'legacy' : 'plugin-state',
  };
}
