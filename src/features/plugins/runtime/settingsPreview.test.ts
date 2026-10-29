/**
 * The previewed setting PluginHost lays over what it runs: checked the way
 * the plugin reads that setting, and gone again when a released value's save
 * never arrives.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OFFICIAL_PLUGIN_IDS } from '../sites/featureOwners';
import { BundledCatalogPluginSource } from '../sources/BundledCatalogPluginSource';
import type { PluginManifest } from '../types';
import { manifest as testManifest } from './PluginHost.testHarness';
import { createSettingsPreview } from './settingsPreview';

const FONT_ID = OFFICIAL_PLUGIN_IDS.geminiChatFontSize;

async function fontSize(): Promise<PluginManifest> {
  const found = (await new BundledCatalogPluginSource().list()).find((m) => m.id === FONT_ID);
  if (!found) throw new Error(`${FONT_ID} is not packaged`);
  return found;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('settings preview', () => {
  it('checks a previewed value the way the plugin reads its setting', async () => {
    const preview = createSettingsPreview();
    const font = await fontSize();
    const width: PluginManifest = {
      ...testManifest(['https://example.com/*'], 'voyager.width'),
      contributes: {
        settings: { width: { type: 'number', label: 'Width', default: 50, min: 30, max: 90 } },
      },
    };

    preview.set(FONT_ID, 'fontSize', 400);
    expect(preview.apply(font, { fontSize: 110 })).toEqual({ fontSize: 150 });
    // The plugin's live listener keeps its number when a value is not one.
    preview.set(FONT_ID, 'fontSize', 'huge');
    expect(preview.apply(font, { fontSize: 110 })).toEqual({ fontSize: 110 });
    // Another plugin runs with what it stored.
    expect(preview.apply(width, { width: 50 })).toEqual({ width: 50 });

    preview.set('voyager.width', 'width', 120);
    expect(preview.apply(width, { width: 50 })).toEqual({ width: 90 });
    preview.set('voyager.width', 'width', true);
    expect(preview.apply(width, { width: 50 })).toEqual({ width: 50 });
  });

  it('gives the stored value back when a released value is never saved', async () => {
    vi.useFakeTimers();
    const preview = createSettingsPreview();
    const font = await fontSize();
    const changed = vi.fn();
    preview.subscribe(changed);

    preview.set(FONT_ID, 'fontSize', 140);
    preview.end('settle');
    vi.advanceTimersByTime(700);
    expect(preview.apply(font, { fontSize: 110 })).toEqual({ fontSize: 140 });

    vi.advanceTimersByTime(200);
    expect(preview.apply(font, { fontSize: 110 })).toEqual({ fontSize: 110 });
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
