/**
 * Options that moved from popup-only panels to manifest settings with value
 * bindings. Their keys are released: a value stored before the move must read
 * back as the same choice, and a write must store the shape the old panel stored.
 */
import { describe, expect, it } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { BUILTIN_PLUGINS } from '../builtin';
import { OFFICIAL_PLUGIN_IDS } from '../sites/featureOwners';
import { BundledCatalogPluginSource } from '../sources/BundledCatalogPluginSource';
import type { PluginManifest } from '../types';
import {
  acceptsLegacyLiveChange,
  deriveLegacyValueSettings,
  legacyValueBindingsFor,
  legacyValueWrite,
} from './legacyValueBindings';

const MANIFEST_LOCALES = ['zh', 'zh_TW', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'ar'] as const;
const FORMULA_IDS = [
  OFFICIAL_PLUGIN_IDS.geminiFormulaCopy,
  OFFICIAL_PLUGIN_IDS.aistudioFormulaCopy,
];

async function manifestsFor(ids: readonly string[]): Promise<PluginManifest[]> {
  const all = [...BUILTIN_PLUGINS, ...(await new BundledCatalogPluginSource().list())];
  return ids.map((id) => {
    const manifest = all.find((candidate) => candidate.id === id);
    if (!manifest) throw new Error(`No packaged manifest for ${id}`);
    return manifest;
  });
}

/** Each declared setting is bound, and labelled (and its choices named) in every manifest locale. */
async function expectDeclaredOnceAndLocalized(ids: readonly string[]): Promise<void> {
  for (const manifest of await manifestsFor(ids)) {
    const schema = manifest.contributes.settings ?? {};
    expect(
      legacyValueBindingsFor(manifest.id)
        .map((entry) => entry.settingKey)
        .sort(),
      manifest.id,
    ).toEqual(Object.keys(schema).sort());
    for (const [key, field] of Object.entries(schema)) {
      for (const locale of MANIFEST_LOCALES) {
        const localized = manifest.i18n?.[locale]?.settings?.[key];
        expect(
          field.messageKeys ?? localized?.label,
          `${manifest.id} ${key} ${locale}`,
        ).toBeTruthy();
        if (field.type === 'select') {
          expect(Object.keys(localized?.options ?? {}), `${manifest.id} ${key} ${locale}`).toEqual(
            (field.options ?? []).map((option) => option.value),
          );
        }
      }
    }
  }
}

describe('formula copy options as settings', () => {
  it('reads every stored format and selection flag as the formula service did', () => {
    for (const id of FORMULA_IDS) {
      for (const [stored, format] of [
        [undefined, 'latex'],
        ['latex', 'latex'],
        ['unicodemath', 'unicodemath'],
        ['no-dollar', 'no-dollar'],
        ['notion', 'notion'],
        ['mathml', 'latex'],
        [1, 'latex'],
      ] as const) {
        expect(
          deriveLegacyValueSettings(id, { [StorageKeys.FORMULA_COPY_FORMAT]: stored }).format,
        ).toBe(format);
      }
      for (const [stored, on] of [
        [undefined, true],
        [true, true],
        [false, false],
        ['false', true],
        [null, true],
      ] as const) {
        expect(
          deriveLegacyValueSettings(id, { [StorageKeys.FORMULA_COPY_SELECTION_LATEX]: stored })
            .selectionLatex,
        ).toBe(on);
      }
    }
  });

  it('writes the shared keys in the shape the old panel stored, the same from either site', () => {
    for (const id of FORMULA_IDS) {
      expect(legacyValueWrite(id, 'format', 'notion')).toEqual({
        [StorageKeys.FORMULA_COPY_FORMAT]: 'notion',
      });
      expect(legacyValueWrite(id, 'selectionLatex', false)).toEqual({
        [StorageKeys.FORMULA_COPY_SELECTION_LATEX]: false,
      });
    }
  });

  it('keeps the last format when a live change is not one, as the service did', () => {
    expect(acceptsLegacyLiveChange(StorageKeys.FORMULA_COPY_FORMAT, 'unicodemath')).toBe(true);
    expect(acceptsLegacyLiveChange(StorageKeys.FORMULA_COPY_FORMAT, 'mathml')).toBe(false);
    expect(acceptsLegacyLiveChange(StorageKeys.FORMULA_COPY_FORMAT, undefined)).toBe(false);
    expect(acceptsLegacyLiveChange(StorageKeys.FORMULA_COPY_SELECTION_LATEX, undefined)).toBe(true);
  });

  it('declares both options once in each manifest, localized everywhere', async () => {
    await expectDeclaredOnceAndLocalized(FORMULA_IDS);
  });
});
