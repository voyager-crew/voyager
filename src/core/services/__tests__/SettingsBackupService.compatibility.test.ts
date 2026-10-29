import { execFileSync } from 'node:child_process';
import { Script } from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { DEFAULT_HIGHLIGHT_COLOR_PALETTE } from '@/core/types/highlight';
import { resolveVisualEffect } from '@/core/utils/visualEffectValues';
import { WATERMARK_STORAGE_KEYS } from '@/core/utils/watermarkSettings';
import {
  LEGACY_ENABLE_BINDINGS,
  resolveEffectiveEnabled,
} from '@/features/plugins/storage/legacySettingBindings';

import { GoogleDriveBackupFolder } from '../GoogleDriveBackupFolder';
import { GoogleDriveFiles } from '../GoogleDriveFiles';
import { GoogleDriveUploadFiles } from '../GoogleDriveUploadFiles';
import {
  exportBackupableSyncSettings,
  restoreBackupableSyncSettings,
} from '../SettingsBackupService';
import { FakeSyncDrive } from './fixtures/fakeSyncDrive';

vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'chrome',
  isSafari: () => false,
  isBrave: () => false,
}));
afterEach(() => vi.unstubAllGlobals());

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

// Execute the tagged reader/writer, defaults and policies, never a copied reconstruction.
function releasedModule(path: string, imports: Record<string, unknown>): unknown {
  const source = execFileSync('git', ['show', `v2.2.1:src/core/services/${path}.ts`], {
    encoding: 'utf8',
  });
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Script(outputText, { filename: `v2.2.1:${path}.ts` }).runInNewContext({
    module,
    exports: module.exports,
    require: (id: string) => {
      if (!Object.hasOwn(imports, id)) throw new Error(`Unprovided release dependency: ${id}`);
      return imports[id];
    },
  });
  return module.exports;
}

const releasedDefaults = releasedModule('settingsBackupDefaults', {
  '@/core/types/common': { StorageKeys },
  '@/core/types/highlight': { DEFAULT_HIGHLIGHT_COLOR_PALETTE },
}) as typeof import('../settingsBackupDefaults');
const releasedPolicies = releasedModule('settingsBackupPolicies', {
  '@/core/types/common': { StorageKeys },
});
const released = releasedModule('SettingsBackupService', {
  '@/core/types/common': { StorageKeys },
  '@/core/utils/version': { EXTENSION_VERSION: '2.2.1' },
  '@/core/utils/watermarkSettings': { WATERMARK_STORAGE_KEYS },
  '@/features/plugins/storage/legacySettingBindings': { LEGACY_ENABLE_BINDINGS },
  './settingsBackupDefaults': releasedDefaults,
  './settingsBackupPolicies': releasedPolicies,
}) as typeof import('../SettingsBackupService');

describe('v2.2.1 settings file compatibility', () => {
  it('restores the actual released full-default export as the previous Drive version', async () => {
    const source = 'gemini-voyager-settings.json';
    const previous = await released.exportBackupableSyncSettings(
      storageWith({
        [StorageKeys.CHAT_FONT_SIZE]: 120,
        [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI]: true,
      }),
    );
    const drive = new FakeSyncDrive();
    drive.put(source, previous);
    const original = drive.files.get(source);
    vi.stubGlobal('fetch', drive.fetch);
    const files = new GoogleDriveFiles(new GoogleDriveBackupFolder([source]), {
      getProvider: () => 'googleDrive',
      onAuthLost: () => {},
    });
    await new GoogleDriveUploadFiles(files).write(
      'token',
      source,
      await exportBackupableSyncSettings(storageWith({ [StorageKeys.CHAT_FONT_SIZE]: 150 })),
    );
    await expect(
      new GoogleDriveUploadFiles(files).restoreHistory('token', [source]),
    ).resolves.toMatchObject([{ name: source, status: 'restored' }]);
    expect(drive.files.get(source)).toBe(original);
  });

  it.each(['merge', 'overwrite'] as const)(
    'restores this build’s sparse file with the real released %s reader',
    async (mode) => {
      const source = {
        [StorageKeys.CHAT_WIDTH]: 85,
        [StorageKeys.EDIT_INPUT_WIDTH]: 85,
        [StorageKeys.SIDEBAR_WIDTH]: 390,
        [StorageKeys.FOLDER_ENABLED]: false,
        [StorageKeys.GV_SNOW_EFFECT]: true,
        [StorageKeys.COACHMARKS_SEEN]: ['shared', 'cloud'],
        [StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN]: false,
        [StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN_AISTUDIO]: true,
        [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED]: false,
        [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI]: false,
        [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_AISTUDIO]: false,
      };
      const payload = await exportBackupableSyncSettings(storageWith(source));
      const data: unknown = JSON.parse(JSON.stringify(payload.data));
      expect(payload.format).toBe('gemini-voyager.settings.v1');
      expect(payload.data).toEqual({
        [StorageKeys.CHAT_WIDTH]: 85,
        [StorageKeys.EDIT_INPUT_WIDTH]: 85,
        [StorageKeys.SIDEBAR_WIDTH]: 390,
        [StorageKeys.FOLDER_ENABLED]: false,
        [StorageKeys.GV_SNOW_EFFECT]: true,
        [StorageKeys.COACHMARKS_SEEN]: ['shared', 'cloud'],
        [StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN]: false,
        [StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN_AISTUDIO]: true,
      });
      const before = {
        [StorageKeys.CHAT_FONT_SIZE]: 125,
        [StorageKeys.COACHMARKS_SEEN]: ['local', 'shared'],
        [StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN]: true,
        [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED]: true,
        [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI]: true,
        [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_AISTUDIO]: true,
      };
      const restored: Record<string, unknown> = { ...before };

      await released.restoreBackupableSyncSettings(data, storageWith(restored), mode);

      expect(restored).toEqual({
        ...before,
        [StorageKeys.CHAT_WIDTH]: 85,
        [StorageKeys.EDIT_INPUT_WIDTH]: 85,
        [StorageKeys.SIDEBAR_WIDTH]: 390,
        [StorageKeys.FOLDER_ENABLED]: false,
        [StorageKeys.GV_SNOW_EFFECT]: true,
        [StorageKeys.COACHMARKS_SEEN]:
          mode === 'merge' ? ['local', 'shared', 'cloud'] : ['shared', 'cloud'],
        [StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN]: mode === 'merge',
        [StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN_AISTUDIO]: true,
      });
      expect(resolveEffectiveEnabled({}, restored, 'voyager.gemini-chat-width')).toBe(true);
      expect(resolveEffectiveEnabled({}, restored, 'voyager.gemini-edit-input-width')).toBe(true);
      expect(resolveEffectiveEnabled({}, restored, 'voyager.gemini-sidebar-width')).toBe(true);
      expect(resolveEffectiveEnabled({}, restored, 'voyager.aistudio-sidebar-width')).toBe(false);
      expect(
        resolveVisualEffect(
          restored[StorageKeys.GV_VISUAL_EFFECT],
          restored[StorageKeys.GV_SNOW_EFFECT],
        ),
      ).toBe('snow');
    },
  );

  it.each(['merge', 'overwrite'] as const)(
    'restores the real released full-default file here in %s mode without clearing null or isolation choices',
    async (mode) => {
      const payload = await released.exportBackupableSyncSettings(
        storageWith({
          [StorageKeys.CHAT_FONT_SIZE]: 120,
          [StorageKeys.COACHMARKS_SEEN]: ['cloud', 'shared'],
          [StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN_AISTUDIO]: true,
          [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED]: true,
          [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI]: true,
          [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_AISTUDIO]: true,
        }),
      );
      const data: unknown = JSON.parse(JSON.stringify(payload.data));
      expect(payload.version).toBe('2.2.1');
      expect(Object.keys(payload.data).sort()).toEqual(
        Object.keys(releasedDefaults.BACKUPABLE_SYNC_SETTINGS_DEFAULTS).sort(),
      );
      expect(payload.data[StorageKeys.LANGUAGE]).toBeNull();
      expect(payload.data[StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI]).toBe(true);

      const before = {
        [StorageKeys.LANGUAGE]: 'fr',
        [StorageKeys.TIMELINE_BAR_WIDTH]: 24,
        [StorageKeys.TIMELINE_POSITION]: { version: 2, topPercent: 20, leftPercent: 80 },
        [StorageKeys.PROMPT_THEME]: 'dark',
        [StorageKeys.WATERMARK_REMOVER_ENABLED]: true,
        [StorageKeys.WATERMARK_DOWNLOAD_ENABLED]: true,
        [StorageKeys.WATERMARK_PREVIEW_ENABLED]: false,
        [StorageKeys.DEFAULT_MODEL]: { id: 'kept-id', name: 'Pro' },
        [StorageKeys.DEFAULT_THINKING_LEVEL]: { index: 1, label: 'Extended' },
        [StorageKeys.GV_POPUP_SECTION_ORDER]: ['folders', 'appearance'],
        [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED]: false,
        [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI]: false,
        [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_AISTUDIO]: false,
        [StorageKeys.PROMPT_PANEL_LOCKED]: true,
        [StorageKeys.COACHMARKS_SEEN]: ['local', 'shared'],
        [StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN]: true,
        unknownKey: 'local data',
      };
      const restored: Record<string, unknown> = structuredClone(before);
      await restoreBackupableSyncSettings(data, storageWith(restored), mode);

      // The old default table is the input fixture; only its non-null, still-backed-up values apply.
      const excluded = new Set<string>([
        StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED,
        StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI,
        StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_AISTUDIO,
        StorageKeys.PROMPT_PANEL_LOCKED,
        StorageKeys.PROMPT_PANEL_POSITION,
        StorageKeys.PROMPT_TRIGGER_POSITION,
      ]);
      const nonNullDefaults = Object.fromEntries(
        Object.entries(releasedDefaults.BACKUPABLE_SYNC_SETTINGS_DEFAULTS).filter(
          ([key, value]) => value !== null && !excluded.has(key),
        ),
      );
      expect(restored).toEqual({
        ...before,
        ...nonNullDefaults,
        [StorageKeys.CHAT_FONT_SIZE]: 120,
        [StorageKeys.COACHMARKS_SEEN]:
          mode === 'merge' ? ['local', 'shared', 'cloud'] : ['cloud', 'shared'],
        [StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN]: mode === 'merge',
        [StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN_AISTUDIO]: true,
      });
    },
  );
});
