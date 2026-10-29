import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import * as browser from '@/core/utils/browser';
import { resolveVisualEffect } from '@/core/utils/visualEffectValues';
import {
  LEGACY_ENABLE_BINDINGS,
  resolveEffectiveEnabled,
} from '@/features/plugins/storage/legacySettingBindings';

import {
  exportBackupableSyncSettings,
  restoreBackupableSyncSettings,
} from '../SettingsBackupService';

function storageWith(state: Record<string, unknown>) {
  return {
    get: vi.fn().mockImplementation(async (keys: string[] | Record<string, unknown>) => {
      const result: Record<string, unknown> = Array.isArray(keys) ? {} : { ...keys };
      for (const key of Array.isArray(keys) ? keys : Object.keys(keys)) {
        if (Object.hasOwn(state, key)) result[key] = state[key];
      }
      return result;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(state, items);
    }),
  };
}

describe('settings backups preserve derived switches', () => {
  it('does not enable the AI Studio width and handle after exporting with folders off', async () => {
    for (const folders of [false, true, undefined]) {
      for (const enabled of [undefined, false, true]) {
        const state: Record<string, unknown> = {};
        if (folders !== undefined) state[StorageKeys.FOLDER_ENABLED] = folders;
        if (enabled !== undefined) state[StorageKeys.AISTUDIO_SIDEBAR_WIDTH_ENABLED] = enabled;
        const area = storageWith(state);
        const { data } = await exportBackupableSyncSettings(area);

        expect(data).toEqual(state);
        const restored: Record<string, unknown> = {};
        await restoreBackupableSyncSettings(data, storageWith(restored));
        expect(restored).toEqual(state);
        expect(resolveEffectiveEnabled({}, restored, 'voyager.aistudio-sidebar-width')).toBe(
          enabled ?? folders !== false,
        );
      }
    }
  });

  it.each([
    [StorageKeys.CHAT_WIDTH_ENABLED, StorageKeys.CHAT_WIDTH, 70, 85],
    [StorageKeys.EDIT_INPUT_WIDTH_ENABLED, StorageKeys.EDIT_INPUT_WIDTH, 60, 85],
    [StorageKeys.SIDEBAR_WIDTH_ENABLED, StorageKeys.SIDEBAR_WIDTH, 312, 390],
  ] as const)(
    'does not turn off a customized width when %s has never been saved',
    async (key, widthKey, defaultWidth, customWidth) => {
      for (const width of [customWidth, defaultWidth, undefined]) {
        for (const enabled of [undefined, false, true]) {
          const state: Record<string, unknown> = {};
          if (width !== undefined) state[widthKey] = width;
          if (enabled !== undefined) state[key] = enabled;
          const area = storageWith(state);
          const { data } = await exportBackupableSyncSettings(area);

          expect(data).toEqual(state);
          const restored: Record<string, unknown> = {};
          await restoreBackupableSyncSettings(data, storageWith(restored));
          expect(restored).toEqual(state);
          const bound = Object.values(LEGACY_ENABLE_BINDINGS).find((entry) => entry.key === key)!;
          expect(resolveEffectiveEnabled({}, restored, bound.pluginId)).toBe(
            enabled ?? width === customWidth,
          );
        }
      }
    },
  );

  it('keeps batch delete following folders after a backup made with folders off', async () => {
    const source: Record<string, unknown> = { [StorageKeys.FOLDER_ENABLED]: false };
    const { data } = await exportBackupableSyncSettings(storageWith(source));
    const restored: Record<string, unknown> = {};
    await restoreBackupableSyncSettings(data, storageWith(restored), 'overwrite');
    restored[StorageKeys.FOLDER_ENABLED] = true;
    const binding = LEGACY_ENABLE_BINDINGS['voyager.gemini-batch-delete'];

    expect(binding.derive!(restored, () => false)).toBe(true);
  });

  it('does not turn off legacy snow or replace a saved effect when exporting settings', async () => {
    for (const effect of [
      undefined,
      'off',
      'snow',
      'sakura',
      'rain',
      'unknown',
      null,
      false,
      true,
    ]) {
      for (const snow of [false, true]) {
        const state: Record<string, unknown> = { [StorageKeys.GV_SNOW_EFFECT]: snow };
        if (effect !== undefined) state[StorageKeys.GV_VISUAL_EFFECT] = effect;
        const { data } = await exportBackupableSyncSettings(storageWith(state));

        expect.soft(data[StorageKeys.GV_VISUAL_EFFECT]).toBe(effect);
        expect(data[StorageKeys.GV_SNOW_EFFECT]).toBe(snow);
        expect
          .soft(
            resolveVisualEffect(
              data[StorageKeys.GV_VISUAL_EFFECT],
              data[StorageKeys.GV_SNOW_EFFECT],
            ),
          )
          .toBe(resolveVisualEffect(effect, snow));
      }
    }
  });

  it('does not change any derived feature state after a settings export and restore', async () => {
    const variants = (key: string, values: readonly unknown[]): Record<string, unknown>[] =>
      values.map((value) => (value === undefined ? {} : { [key]: value }));
    const watermarkInputs = (sibling: string) =>
      variants(StorageKeys.WATERMARK_REMOVER_ENABLED, [undefined, false, true]).flatMap((legacy) =>
        variants(sibling, [undefined, false, true]).map((split) => ({
          ...legacy,
          ...split,
        })),
      );
    const inputs: Record<string, Record<string, unknown>[]> = {
      [StorageKeys.AISTUDIO_SIDEBAR_WIDTH_ENABLED]: variants(StorageKeys.FOLDER_ENABLED, [
        undefined,
        false,
        true,
      ]),
      [StorageKeys.BATCH_DELETE_ENABLED]: variants(StorageKeys.FOLDER_ENABLED, [
        undefined,
        false,
        true,
      ]),
      [StorageKeys.CHAT_WIDTH_ENABLED]: variants(StorageKeys.CHAT_WIDTH, [
        undefined,
        70,
        85,
        840,
        960,
      ]),
      [StorageKeys.EDIT_INPUT_WIDTH_ENABLED]: variants(StorageKeys.EDIT_INPUT_WIDTH, [
        undefined,
        60,
        85,
        720,
        960,
      ]),
      [StorageKeys.SIDEBAR_WIDTH_ENABLED]: variants(StorageKeys.SIDEBAR_WIDTH, [
        undefined,
        312,
        390,
        26,
      ]),
      [StorageKeys.GV_VISUAL_EFFECT]: variants(StorageKeys.GV_SNOW_EFFECT, [
        undefined,
        false,
        true,
      ]),
      [StorageKeys.SAFARI_ENTER_FIX]: [{}],
      [StorageKeys.WATERMARK_DOWNLOAD_ENABLED]: watermarkInputs(
        StorageKeys.WATERMARK_PREVIEW_ENABLED,
      ),
      [StorageKeys.WATERMARK_PREVIEW_ENABLED]: watermarkInputs(
        StorageKeys.WATERMARK_DOWNLOAD_ENABLED,
      ),
    };
    const derivedBindings = Object.values(LEGACY_ENABLE_BINDINGS).filter((entry) => entry.derive);
    const safari = vi.spyOn(browser, 'isSafari');
    try {
      for (const isSafari of [false, true]) {
        safari.mockReturnValue(isSafari);
        for (const mode of ['merge', 'overwrite'] as const) {
          for (const bound of derivedBindings) {
            expect(inputs[bound.key], `inputs for ${bound.pluginId}`).toBeDefined();
            for (const input of inputs[bound.key]) {
              const storedValues =
                bound.key === StorageKeys.GV_VISUAL_EFFECT
                  ? [undefined, 'off', 'snow', 'sakura', 'rain']
                  : [undefined, false, true];
              for (const stored of storedValues) {
                const source = {
                  ...input,
                  ...(stored === undefined ? {} : { [bound.key]: stored }),
                };
                const before = resolveEffectiveEnabled({}, source, bound.pluginId);
                const area = storageWith(source);
                const { data } = await exportBackupableSyncSettings(area);
                expect(data).toEqual(source);

                const restored: Record<string, unknown> = {};
                await restoreBackupableSyncSettings(
                  JSON.parse(JSON.stringify(data)),
                  storageWith(restored),
                  mode,
                );
                expect(restored).toEqual(source);
                expect
                  .soft(
                    resolveEffectiveEnabled(
                      { [bound.pluginId]: { enabled: !before } },
                      restored,
                      bound.pluginId,
                    ),
                    `${bound.pluginId}, ${mode}, Safari=${isSafari}, source=${JSON.stringify(source)}`,
                  )
                  .toBe(before);
              }
            }
          }
        }
      }
    } finally {
      safari.mockRestore();
    }
  });
});
