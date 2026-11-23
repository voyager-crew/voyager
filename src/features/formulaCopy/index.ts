import type { PluginScope } from '@/features/plugins/runtime/pluginScope';

import { type FormulaCopyPreferences, getFormulaCopyService } from './FormulaCopyService';

export { FormulaCopyService, getFormulaCopyService } from './FormulaCopyService';
export type { FormulaCopyConfig, FormulaCopyPreferences } from './FormulaCopyService';

let pluginActivationGeneration = 0;

/** What an activation hands back: where its plugin's changed preferences go. */
export interface FormulaCopyActivation {
  /** Apply the holding plugin's new preferences in place, without restarting the service. */
  setPreferences(preferences: FormulaCopyPreferences): void;
}

/**
 * Scope lifecycle behind the `formulaCopy` primitive: the builtin
 * voyager.formula-copy (Claude/ChatGPT), the DeepSeek catalog plugin, the
 * packaged Gemini / AI Studio official plugins and local plugins. The host
 * lets one plugin hold the service at a time (`runtime/resourceClaims.ts`).
 *
 * `preferences` are the holding plugin's own settings (Gemini and AI Studio
 * declare them); null leaves the service reading the shared storage keys, as
 * every plugin that declares none has always done.
 */
export function activateFormulaCopy(
  scope: PluginScope,
  preferences: FormulaCopyPreferences | null = null,
): FormulaCopyActivation {
  const activationGeneration = ++pluginActivationGeneration;
  let latest = preferences;
  scope.effect(async () => {
    const service = getFormulaCopyService();
    await service.prepare(latest);
    if (scope.signal.aborted) {
      // A rapid remount may already be preparing/using the singleton. An old
      // scope is only allowed to release the generation it owns.
      if (activationGeneration === pluginActivationGeneration) service.dispose();
      return () => {};
    }
    if (activationGeneration !== pluginActivationGeneration) return () => {};
    service.initialize();
    return () => {
      if (activationGeneration === pluginActivationGeneration) service.dispose();
    };
  }, 'formula-copy');
  return {
    setPreferences(next) {
      latest = next;
      // A newer activation owns the singleton; this one's plugin no longer holds it.
      if (activationGeneration !== pluginActivationGeneration || scope.signal.aborted) return;
      getFormulaCopyService().adoptPreferences(next);
    },
  };
}
