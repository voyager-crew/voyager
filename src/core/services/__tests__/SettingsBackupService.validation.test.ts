import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import {
  BACKUPABLE_SYNC_SETTINGS_DEFAULTS,
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

describe('stored-only settings and safe restore', () => {
  it('exports exactly the stored backupable keys, leaving absent flags and defaults absent', async () => {
    const state: Record<string, unknown> = {
      [StorageKeys.CHAT_WIDTH]: 85,
      [StorageKeys.CHAT_FONT_SIZE]: 100,
      [StorageKeys.FOLDER_ENABLED]: false,
      [StorageKeys.GV_SNOW_EFFECT]: true,
      [StorageKeys.PROMPT_THEME]: null,
      [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED]: true,
      [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI]: false,
      [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_AISTUDIO]: true,
      [StorageKeys.PLUGINS_STATE]: { entries: { unrelated: { enabled: true } } },
      unknownKey: 'keep locally',
    };
    const before = structuredClone(state);

    const payload = await exportBackupableSyncSettings(storageWith(state));

    expect(payload.data).toEqual({
      [StorageKeys.CHAT_WIDTH]: 85,
      [StorageKeys.CHAT_FONT_SIZE]: 100,
      [StorageKeys.FOLDER_ENABLED]: false,
      [StorageKeys.GV_SNOW_EFFECT]: true,
      [StorageKeys.PROMPT_THEME]: null,
    });
    expect(state).toEqual(before);
    expect((await exportBackupableSyncSettings(storageWith({}))).data).toEqual({});
  });

  it.each(['merge', 'overwrite'] as const)(
    '%s skips all nulls before retired-switch normalization and leaves saved choices intact',
    async (mode) => {
      const state: Record<string, unknown> = {
        [StorageKeys.CHAT_WIDTH]: 91,
        [StorageKeys.LANGUAGE]: 'fr',
        [StorageKeys.WATERMARK_DOWNLOAD_ENABLED]: true,
        [StorageKeys.TAB_TITLE_UPDATE_ENABLED]: true,
        [StorageKeys.COACHMARKS_SEEN]: ['kept'],
        [StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN]: true,
      };
      const before = structuredClone(state);
      const nulls = Object.fromEntries(
        Object.keys(BACKUPABLE_SYNC_SETTINGS_DEFAULTS).map((key) => [key, null]),
      );

      const applied = await restoreBackupableSyncSettings(nulls, storageWith(state), mode);

      expect(applied).toEqual({});
      expect(state).toEqual(before);
    },
  );

  it.each(['merge', 'overwrite'] as const)(
    '%s rejects wrong primitive and container types while applying valid values',
    async (mode) => {
      const before = {
        [StorageKeys.CHAT_WIDTH]: 91,
        [StorageKeys.FOLDER_ENABLED]: true,
        [StorageKeys.PROMPT_VIEW_MODE]: 'compact',
        [StorageKeys.COACHMARKS_SEEN]: ['kept'],
        [StorageKeys.EXPORT_SPEAKER_LABELS]: { user: 'Me' },
        [StorageKeys.TIMELINE_SHORTCUTS]: { enabled: false, shortcuts: {} },
        [StorageKeys.LANGUAGE]: 'zh',
        [StorageKeys.WATERMARK_DOWNLOAD_ENABLED]: true,
        [StorageKeys.TAB_TITLE_UPDATE_ENABLED]: true,
        unknownKey: 'local',
      };
      const state = structuredClone(before);
      const valid = {
        [StorageKeys.CHAT_FONT_SIZE]: 115,
        [StorageKeys.FORMULA_COPY_ENABLED]: false,
        [StorageKeys.GV_GEMS_PINNED]: ['gem'],
        [StorageKeys.ACCENT_COLORS]: { dark: '#aabbcc' },
      };

      await restoreBackupableSyncSettings(
        {
          ...valid,
          [StorageKeys.CHAT_WIDTH]: '85',
          [StorageKeys.FOLDER_ENABLED]: 0,
          [StorageKeys.PROMPT_VIEW_MODE]: false,
          [StorageKeys.COACHMARKS_SEEN]: {},
          [StorageKeys.EXPORT_SPEAKER_LABELS]: [],
          [StorageKeys.TIMELINE_SHORTCUTS]: [],
          [StorageKeys.LANGUAGE]: [],
          [StorageKeys.WATERMARK_DOWNLOAD_ENABLED]: 'false',
          [StorageKeys.TAB_TITLE_UPDATE_ENABLED]: 'true',
          unknownKey: 'cloud',
        },
        storageWith(state),
        mode,
      );

      expect(state).toEqual({ ...before, ...valid });
    },
  );

  const nullableValues = [
    [StorageKeys.TIMELINE_BAR_WIDTH, 24, ['24', false, {}, []]],
    [
      StorageKeys.TIMELINE_POSITION,
      { version: 2, topPercent: 10, leftPercent: 90 },
      [24, 'position', false, []],
    ],
    [StorageKeys.PROMPT_THEME, 'dark', [false, 1, {}, []]],
    [StorageKeys.LANGUAGE, 'en', [false, 1, {}, []]],
    [StorageKeys.WATERMARK_REMOVER_ENABLED, true, ['true', 1, {}, []]],
    [StorageKeys.WATERMARK_DOWNLOAD_ENABLED, false, ['false', 0, {}, []]],
    [StorageKeys.WATERMARK_PREVIEW_ENABLED, true, ['true', 1, {}, []]],
    [StorageKeys.DEFAULT_MODEL, { id: 'model-id', name: 'Pro' }, [true, 1, []]],
    [
      StorageKeys.DEFAULT_THINKING_LEVEL,
      { index: 1, label: 'Extended', mode: 'extended' },
      ['extended', 1, false, []],
    ],
    [StorageKeys.GV_POPUP_SECTION_ORDER, ['appearance', 'folders'], ['folders', 1, false, {}]],
  ] as const;

  it.each(nullableValues)(
    '%s uses an explicit type despite its null default',
    async (key, valid, invalid) => {
      for (const mode of ['merge', 'overwrite'] as const) {
        const fresh: Record<string, unknown> = {};
        await restoreBackupableSyncSettings({ [key]: valid }, storageWith(fresh), mode);
        expect(fresh).toEqual({ [key]: valid });

        for (const value of [null, undefined, ...invalid]) {
          const state: Record<string, unknown> = { [key]: valid };
          await restoreBackupableSyncSettings(
            { [key]: value, [StorageKeys.CHAT_FONT_SIZE]: 120 },
            storageWith(state),
            mode,
          );
          expect(state).toEqual({ [key]: valid, [StorageKeys.CHAT_FONT_SIZE]: 120 });
        }
      }
    },
  );

  it('also restores a legacy name-only default model', async () => {
    const state: Record<string, unknown> = {};
    await restoreBackupableSyncSettings({ [StorageKeys.DEFAULT_MODEL]: 'Pro' }, storageWith(state));
    expect(state).toEqual({ [StorageKeys.DEFAULT_MODEL]: 'Pro' });
  });

  it.each(['merge', 'overwrite'] as const)(
    '%s skips malformed panel shortcut fields without replacing local shortcuts',
    async (mode) => {
      const saved = {
        enabled: false,
        shortcuts: { next: { action: 'timeline:next', modifiers: [], key: 'n' } },
      };
      for (const panelToggle of [
        null,
        [],
        { modifiers: 'Alt' },
        { modifiers: ['AltGraph'] },
        { key: 42 },
        { code: 42 },
        { code: '' },
        { sequenceLength: 0 },
        { sequenceLength: 1.5 },
      ]) {
        const state: Record<string, unknown> = { [StorageKeys.TIMELINE_SHORTCUTS]: saved };
        await restoreBackupableSyncSettings(
          {
            [StorageKeys.TIMELINE_SHORTCUTS]: {
              enabled: true,
              shortcuts: { panelToggle },
            },
            [StorageKeys.CHAT_FONT_SIZE]: 120,
          },
          storageWith(state),
          mode,
        );
        expect(state).toEqual({
          [StorageKeys.TIMELINE_SHORTCUTS]: saved,
          [StorageKeys.CHAT_FONT_SIZE]: 120,
        });
      }
    },
  );

  it.each(['merge', 'overwrite'] as const)(
    '%s restores an opted-in vv shortcut without adding defaults or dropping extra nested data',
    async (mode) => {
      const shortcuts = {
        enabled: false,
        shortcuts: {
          previous: { action: 'timeline:previous', modifiers: [], key: 'p' },
          panelToggle: { action: 'panel:toggle', modifiers: [], key: 'v', sequenceLength: 2 },
          futureAction: { key: 'leave intact' },
        },
        futureChoice: 'leave intact',
      };
      const source = { [StorageKeys.TIMELINE_SHORTCUTS]: shortcuts };
      const payload = await exportBackupableSyncSettings(storageWith(source));
      const restored: Record<string, unknown> = { unrelated: 'local data' };
      await restoreBackupableSyncSettings(
        JSON.parse(JSON.stringify(payload.data)),
        storageWith(restored),
        mode,
      );
      expect(payload.data).toEqual(source);
      expect(restored).toEqual({ ...source, unrelated: 'local data' });
    },
  );

  it.each(['merge', 'overwrite'] as const)(
    '%s ignores every old account isolation value without removing or migrating stored keys',
    async (mode) => {
      for (const cloudChoice of [true, false, null]) {
        const state: Record<string, unknown> = {
          [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED]: false,
          [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI]: true,
          [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_AISTUDIO]: false,
        };
        const before = structuredClone(state);
        await restoreBackupableSyncSettings(
          {
            [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED]: cloudChoice,
            [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI]: cloudChoice,
            [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_AISTUDIO]: cloudChoice,
            [StorageKeys.CHAT_WIDTH]: 80,
          },
          storageWith(state),
          mode,
        );
        expect(state).toEqual({ ...before, [StorageKeys.CHAT_WIDTH]: 80 });
      }
    },
  );
});
