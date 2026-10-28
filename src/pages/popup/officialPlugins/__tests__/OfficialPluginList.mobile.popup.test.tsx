import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '@/contexts/LanguageContext';
import { StorageKeys } from '@/core/types/common';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { loadTranslations } from '@/utils/translations';

import Popup from '../../Popup';
import { extensionApi, popupRows, resetPopupBrowser } from './popupHarness';

const en = await loadTranslations('en');

// Keep Popup, its hooks and the packaged manifests real; replace only browser APIs.
vi.mock('webextension-polyfill', async () => ({
  default: (await import('./popupHarness')).extensionApi,
}));
vi.mock('@/core/utils/browser', async (importOriginal) => {
  const { browserTarget } = await import('./popupHarness');
  return {
    ...(await importOriginal<typeof import('@/core/utils/browser')>()),
    isSafari: () => browserTarget.safari,
  };
});

const ON_PHONES_NOTE = en.pluginUnavailableOnMobile;

describe('the official plugin list on Firefox for Android', () => {
  let container: HTMLDivElement;
  let root: Root;
  let sync: Record<string, unknown>;

  beforeEach(() => {
    ({ sync } = resetPopupBrowser());
    (extensionApi.runtime as { getPlatformInfo?: unknown }).getPlatformInfo = async () => ({
      os: 'android',
    });
    // The popup is its own tab there: the Gemini page answers nothing.
    extensionApi.tabs.sendMessage.mockRejectedValue(new Error('No receiving end'));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete (extensionApi.runtime as { getPlatformInfo?: unknown }).getPlatformInfo;
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

  // #1072: 2.2.1 switched off every plugin without a device list on Android.
  it('keeps a plugin that names no devices, such as chat width, usable and on', async () => {
    sync[StorageKeys.CHAT_WIDTH_ENABLED] = true;
    await mount();
    const { row, toggle } = popupRows(container);

    expect(row(OFFICIAL_PLUGIN_IDS.geminiChatWidth)!.textContent).not.toContain(ON_PHONES_NOTE);
    expect(toggle(OFFICIAL_PLUGIN_IDS.geminiChatWidth).disabled).toBe(false);
    expect(toggle(OFFICIAL_PLUGIN_IDS.geminiChatWidth).checked).toBe(true);
  });

  it('leaves the timeline and export rows as on a desktop', async () => {
    await mount();
    const { row, toggle } = popupRows(container);

    for (const id of [OFFICIAL_PLUGIN_IDS.geminiTimeline, OFFICIAL_PLUGIN_IDS.geminiExport]) {
      expect(row(id)!.textContent).not.toContain(ON_PHONES_NOTE);
      expect(toggle(id).disabled).toBe(false);
    }
  });
});
