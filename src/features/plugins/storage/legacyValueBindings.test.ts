import { describe, expect, it } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { BundledCatalogPluginSource } from '../sources/BundledCatalogPluginSource';
import {
  LEGACY_VALUE_BINDINGS,
  acceptsLegacyLiveChange,
  deriveLegacyValueSettings,
  legacyValueKeys,
  legacyValueWrite,
} from './legacyValueBindings';

const FONT_SIZE_ID = 'voyager.gemini-chat-font-size';
const LINE_HEIGHT_ID = 'voyager.gemini-chat-line-height';
const WIDTH_ID = 'voyager.gemini-chat-width';
const EDIT_WIDTH_ID = 'voyager.gemini-edit-input-width';

describe('legacy value bindings', () => {
  it('binds AI Studio numeric width changes and drags to the existing width key', () => {
    const id = 'voyager.aistudio-sidebar-width';
    const key = StorageKeys.AISTUDIO_SIDEBAR_WIDTH;
    for (const [stored, widthPx] of [
      [undefined, 280],
      [399.8, 400],
      [200, 240],
      [700, 600],
    ]) {
      expect(deriveLegacyValueSettings(id, { [key]: stored })).toEqual({ widthPx });
    }
    expect(legacyValueWrite(id, 'widthPx', 430)).toEqual({ [key]: 430 });
    expect(acceptsLegacyLiveChange(key, 430)).toBe(true);
    expect(acceptsLegacyLiveChange(key, undefined)).toBe(false);
    expect(acceptsLegacyLiveChange(key, '430')).toBe(false);
  });
  it('keeps zero Gems hidden and binds live counts to the existing sync key', () => {
    const id = 'voyager.gemini-gems-sidebar';
    const key = StorageKeys.GV_GEMS_SIDEBAR_COUNT;
    for (const [stored, count] of [
      [undefined, 3],
      [0, 0],
      [2.6, 2],
      [-1, 0],
      [20, 10],
    ] as const) {
      expect(deriveLegacyValueSettings(id, { [key]: stored })).toEqual({ count });
    }
    expect(legacyValueWrite(id, 'count', 0)).toEqual({ [key]: 0 });
    expect(acceptsLegacyLiveChange(key, 0)).toBe(true);
    expect(acceptsLegacyLiveChange(key, undefined)).toBe(true);
    expect(acceptsLegacyLiveChange(key, '3')).toBe(true);
  });
  it('falls back to the default for a non-numeric or non-finite stored value on the first read', () => {
    for (const stored of [undefined, null, '120', true, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        deriveLegacyValueSettings(FONT_SIZE_ID, { [StorageKeys.CHAT_FONT_SIZE]: stored }),
      ).toEqual({ fontSize: 100 });
      expect(
        deriveLegacyValueSettings(LINE_HEIGHT_ID, {
          [StorageKeys.CHAT_LINE_HEIGHT]: stored,
          [StorageKeys.CHAT_PARAGRAPH_SPACING]: stored,
        }),
      ).toEqual({ lineHeight: 160, paragraphSpacing: 12 });
      expect(deriveLegacyValueSettings(WIDTH_ID, { [StorageKeys.CHAT_WIDTH]: stored })).toEqual({
        widthPercent: 70,
      });
    }
    expect(deriveLegacyValueSettings(FONT_SIZE_ID, {})).toEqual({ fontSize: 100 });
  });

  it('rounds and clamps every value as the native modules do, reading an old px chat width as percent', () => {
    expect(
      deriveLegacyValueSettings(FONT_SIZE_ID, { [StorageKeys.CHAT_FONT_SIZE]: 112.6 }),
    ).toEqual({ fontSize: 113 });
    expect(deriveLegacyValueSettings(FONT_SIZE_ID, { [StorageKeys.CHAT_FONT_SIZE]: 400 })).toEqual({
      fontSize: 150,
    });
    expect(
      deriveLegacyValueSettings(LINE_HEIGHT_ID, {
        [StorageKeys.CHAT_LINE_HEIGHT]: 99,
        [StorageKeys.CHAT_PARAGRAPH_SPACING]: 7.5,
      }),
    ).toEqual({ lineHeight: 120, paragraphSpacing: 8 });
    // 960 px of the old 1200 px baseline is 80 %.
    expect(deriveLegacyValueSettings(WIDTH_ID, { [StorageKeys.CHAT_WIDTH]: 960 })).toEqual({
      widthPercent: 80,
    });
    expect(deriveLegacyValueSettings(WIDTH_ID, { [StorageKeys.CHAT_WIDTH]: 12 })).toEqual({
      widthPercent: 30,
    });
  });

  it('reads the edit input width as its native module did, defaulting to 60 %', () => {
    const read = (stored: unknown) =>
      deriveLegacyValueSettings(EDIT_WIDTH_ID, { [StorageKeys.EDIT_INPUT_WIDTH]: stored });
    for (const stored of [undefined, null, '80', Number.NaN]) {
      expect(read(stored)).toEqual({ widthPercent: 60 });
    }
    expect(read(82.4)).toEqual({ widthPercent: 82 });
    expect(read(960)).toEqual({ widthPercent: 80 });
    expect(read(12)).toEqual({ widthPercent: 30 });
    // The native listener ignored a live width that was not a number.
    expect(acceptsLegacyLiveChange(StorageKeys.EDIT_INPUT_WIDTH, '80')).toBe(false);
    expect(acceptsLegacyLiveChange(StorageKeys.EDIT_INPUT_WIDTH, 80)).toBe(true);
  });

  it('preserves native sidebar coercion, pixel bounds and legacy percentages', () => {
    const read = (stored: unknown) =>
      deriveLegacyValueSettings('voyager.gemini-sidebar-width', {
        [StorageKeys.SIDEBAR_WIDTH]: stored,
      });
    for (const [stored, expected] of [
      [undefined, 312],
      ['400', 400],
      [null, 15],
      [26, 26],
      [46, 180],
      [700, 540],
      [Number.NaN, 312],
    ]) {
      expect(read(stored)).toEqual({ widthPx: expected });
    }
    expect(acceptsLegacyLiveChange(StorageKeys.SIDEBAR_WIDTH, undefined)).toBe(false);
    expect(acceptsLegacyLiveChange(StorageKeys.SIDEBAR_WIDTH, '400')).toBe(true);
    expect(acceptsLegacyLiveChange(StorageKeys.SIDEBAR_WIDTH, null)).toBe(true);
    expect(acceptsLegacyLiveChange(StorageKeys.SIDEBAR_WIDTH, Number.NaN)).toBe(false);
    expect(acceptsLegacyLiveChange(StorageKeys.SIDEBAR_WIDTH, 400)).toBe(true);
  });

  it('stores a setting under its old key as the native module will read it back', () => {
    expect(legacyValueWrite('voyager.gemini-input-collapse', 'collapseWhenNotEmpty', true)).toEqual(
      { [StorageKeys.INPUT_COLLAPSE_WHEN_NOT_EMPTY]: true },
    );
    expect(legacyValueWrite(FONT_SIZE_ID, 'fontSize', 400)).toEqual({
      [StorageKeys.CHAT_FONT_SIZE]: 150,
    });
    // No binding fills it, so there is nothing to write (and never a plugin-state write).
    expect(legacyValueWrite(FONT_SIZE_ID, 'lineHeight', 120)).toBeNull();
    expect(legacyValueWrite('voyager.gemini-mermaid', 'anything', true)).toBeNull();
  });

  it('gives an id without value bindings no settings', () => {
    expect(deriveLegacyValueSettings('voyager.gemini-hide-input-halo', { anything: 1 })).toEqual(
      {},
    );
  });

  it('lets a value key change live only to a number, and every other key change freely', () => {
    expect(acceptsLegacyLiveChange(StorageKeys.CHAT_FONT_SIZE, 120)).toBe(true);
    expect(acceptsLegacyLiveChange(StorageKeys.CHAT_FONT_SIZE, Number.NaN)).toBe(true);
    expect(acceptsLegacyLiveChange(StorageKeys.CHAT_FONT_SIZE, '120')).toBe(false);
    expect(acceptsLegacyLiveChange(StorageKeys.CHAT_FONT_SIZE, null)).toBe(false);
    expect(acceptsLegacyLiveChange(StorageKeys.CHAT_FONT_SIZE, undefined)).toBe(false);
    expect(acceptsLegacyLiveChange(StorageKeys.CHAT_FONT_SIZE_ENABLED, undefined)).toBe(true);
    expect(acceptsLegacyLiveChange(StorageKeys.CHAT_FONT_SIZE_ENABLED, 'yes')).toBe(true);
  });

  it('lists each value key once', () => {
    expect([...legacyValueKeys()].sort()).toEqual(
      [
        StorageKeys.GV_VISUAL_EFFECT,
        StorageKeys.GV_SNOW_EFFECT,
        StorageKeys.CHAT_FONT_SIZE,
        StorageKeys.CHAT_LINE_HEIGHT,
        StorageKeys.CHAT_PARAGRAPH_SPACING,
        StorageKeys.CHAT_WIDTH,
        StorageKeys.EDIT_INPUT_WIDTH,
        StorageKeys.SIDEBAR_WIDTH,
        StorageKeys.AISTUDIO_SIDEBAR_WIDTH,
        StorageKeys.GV_GEMS_SIDEBAR_COUNT,
        StorageKeys.INPUT_COLLAPSE_WHEN_NOT_EMPTY,
        StorageKeys.FOLDER_HIDE_ARCHIVED_CONVERSATIONS_AISTUDIO,
        StorageKeys.FOLDER_HIDE_ARCHIVED_CONVERSATIONS,
      ].sort(),
    );
  });

  it("hides Gemini's filed chats only with Gemini's own switch stored true", () => {
    const id = 'voyager.gemini-folders';
    const key = StorageKeys.FOLDER_HIDE_ARCHIVED_CONVERSATIONS;
    expect(deriveLegacyValueSettings(id, {})).toEqual({ hideFiledChats: false });
    expect(
      deriveLegacyValueSettings(id, {
        [StorageKeys.FOLDER_HIDE_ARCHIVED_CONVERSATIONS_AISTUDIO]: true,
      }),
    ).toEqual({ hideFiledChats: false });
    expect(deriveLegacyValueSettings(id, { [key]: 'true' })).toEqual({ hideFiledChats: false });
    expect(deriveLegacyValueSettings(id, { [key]: true })).toEqual({ hideFiledChats: true });
  });

  it("hides AI Studio's filed prompts only with AI Studio's own switch stored true", () => {
    const id = 'voyager.aistudio-folders';
    const key = StorageKeys.FOLDER_HIDE_ARCHIVED_CONVERSATIONS_AISTUDIO;
    expect(deriveLegacyValueSettings(id, {})).toEqual({ hideFiledChats: false });
    expect(
      deriveLegacyValueSettings(id, { [StorageKeys.FOLDER_HIDE_ARCHIVED_CONVERSATIONS]: true }),
    ).toEqual({ hideFiledChats: false });
    expect(deriveLegacyValueSettings(id, { [key]: 'true' })).toEqual({ hideFiledChats: false });
    expect(deriveLegacyValueSettings(id, { [key]: true })).toEqual({ hideFiledChats: true });
  });

  it('reads the collapse-with-content switch as true only when stored true, and takes every live change of it', () => {
    const id = 'voyager.gemini-input-collapse';
    const key = StorageKeys.INPUT_COLLAPSE_WHEN_NOT_EMPTY;
    for (const stored of [undefined, null, false, 'true', 1]) {
      expect(deriveLegacyValueSettings(id, { [key]: stored })).toEqual({
        collapseWhenNotEmpty: false,
      });
    }
    expect(deriveLegacyValueSettings(id, { [key]: true })).toEqual({ collapseWhenNotEmpty: true });
    // The native listener read any live value but true, removal included, as off.
    for (const value of [undefined, null, false, true, 'yes']) {
      expect(acceptsLegacyLiveChange(key, value)).toBe(true);
    }
  });

  it('fills only settings the packaged typography manifests declare, within their ranges', async () => {
    const packaged = await new BundledCatalogPluginSource().list();
    const manifests = packaged.filter((m) => m.id === FONT_SIZE_ID || m.id === LINE_HEIGHT_ID);
    expect(manifests).toHaveLength(2);
    for (const manifest of manifests) {
      const schema = manifest.contributes.settings ?? {};
      const bindings = LEGACY_VALUE_BINDINGS[manifest.id] ?? [];
      expect(bindings.map((entry) => entry.settingKey).sort()).toEqual(Object.keys(schema).sort());
      for (const entry of bindings) {
        const field = schema[entry.settingKey];
        expect(entry.read(undefined), entry.settingKey).toBe(field.default);
        expect(entry.read(-1e9), entry.settingKey).toBe(field.min);
        expect(entry.read(1e9), entry.settingKey).toBe(field.max);
      }
    }
  });
});
