import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '@/contexts/LanguageContext';
import { StorageKeys } from '@/core/types/common';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { loadAllTranslations, loadTranslations } from '@/utils/translations';

import Popup from '../../Popup';
import {
  AI_STUDIO,
  emitSyncChange,
  extensionApi,
  popupRows,
  resetPopupBrowser,
} from './popupHarness';

const en = await loadTranslations('en');

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./popupHarness')).extensionApi,
}));

/** The format and the selection conversion come from the manifest settings, as every surface shows them. */
describe('formula copy row: format and selection conversion', () => {
  const id: string = OFFICIAL_PLUGIN_IDS.geminiFormulaCopy;
  let container: HTMLDivElement;
  let root: Root;
  let local: Record<string, unknown>;
  let sync: Record<string, unknown>;

  beforeEach(() => {
    ({ local, sync } = resetPopupBrowser());
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const mount = async () => {
    await act(async () => {
      root.render(
        <LanguageProvider>
          <Popup />
        </LanguageProvider>,
      );
    });
  };
  const row = (pluginId = id) => popupRows(container).row(pluginId);
  const format = (pluginId = id) => row(pluginId)?.querySelector('select') ?? null;
  const selection = (pluginId = id) =>
    row(pluginId)?.querySelector<HTMLInputElement>(
      `input[aria-label="${en.formulaCopySelectionLatex}"]`,
    ) ?? null;
  const pick = async (value: string, pluginId = id) => {
    const element = format(pluginId)!;
    await act(async () => {
      element.value = value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  const writes = () => extensionApi.storage.sync.set.mock.calls.map(([payload]) => payload);

  it('offers both only while the plugin is on, with the note that both sites share them', async () => {
    sync[StorageKeys.FORMULA_COPY_ENABLED] = false;
    await mount();
    expect(format()).toBeNull();
    expect(selection()).toBeNull();

    await act(async () => popupRows(container).toggle(id).click());
    expect([...format()!.options].map((option) => [option.value, option.text])).toEqual([
      ['latex', en.formulaCopyFormatLatex],
      ['unicodemath', en.formulaCopyFormatUnicodeMath],
      ['no-dollar', en.formulaCopyFormatNoDollar],
      ['notion', en.formulaCopyFormatNotion],
    ]);
    expect(format()!.closest('label')!.textContent).toContain(en.formulaCopyFormat);
    expect(selection()).not.toBeNull();
    expect(row()!.textContent).toContain(en.formulaCopyScopeNote);

    await act(async () => popupRows(container).toggle(id).click());
    expect(format()).toBeNull();
    expect(selection()).toBeNull();
  });

  it.each([
    ['nothing stored', {}, 'latex', true],
    [
      'a known format, selection off',
      { gvFormulaCopyFormat: 'notion', gvFormulaCopySelectionLatex: false },
      'notion',
      false,
    ],
    [
      'an unknown format, a non-boolean flag',
      { gvFormulaCopyFormat: 'mathml', gvFormulaCopySelectionLatex: 'false' },
      'latex',
      true,
    ],
  ] as const)(
    'shows %s the way the formula runtime reads it',
    async (_label, stored, shownFormat, selectionOn) => {
      Object.assign(sync, stored);
      await mount();
      expect(format()!.value).toBe(shownFormat);
      expect(selection()!.checked).toBe(selectionOn);
    },
  );

  it('writes only the shared sync keys, never plugin state, and follows a change made elsewhere', async () => {
    await mount();
    await pick('notion');
    await act(async () => selection()!.click());
    expect(writes()).toEqual([
      { [StorageKeys.FORMULA_COPY_FORMAT]: 'notion' },
      { [StorageKeys.FORMULA_COPY_SELECTION_LATEX]: false },
    ]);
    expect(local[StorageKeys.PLUGINS_STATE]).toBeUndefined();

    await act(async () => emitSyncChange({ [StorageKeys.FORMULA_COPY_FORMAT]: 'no-dollar' }));
    expect(format()!.value).toBe('no-dollar');
  });

  it('on AI Studio, the row edits the same shared switch and format', async () => {
    extensionApi.tabs.query.mockResolvedValue([{ id: 8, url: AI_STUDIO }]);
    await mount();
    const studio = OFFICIAL_PLUGIN_IDS.aistudioFormulaCopy;
    expect(popupRows(container).toggle(studio).checked).toBe(true);
    await pick('notion', studio);
    await act(async () => popupRows(container).toggle(studio).click());
    expect(writes()).toEqual([
      { [StorageKeys.FORMULA_COPY_FORMAT]: 'notion' },
      { [StorageKeys.FORMULA_COPY_ENABLED]: false },
    ]);
  });

  it('a search for a format lists the row with its options', async () => {
    local[StorageKeys.GV_POPUP_SETTINGS_SEARCH_QUERY] = en.formulaCopyFormatNotion;
    await mount();
    await act(async () => loadAllTranslations());
    expect(format()).not.toBeNull();
  });
});
