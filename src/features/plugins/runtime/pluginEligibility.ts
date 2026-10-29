/**
 * Whether one plugin may run on this page, before arbitration over page-wide
 * runtimes (`PluginHost.reconcile` asks this for every listed plugin), and
 * the settings it runs with.
 */
import { logger } from '@/core/services/LoggerService';
import type { FormFactor } from '@/core/types/formFactor';

import { OFFICIAL_PLUGIN_IDS } from '../sites/featureOwners';
import { hostPolicyRefusal } from '../sites/hostPolicy';
import { matchesAnyPattern } from '../sites/matchPattern';
import { sharedTimelineAdmissionId } from '../sites/sharedTimelinePolicy';
import {
  type LegacySettingSnapshot,
  resolveEffectiveSettings,
} from '../storage/legacySettingBindings';
import type { PluginStateMap } from '../storage/pluginState';
import type { EntitlementProvider, PluginManifest, PluginSettings, SiteAdapter } from '../types';
import { hasPrimitive } from '../verbs/registry';
import { legacyBoundSettings } from './legacySnapshotFeed';
import type { OfficialAdmission } from './officialAdmission';
import { findIncompatibility } from './pluginStatus';
import { type WishInput, type WishVerdict, wishVerdict } from './reconcileArbitration';
import { duplicateResourceClaims } from './resourceClaims';

export interface EligibilityContext {
  readonly url: string;
  /** The site's master switch; off lets only the shared visual effects through. */
  readonly surfaceOn: boolean;
  readonly admission: OfficialAdmission;
  readonly adapter: SiteAdapter | null;
  /** The device class the page runs on; a plugin that does not list it stays off. */
  readonly formFactor: FormFactor;
  readonly entitlement: EntitlementProvider;
}

/**
 * The plugin's `matches` cover this page, and the page's host policy
 * refuses nothing it brings (theme, native ops), judged by the page's real
 * host rather than by its patterns.
 */
export function targetsPage(url: string, manifest: PluginManifest): boolean {
  if (!matchesAnyPattern(url, manifest.matches)) return false;
  return hostPolicyRefusal(url, manifest) === null;
}

/**
 * Whether the plugin runs (`run`), would run but awaits its admission
 * (`reserve`) or its legacy switch (`await`, see `resourceArbiter.ts`), or
 * stays off. Arbitration over page-wide runtimes comes after this.
 */
export async function evaluatePlugin(
  manifest: PluginManifest,
  wishInput: Omit<WishInput, 'admission'>,
  context: EligibilityContext,
): Promise<WishVerdict> {
  // Visual effects already ran before AI Studio's master gate in native startup.
  if (!context.surfaceOn && manifest.id !== OFFICIAL_PLUGIN_IDS.visualEffects) return 'skip';
  if (!targetsPage(context.url, manifest)) return 'skip';
  const wish = wishVerdict(
    {
      ...wishInput,
      url: context.url,
      admission: context.admission,
      admissionId: sharedTimelineAdmissionId(context.url, manifest),
    },
    manifest.id,
  );
  if (wish === 'skip') return 'skip';
  if (duplicateResourceClaims(manifest).length > 0) return 'skip';
  const incompatibility = findIncompatibility({
    manifest,
    adapter: context.adapter,
    hasPrimitive,
    formFactor: context.formFactor,
  });
  if (incompatibility) {
    logger.warn('Plugin skipped: incompatible with this build or site', {
      id: manifest.id,
      status: incompatibility.kind,
      formFactor: incompatibility.formFactor,
      requiredEngine: incompatibility.requiredEngine,
      missingHandlers: incompatibility.missingHandlers,
      missingSemantic: incompatibility.missingSemantic,
      missingSections: incompatibility.missingSections,
    });
    return 'skip';
  }
  const entitlement = await context.entitlement.getState(manifest.id);
  return entitlement === 'locked' ? 'skip' : wish;
}

/**
 * Declared defaults merged with stored values; an official plugin bound to a
 * legacy switch reads only its legacy value keys (`{}` without any). A bound
 * plugin only reaches this once the snapshot has landed.
 */
export function resolveRunSettings(
  manifest: PluginManifest,
  state: PluginStateMap,
  legacy: LegacySettingSnapshot | null,
): PluginSettings {
  return (
    legacyBoundSettings(manifest.id, legacy ?? {}) ?? resolveEffectiveSettings(manifest, state)
  );
}
