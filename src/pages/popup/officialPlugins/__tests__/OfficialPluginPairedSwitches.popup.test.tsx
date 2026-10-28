import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '@/contexts/LanguageContext';
import { StorageKeys } from '@/core/types/common';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { loadTranslations } from '@/utils/translations';

import Popup from '../../Popup';
import {
  AI_STUDIO,
  emitSyncChange,
  extensionApi,
  popupRows,
  resetPopupBrowser,
} from './popupHarness';

const en = await loadTranslations('en');

// Keep Popup, its hooks and the packaged manifests real; replace only browser APIs.
vi.mock('webextension-polyfill', async () => ({
  default: (await import('./popupHarness')).extensionApi,
}));

/** Rows whose switch reads or writes more than its own key: watermark removal and batch delete. */
describe('official plugin rows tied to other settings', () => {
  let container: HTMLDivElement;
  let root: Root;
  let sync: Record<string, unknown>;

  beforeEach(() => {
    ({ sync } = resetPopupBrowser());
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
  const row = (id: string) => popupRows(container).row(id);
  const toggle = (id: string) => popupRows(container).toggle(id);
  const click = async (id: string) => {
    await act(async () => toggle(id).click());
  };

  describe('watermark removal', () => {
    const download = OFFICIAL_PLUGIN_IDS.geminiWatermarkDownload;
    const preview = OFFICIAL_PLUGIN_IDS.geminiWatermarkPreview;
    const written = (downloadOn: boolean, previewOn: boolean) => ({
      [StorageKeys.WATERMARK_DOWNLOAD_ENABLED]: downloadOn,
      [StorageKeys.WATERMARK_PREVIEW_ENABLED]: previewOn,
      [StorageKeys.WATERMARK_REMOVER_ENABLED]: null,
    });

    it('either switch writes both split keys and clears the old shared one', async () => {
      await mount();
      await click(download);
      expect(extensionApi.storage.sync.set).toHaveBeenLastCalledWith(written(true, false));
      // The second write keeps the first one's choice, even before storage echoes it.
      await click(preview);
      expect(extensionApi.storage.sync.set).toHaveBeenLastCalledWith(written(true, true));
      expect(extensionApi.storage.sync.set).toHaveBeenCalledTimes(2);
      expect([toggle(download).checked, toggle(preview).checked]).toEqual([true, true]);
    });

    it('the old shared switch shows both on, and turning one off keeps the other on', async () => {
      sync[StorageKeys.WATERMARK_REMOVER_ENABLED] = true;
      await mount();
      expect([toggle(download).checked, toggle(preview).checked]).toEqual([true, true]);
      await click(download);
      expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith(written(false, true));
      expect([toggle(download).checked, toggle(preview).checked]).toEqual([false, true]);
    });

    it('a stored split key wins over the old one, and its unstored sibling reads on', async () => {
      sync[StorageKeys.WATERMARK_REMOVER_ENABLED] = false;
      sync[StorageKeys.WATERMARK_PREVIEW_ENABLED] = false;
      await mount();
      expect([toggle(download).checked, toggle(preview).checked]).toEqual([true, false]);
      await click(preview);
      expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith(written(true, true));
    });

    it('lists the old card title once, as two rows, with preview still marked unstable', async () => {
      await mount();
      expect(
        [...container.querySelectorAll('h3')].map((heading) => heading.textContent),
      ).not.toContain(en.nanobananaOptions);
      expect(row(preview)!.querySelector(`[title="${en.experimentalLabel}"]`)).not.toBeNull();
      expect(row(download)!.querySelector(`[title="${en.experimentalLabel}"]`)).toBeNull();
    });
  });

  describe.each([
    ['Gemini', undefined, OFFICIAL_PLUGIN_IDS.geminiBatchDelete],
    ['AI Studio', AI_STUDIO, OFFICIAL_PLUGIN_IDS.aistudioBatchDelete],
  ] as const)('batch delete on %s', (_site, url, id) => {
    const needsFolders = en.pluginRowNeedsSetting
      .replace('{card}', en.folderOptions)
      .replace('{setting}', en.enableFolderFeature);

    beforeEach(() => {
      if (url) extensionApi.tabs.query.mockResolvedValue([{ id: 8, url }]);
    });

    it('with folders off, shows the switch off and disabled, and says where to turn them on', async () => {
      sync[StorageKeys.FOLDER_ENABLED] = false;
      sync[StorageKeys.BATCH_DELETE_ENABLED] = true;
      await mount();
      expect(toggle(id).checked).toBe(false);
      expect(toggle(id).disabled).toBe(true);
      // The disabled switch says why to a screen reader too.
      const describedBy = toggle(id).getAttribute('aria-describedby')!.split(' ');
      expect(describedBy.map((ref) => document.getElementById(ref)?.textContent)).toContain(
        needsFolders,
      );
      await click(id);
      expect(extensionApi.storage.sync.set).not.toHaveBeenCalled();
      expect(sync[StorageKeys.BATCH_DELETE_ENABLED]).toBe(true);

      // Turning folders on elsewhere brings back the saved choice.
      await act(async () => emitSyncChange({ [StorageKeys.FOLDER_ENABLED]: true }));
      expect(toggle(id).checked).toBe(true);
      expect(toggle(id).disabled).toBe(false);
      expect(row(id)!.textContent).not.toContain(needsFolders);
    });

    it('with folders on, is on by default and writes only its own key', async () => {
      await mount();
      expect(toggle(id).checked).toBe(true);
      expect(row(id)!.textContent).not.toContain(needsFolders);
      await click(id);
      expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
        [StorageKeys.BATCH_DELETE_ENABLED]: false,
      });
      expect(toggle(id).checked).toBe(false);
      expect(toggle(id).disabled).toBe(false);
    });
  });
});
