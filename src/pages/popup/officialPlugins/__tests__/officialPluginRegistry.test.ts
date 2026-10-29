import { describe, expect, it } from 'vitest';

import { BACKUPABLE_SYNC_SETTINGS_DEFAULTS } from '@/core/services/SettingsBackupService';
import {
  OFFICIAL_PLUGIN_IDS,
  isPackagedOfficialPluginId,
} from '@/features/plugins/sites/featureOwners';
import { BuiltinPluginSource } from '@/features/plugins/sources/BuiltinPluginSource';
import { BundledCatalogPluginSource } from '@/features/plugins/sources/BundledCatalogPluginSource';
import {
  LEGACY_ENABLE_BINDINGS,
  legacyBindingFor,
  legacyEnableWrite,
} from '@/features/plugins/storage/legacySettingBindings';
import { legacyValueBindingsFor } from '@/features/plugins/storage/legacyValueBindings';
import { loadTranslations } from '@/utils/translations';

import { OFFICIAL_PLUGIN_TOPIC_IDS } from '../../utils/nativeSiteCapabilities';
import {
  OFFICIAL_PLUGIN_ENTRIES,
  OFFICIAL_PLUGIN_TOPICS,
  POPUP_LEGACY_SNAPSHOT_KEYS,
  SWITCHED_BY_SETTINGS_CARD,
} from '../officialPluginRegistry';

const en = await loadTranslations('en');

async function packagedManifests() {
  const lists = await Promise.all([
    new BuiltinPluginSource().list(),
    new BundledCatalogPluginSource().list(),
  ]);
  return new Map(lists.flat().map((manifest) => [manifest.id, manifest]));
}

describe('the official plugin list registry', () => {
  it('lists each packaged official plugin at most once, in a topic card', () => {
    const ids = OFFICIAL_PLUGIN_ENTRIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of OFFICIAL_PLUGIN_ENTRIES) {
      expect(isPackagedOfficialPluginId(entry.id), entry.id).toBe(true);
    }
    // Every topic is a popup section, so it reorders and anchors like any card.
    expect(OFFICIAL_PLUGIN_TOPICS.map((topic) => topic.id)).toEqual([...OFFICIAL_PLUGIN_TOPIC_IDS]);
  });

  it('gives every packaged Gemini and AI Studio plugin a row, or leaves its switch to a settings card', () => {
    const listed = new Set(OFFICIAL_PLUGIN_ENTRIES.map((entry) => entry.id));
    expect(
      Object.values(OFFICIAL_PLUGIN_IDS).filter(
        (id) => !listed.has(id) && !SWITCHED_BY_SETTINGS_CARD.has(id),
      ),
    ).toEqual([]);
    // One switch never shows twice: a card's plugin has no row as well.
    expect([...SWITCHED_BY_SETTINGS_CARD].filter((id) => listed.has(id))).toEqual([]);
  });

  it('gives every plugin bound to an old setting a row, so none is left without a switch', () => {
    const listed = new Set(OFFICIAL_PLUGIN_ENTRIES.map((entry) => entry.id));
    expect(
      Object.keys(LEGACY_ENABLE_BINDINGS).filter(
        (id) => !listed.has(id) && !SWITCHED_BY_SETTINGS_CARD.has(id),
      ),
    ).toEqual([]);
  });

  it('lists only plugins whose switch is their old setting, so a row never writes plugin state', () => {
    for (const entry of OFFICIAL_PLUGIN_ENTRIES) {
      expect(legacyBindingFor(entry.id), entry.id).not.toBeNull();
    }
  });

  it('lists only plugins whose every setting is filled from an old setting', async () => {
    const manifests = await packagedManifests();
    for (const entry of OFFICIAL_PLUGIN_ENTRIES) {
      const manifest = manifests.get(entry.id);
      expect(manifest, entry.id).toBeDefined();
      // A row's settings write to their old keys; a setting nothing binds would never be saved.
      const declared = Object.keys(manifest!.contributes.settings ?? {}).sort();
      const bound = legacyValueBindingsFor(entry.id)
        .map((binding) => binding.settingKey)
        .sort();
      expect(declared, entry.id).toEqual(bound);
    }
  });

  it('gives every number setting a slider, which writes on release', async () => {
    // The generic settings panel writes a number on every step, a sync write each.
    const manifests = await packagedManifests();
    for (const entry of OFFICIAL_PLUGIN_ENTRIES) {
      const fields = Object.entries(manifests.get(entry.id)!.contributes.settings ?? {});
      const numbers = fields.filter(([, field]) => field.type === 'number').map(([key]) => key);
      expect(Object.keys(entry.sliders ?? {}).sort(), entry.id).toEqual(numbers.sort());
      // A row with its own inline control shows that instead of the generic settings.
      if (entry.inlinePanel) continue;
      for (const [key, field] of fields) {
        expect(['boolean', 'number'], `${entry.id}.${key}`).toContain(field.type);
      }
    }
  });

  it('a restored settings backup keeps a never-touched switch the way it was', () => {
    // Files from v2.2.1 and earlier carry every backup default, and restoring one writes them.
    // A width switch that was never stored reads on from a customized width (`derive`);
    // those files wrote that derived value instead of the default, so this check covers the
    // plain defaults.
    const defaults: Readonly<Record<string, unknown>> = BACKUPABLE_SYNC_SETTINGS_DEFAULTS;
    // The background stores the highlight switch on first run (migrateOptionalHighlightSetting),
    // so its key is never missing for long; its backup default (on) never meets a missing key.
    const storedOnFirstRun = new Set<string>([OFFICIAL_PLUGIN_IDS.geminiHighlight]);
    for (const entry of OFFICIAL_PLUGIN_ENTRIES) {
      if (storedOnFirstRun.has(entry.id)) continue;
      const binding = legacyBindingFor(entry.id)!;
      expect(Object.hasOwn(defaults, binding.key), binding.key).toBe(true);
      expect(binding.read(defaults[binding.key]), entry.id).toBe(binding.read(undefined));
    }
  });

  it('names every topic and every old search word in English', () => {
    for (const topic of OFFICIAL_PLUGIN_TOPICS) {
      expect(en[topic.title], topic.id).toBeTruthy();
      expect(en[topic.tocLabel], topic.id).toBeTruthy();
    }
    for (const entry of OFFICIAL_PLUGIN_ENTRIES) {
      for (const key of entry.searchKeys) expect(en[key], key).toBeTruthy();
    }
  });

  // Undo puts back each written key as the popup showed it; a key it does not follow would read
  // unstored and be removed.
  it('follows every key a switch flip writes, so its undo can put each one back', () => {
    const followed = new Set(POPUP_LEGACY_SNAPSHOT_KEYS);
    const written = OFFICIAL_PLUGIN_ENTRIES.flatMap((entry) =>
      [true, false].flatMap((enabled) =>
        Object.keys(
          entry.enableWrite ? entry.enableWrite(enabled, {}) : legacyEnableWrite(entry.id, enabled),
        ),
      ),
    );
    expect(written.filter((key) => !followed.has(key))).toEqual([]);
  });
});
