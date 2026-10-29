import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { resolveWatermarkSettings } from '@/core/utils/watermarkSettings';

import {
  BACKUPABLE_SYNC_SETTINGS_DEFAULTS,
  BACKUPABLE_SYNC_SETTINGS_KEYS,
  NON_SETTINGS_BACKUP_POLICIES,
  exportBackupableSyncSettings,
  restoreBackupableSyncSettings,
} from '../SettingsBackupService';

describe('SettingsBackupService', () => {
  it('classifies every centralized storage key exactly once', () => {
    const settingsKeys = new Set(BACKUPABLE_SYNC_SETTINGS_KEYS);
    const excludedKeys = new Set(Object.keys(NON_SETTINGS_BACKUP_POLICIES));
    const allKeys = Object.values(StorageKeys);

    expect(allKeys.filter((key) => settingsKeys.has(key) && excludedKeys.has(key))).toEqual([]);
    expect(new Set([...settingsKeys, ...excludedKeys])).toEqual(new Set(allKeys));
  });

  it('backs up recently added user preferences and onboarding state', () => {
    expect(BACKUPABLE_SYNC_SETTINGS_DEFAULTS).toEqual(
      expect.objectContaining({
        [StorageKeys.FOLDER_CONVERSATION_SORT_MODE]: 'manual',
        [StorageKeys.GV_FOLDER_ITEM_FONT_SIZE]: 13,
        [StorageKeys.TIMELINE_STYLE]: 'dots',
        [StorageKeys.DEFAULT_THINKING_LEVEL]: null,
        [StorageKeys.COACHMARKS_SEEN]: [],
        [StorageKeys.EXPORT_IMAGE_WIDTH]: 620,
        [StorageKeys.SLASH_PROMPT_ENABLED]: true,
        [StorageKeys.FORMULA_COPY_ENABLED]: true,
        [StorageKeys.EXPORT_SPEAKER_LABELS]: {},
      }),
    );
    expect(BACKUPABLE_SYNC_SETTINGS_DEFAULTS).not.toHaveProperty(StorageKeys.PLUGINS_STATE);
    expect(NON_SETTINGS_BACKUP_POLICIES[StorageKeys.PLUGINS_STATE].disposition).toBe(
      'separate-file',
    );
  });

  it('restores the batch delete choice without changing folder availability or filling older backups', async () => {
    expect(BACKUPABLE_SYNC_SETTINGS_DEFAULTS[StorageKeys.BATCH_DELETE_ENABLED]).toBe(true);
    const set = vi.fn().mockResolvedValue(undefined);
    const storage = { get: vi.fn().mockResolvedValue({}), set };
    await restoreBackupableSyncSettings({ [StorageKeys.FOLDER_ENABLED]: false }, storage);
    expect(set).toHaveBeenLastCalledWith({ [StorageKeys.FOLDER_ENABLED]: false });
    await restoreBackupableSyncSettings({ [StorageKeys.BATCH_DELETE_ENABLED]: false }, storage);
    expect(set).toHaveBeenLastCalledWith({ [StorageKeys.BATCH_DELETE_ENABLED]: false });
  });

  it('backs up AI Studio sidebar enable state independently and preserves it with older backups', async () => {
    expect(BACKUPABLE_SYNC_SETTINGS_DEFAULTS[StorageKeys.AISTUDIO_SIDEBAR_WIDTH_ENABLED]).toBe(
      true,
    );
    const set = vi.fn().mockResolvedValue(undefined);
    const storage = { get: vi.fn().mockResolvedValue({}), set };
    await restoreBackupableSyncSettings({ [StorageKeys.AISTUDIO_SIDEBAR_WIDTH]: 420 }, storage);
    expect(set).toHaveBeenLastCalledWith({ [StorageKeys.AISTUDIO_SIDEBAR_WIDTH]: 420 });
    await restoreBackupableSyncSettings(
      {
        [StorageKeys.AISTUDIO_SIDEBAR_WIDTH_ENABLED]: false,
        [StorageKeys.SIDEBAR_WIDTH_ENABLED]: true,
      },
      storage,
    );
    expect(set).toHaveBeenLastCalledWith({
      [StorageKeys.AISTUDIO_SIDEBAR_WIDTH_ENABLED]: false,
      [StorageKeys.SIDEBAR_WIDTH_ENABLED]: true,
    });
  });

  it('keeps ChatGPT folder content in its local separate file and outside settings restore', async () => {
    const folderData = { folders: [], folderContents: {} };
    const settingsStorage = {
      get: vi.fn().mockResolvedValue({
        ...BACKUPABLE_SYNC_SETTINGS_DEFAULTS,
        [StorageKeys.FOLDER_DATA_CHATGPT]: folderData,
      }),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const exported = await exportBackupableSyncSettings(settingsStorage);
    expect(exported.data).not.toHaveProperty(StorageKeys.FOLDER_DATA_CHATGPT);
    expect(NON_SETTINGS_BACKUP_POLICIES[StorageKeys.FOLDER_DATA_CHATGPT]).toMatchObject({
      storage: 'local',
      disposition: 'separate-file',
    });
    await expect(
      restoreBackupableSyncSettings(
        {
          [StorageKeys.FOLDER_DATA_CHATGPT]: folderData,
        },
        settingsStorage,
      ),
    ).resolves.toEqual({});
    expect(settingsStorage.set).not.toHaveBeenCalled();
  });

  it.each(['merge', 'overwrite'] as const)(
    'keeps both star projections local and outside %s settings export and restore',
    async (mode) => {
      const stars = { messages: { chat: [{ turnId: 'kept' }] } };
      const area = {
        get: vi.fn().mockResolvedValue({
          ...BACKUPABLE_SYNC_SETTINGS_DEFAULTS,
          [StorageKeys.SAVED_LIBRARY_STARS]: stars,
          [StorageKeys.TIMELINE_STARRED_MESSAGES]: stars,
        }),
        set: vi.fn().mockResolvedValue(undefined),
      };
      const exported = await exportBackupableSyncSettings(area);
      for (const key of [StorageKeys.SAVED_LIBRARY_STARS, StorageKeys.TIMELINE_STARRED_MESSAGES]) {
        expect(exported.data).not.toHaveProperty(key);
        expect(NON_SETTINGS_BACKUP_POLICIES[key]).toMatchObject({
          storage: 'local',
          disposition: 'separate-file',
        });
      }
      await expect(
        restoreBackupableSyncSettings(
          {
            [StorageKeys.SAVED_LIBRARY_STARS]: stars,
            [StorageKeys.TIMELINE_STARRED_MESSAGES]: stars,
          },
          area,
          mode,
        ),
      ).resolves.toEqual({});
      expect(area.set).not.toHaveBeenCalled();
    },
  );

  it.each(['merge', 'overwrite'] as const)(
    'settings %s restore cannot erase star deletion records',
    async (mode) => {
      const key = StorageKeys.SAVED_LIBRARY_STAR_TOMBSTONES;
      const scopedKey = `${key}:acct:account`;
      const tombstones = [
        {
          conversationId: 'chat',
          turnId: 'removed',
          conversationUrl: '/app/chat',
          starredAt: 1,
          deletedAt: 2,
        },
      ];
      const state: Record<string, unknown> = { [key]: tombstones, [scopedKey]: tombstones };
      const area = {
        get: vi.fn().mockImplementation(async (defaults: Record<string, unknown>) => ({
          ...defaults,
          ...state,
        })),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(state, items);
        }),
      };
      const exported = await exportBackupableSyncSettings(area);
      expect(exported.data).not.toHaveProperty(key);
      expect(exported.data).not.toHaveProperty(scopedKey);

      await restoreBackupableSyncSettings(
        { [key]: [], [scopedKey]: [], [StorageKeys.CHAT_WIDTH]: 92 },
        area,
        mode,
      );

      expect(state[key]).toEqual(tombstones);
      expect(state[scopedKey]).toEqual(tombstones);
      expect(state[StorageKeys.CHAT_WIDTH]).toBe(92);
    },
  );

  it('keeps popup scroll position device-local and outside settings backup', () => {
    const popupScrollKey = 'gvPopupScrollTop';

    expect(BACKUPABLE_SYNC_SETTINGS_DEFAULTS).not.toHaveProperty(popupScrollKey);
    expect(NON_SETTINGS_BACKUP_POLICIES).toHaveProperty(popupScrollKey, {
      storage: 'local',
      disposition: 'device-local',
      reason: 'Popup scroll position is specific to this device and viewport.',
    });
  });

  it('keeps the dragged export button spot on this device, out of a settings export', async () => {
    const key = StorageKeys.PERSISTENT_EXPORT_TOOLBAR_POSITION;
    const storageArea = {
      get: vi.fn().mockResolvedValue({ [key]: { claude: { right: 400, top: 300 } } }),
      set: vi.fn(),
    };

    const payload = await exportBackupableSyncSettings(storageArea);

    expect(payload.data).not.toHaveProperty(key);
    expect(NON_SETTINGS_BACKUP_POLICIES[key]).toMatchObject({
      storage: 'local',
      disposition: 'device-local',
    });
  });

  it('keeps the popup settings search query device-local', () => {
    expect(BACKUPABLE_SYNC_SETTINGS_DEFAULTS).not.toHaveProperty(
      StorageKeys.GV_POPUP_SETTINGS_SEARCH_QUERY,
    );
    expect(NON_SETTINGS_BACKUP_POLICIES[StorageKeys.GV_POPUP_SETTINGS_SEARCH_QUERY]).toEqual({
      storage: 'local',
      disposition: 'device-local',
      reason: 'Popup settings search query is device-local UI state.',
    });
  });

  it('exports stored settings, including a stored default value, without filling missing keys', async () => {
    const storageArea = {
      get: vi.fn().mockResolvedValue({
        [StorageKeys.CHAT_WIDTH]: 88,
        [StorageKeys.CHAT_FONT_SIZE]: 100,
        unknownKey: 'ignore-me',
      }),
      set: vi.fn(),
    };

    const payload = await exportBackupableSyncSettings(storageArea);

    expect(storageArea.get).toHaveBeenCalledTimes(1);
    expect(payload).toEqual({
      format: 'gemini-voyager.settings.v1',
      exportedAt: expect.any(String),
      version: expect.any(String),
      data: {
        [StorageKeys.CHAT_WIDTH]: 88,
        [StorageKeys.CHAT_FONT_SIZE]: 100,
      },
    });
    expect(payload.data).not.toHaveProperty('unknownKey');
  });

  it('preserves a legacy enabled watermark preference in settings backups', async () => {
    const storageArea = {
      get: vi.fn().mockResolvedValue({
        ...BACKUPABLE_SYNC_SETTINGS_DEFAULTS,
        [StorageKeys.WATERMARK_REMOVER_ENABLED]: true,
      }),
      set: vi.fn(),
    };

    const payload = await exportBackupableSyncSettings(storageArea);

    expect(resolveWatermarkSettings(payload.data)).toEqual({ download: true, preview: true });
  });

  it.each(['merge', 'overwrite'] as const)(
    'keeps a saved watermark choice when %s-restoring a backup without one',
    async (mode) => {
      const unsetDevice = {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn(),
      };
      const payload = await exportBackupableSyncSettings(unsetDevice);
      expect(payload.data).not.toHaveProperty(StorageKeys.WATERMARK_DOWNLOAD_ENABLED);

      const state: Record<string, unknown> = {
        [StorageKeys.WATERMARK_DOWNLOAD_ENABLED]: true,
        [StorageKeys.WATERMARK_PREVIEW_ENABLED]: true,
      };
      const savedDevice = {
        get: vi.fn().mockImplementation(async (defaults: Record<string, unknown>) => ({
          ...defaults,
          ...state,
        })),
        set: vi.fn().mockImplementation(async (items: Record<string, unknown>) => {
          Object.assign(state, items);
        }),
      };
      await restoreBackupableSyncSettings(payload.data, savedDevice, mode);

      expect(resolveWatermarkSettings(state)).toEqual({ download: true, preview: true });
      expect(state).not.toHaveProperty(StorageKeys.CHAT_WIDTH);
    },
  );

  it('restores an explicit watermark choice from a backup', async () => {
    const state: Record<string, unknown> = {
      [StorageKeys.WATERMARK_DOWNLOAD_ENABLED]: true,
      [StorageKeys.WATERMARK_PREVIEW_ENABLED]: true,
    };
    const storageArea = {
      get: vi.fn(),
      set: vi.fn().mockImplementation(async (items: Record<string, unknown>) => {
        Object.assign(state, items);
      }),
    };

    await restoreBackupableSyncSettings(
      {
        [StorageKeys.WATERMARK_REMOVER_ENABLED]: null,
        [StorageKeys.WATERMARK_DOWNLOAD_ENABLED]: false,
        [StorageKeys.WATERMARK_PREVIEW_ENABLED]: false,
      },
      storageArea,
    );

    expect(resolveWatermarkSettings(state)).toEqual({ download: false, preview: false });
  });

  it('restores only whitelisted settings keys', async () => {
    const storageArea = {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
    };

    const restored = await restoreBackupableSyncSettings(
      {
        [StorageKeys.CHAT_WIDTH]: 92,
        [StorageKeys.CONTEXT_SYNC_PORT]: 4040,
        unknownKey: 'ignore-me',
      },
      storageArea,
    );

    expect(restored).toEqual({
      [StorageKeys.CHAT_WIDTH]: 92,
      [StorageKeys.CONTEXT_SYNC_PORT]: 4040,
    });
    expect(storageArea.set).toHaveBeenCalledWith({
      [StorageKeys.CHAT_WIDTH]: 92,
      [StorageKeys.CONTEXT_SYNC_PORT]: 4040,
    });
  });

  it.each(['merge', 'overwrite'] as const)(
    'an old %s backup preserves a locally disabled rail and its independent message-time choice',
    async (mode) => {
      const state: Record<string, unknown> = {};
      const area = {
        get: vi.fn(async (defaults?: unknown) => ({
          ...(typeof defaults === 'object' && defaults !== null ? defaults : {}),
          ...state,
        })),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(state, items);
        }),
      };
      const fresh = await exportBackupableSyncSettings(area);
      expect(fresh.data).not.toHaveProperty(StorageKeys.GV_TIMELINE_ENABLED);
      await restoreBackupableSyncSettings(
        {
          [StorageKeys.GV_TIMELINE_ENABLED]: false,
          [StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS]: true,
        },
        area,
        mode,
      );
      const saved = await exportBackupableSyncSettings(area);
      expect(saved.data[StorageKeys.GV_TIMELINE_ENABLED]).toBe(false);
      await restoreBackupableSyncSettings({ [StorageKeys.CHAT_WIDTH]: 88 }, area, mode);
      expect(state[StorageKeys.GV_TIMELINE_ENABLED]).toBe(false);
      expect(state[StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS]).toBe(true);
      await restoreBackupableSyncSettings({ [StorageKeys.GV_TIMELINE_ENABLED]: true }, area, mode);
      expect(state[StorageKeys.GV_TIMELINE_ENABLED]).toBe(true);
      expect(state[StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS]).toBe(true);
    },
  );

  it.each([
    ['Gems sidebar', StorageKeys.GV_GEMS_SIDEBAR_ENABLED],
    ['Markdown rendering fix', StorageKeys.MARKDOWN_FIX_ENABLED],
  ] as const)(
    'keeps %s default-on or explicitly disabled when a backup lacks its setting',
    async (_name, key) => {
      for (const mode of ['merge', 'overwrite'] as const) {
        for (const currentValue of [undefined, false]) {
          const state: Record<string, unknown> =
            currentValue === undefined ? {} : { [key]: currentValue };
          const area = {
            get: vi.fn(async (defaults?: unknown) => ({
              ...(typeof defaults === 'object' && defaults !== null ? defaults : {}),
              ...state,
            })),
            set: vi.fn(async (items: Record<string, unknown>) => {
              Object.assign(state, items);
            }),
          };

          await restoreBackupableSyncSettings({ [StorageKeys.CHAT_WIDTH]: 88 }, area, mode);

          expect(state[StorageKeys.CHAT_WIDTH]).toBe(88);
          if (currentValue === undefined) {
            expect(state).not.toHaveProperty(key);
          } else {
            expect(state[key]).toBe(false);
          }
          const { data } = await exportBackupableSyncSettings(area);
          if (currentValue === undefined) expect(data).not.toHaveProperty(key);
          else expect(data[key]).toBe(false);
        }
      }
    },
  );

  it('backs up and restores an explicitly disabled formula-copy preference', async () => {
    const storageArea = {
      get: vi.fn().mockResolvedValue({
        ...BACKUPABLE_SYNC_SETTINGS_DEFAULTS,
        [StorageKeys.FORMULA_COPY_ENABLED]: false,
      }),
      set: vi.fn().mockResolvedValue(undefined),
    };

    const payload = await exportBackupableSyncSettings(storageArea);
    expect(payload.data[StorageKeys.FORMULA_COPY_ENABLED]).toBe(false);

    const restored = await restoreBackupableSyncSettings(
      { [StorageKeys.FORMULA_COPY_ENABLED]: false },
      storageArea,
    );
    expect(restored).toEqual({ [StorageKeys.FORMULA_COPY_ENABLED]: false });
    expect(storageArea.set).toHaveBeenCalledWith({
      [StorageKeys.FORMULA_COPY_ENABLED]: false,
    });
  });

  it('restores the code collapse and user LaTeX switches as on from a backup that predates them', async () => {
    // A sync area that answers `get(defaults)` the way chrome.storage does.
    const stored: Record<string, unknown> = {};
    const storageArea = {
      get: vi.fn(async (defaults: Record<string, unknown>) => ({ ...defaults, ...stored })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(stored, items);
      }),
    };
    const { [StorageKeys.CODE_BLOCK_COLLAPSE_ENABLED]: _collapse, ...olderDefaults } =
      BACKUPABLE_SYNC_SETTINGS_DEFAULTS;
    const { [StorageKeys.USER_LATEX_ENABLED]: _latex, ...olderBackup } = olderDefaults;

    await restoreBackupableSyncSettings(
      { ...olderBackup, [StorageKeys.MERMAID_ENABLED]: false },
      storageArea as never,
    );

    expect(stored).not.toHaveProperty(StorageKeys.CODE_BLOCK_COLLAPSE_ENABLED);
    expect(stored).not.toHaveProperty(StorageKeys.USER_LATEX_ENABLED);
    const { data } = await exportBackupableSyncSettings(storageArea as never);
    expect(data[StorageKeys.MERMAID_ENABLED]).toBe(false);
    expect(data).not.toHaveProperty(StorageKeys.CODE_BLOCK_COLLAPSE_ENABLED);
    expect(data).not.toHaveProperty(StorageKeys.USER_LATEX_ENABLED);

    // A backup that turned them off brings that choice back.
    await restoreBackupableSyncSettings(
      { [StorageKeys.CODE_BLOCK_COLLAPSE_ENABLED]: false, [StorageKeys.USER_LATEX_ENABLED]: false },
      storageArea as never,
    );
    expect(stored).toMatchObject({
      [StorageKeys.CODE_BLOCK_COLLAPSE_ENABLED]: false,
      [StorageKeys.USER_LATEX_ENABLED]: false,
    });
  });

  it('does not restore retired tab title sync as enabled', async () => {
    const storageArea = {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
    };

    const restored = await restoreBackupableSyncSettings(
      { [StorageKeys.TAB_TITLE_UPDATE_ENABLED]: true },
      storageArea,
    );

    expect(restored).toEqual({ [StorageKeys.TAB_TITLE_UPDATE_ENABLED]: false });
    expect(storageArea.set).toHaveBeenCalledWith({
      [StorageKeys.TAB_TITLE_UPDATE_ENABLED]: false,
    });
  });

  it('keeps monotonic onboarding progress when merging cloud settings', async () => {
    const storageArea = {
      get: vi.fn().mockResolvedValue({
        [StorageKeys.COACHMARKS_SEEN]: ['local-seen', 'shared'],
        [StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN]: true,
        [StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN_AISTUDIO]: false,
      }),
      set: vi.fn().mockResolvedValue(undefined),
    };

    const restored = await restoreBackupableSyncSettings(
      {
        [StorageKeys.COACHMARKS_SEEN]: ['shared', 'cloud-seen'],
        [StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN]: false,
        [StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN_AISTUDIO]: true,
      },
      storageArea,
      'merge',
    );

    expect(restored).toEqual({
      [StorageKeys.COACHMARKS_SEEN]: ['local-seen', 'shared', 'cloud-seen'],
      [StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN]: true,
      [StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN_AISTUDIO]: true,
    });
    expect(storageArea.set).toHaveBeenCalledWith(restored);
  });

  it('skips storage writes for invalid settings payloads', async () => {
    const storageArea = {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
    };

    const restored = await restoreBackupableSyncSettings(null, storageArea);

    expect(restored).toEqual({});
    expect(storageArea.set).not.toHaveBeenCalled();
  });
});
