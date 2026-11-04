import { act } from 'react';

import { describe, expect, it, vi } from 'vitest';

import { BundledCatalogPluginSource } from '@/features/plugins/sources/BundledCatalogPluginSource';

import {
  container,
  nativeSetSliderValue,
  pluginState,
  renderSettings,
  setPluginSetting,
} from './pluginManagerHarness';

const plugins = (await new BundledCatalogPluginSource().list()).filter((plugin) =>
  ['chatgpt', 'claude', 'deepseek', 'kimi'].some(
    (site) => plugin.id === `voyager.${site}-reading-typography`,
  ),
);

describe.each(plugins)('$name precise font size', (plugin) => {
  it('saves a decimal only on Enter, preserves it on reopen, and resets only the font size', async () => {
    pluginState.current = {
      [plugin.id]: {
        enabled: true,
        installedAt: 0,
        settings: { fontSizeEnabled: true, fontSize: 117.5, lineHeight: 165 },
      },
    };
    await renderSettings(plugin);
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    const track = container.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(input.value).toBe('117.5');
    expect(track.value).toBe('117.5');
    act(() => {
      input.focus();
      nativeSetSliderValue(input, 102.5);
    });
    act(() => vi.advanceTimersByTime(200));
    expect(setPluginSetting).not.toHaveBeenCalled();
    expect(track.value).toBe('117.5');
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(track.value).toBe('102.5');
    act(() => vi.advanceTimersByTime(200));
    expect(setPluginSetting).toHaveBeenLastCalledWith(plugin.id, 'fontSize', 102.5);

    const reset = container.querySelector<HTMLButtonElement>(
      'button[aria-label="themeColorReset (100%)"]',
    )!;
    act(() => reset.click());
    expect(input.value).toBe('100');
    expect(track.value).toBe('100');
    act(() => vi.advanceTimersByTime(200));
    expect(setPluginSetting).toHaveBeenLastCalledWith(plugin.id, 'fontSize', 100);
  });

  it('moves in 1% steps from a decimal and keeps disabled controls inert', async () => {
    pluginState.current = {
      [plugin.id]: {
        enabled: true,
        installedAt: 0,
        settings: { fontSizeEnabled: true, fontSize: 102.5 },
      },
    };
    await renderSettings(plugin);
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    const track = container.querySelector<HTMLInputElement>('input[type="range"]')!;
    act(() =>
      track.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
    );
    expect(track.value).toBe('103.5');
    expect(input.value).toBe('103.5');
    act(() => vi.advanceTimersByTime(200));
    expect(setPluginSetting).toHaveBeenLastCalledWith(plugin.id, 'fontSize', 103.5);

    const toggle = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    act(() => toggle.click());
    expect(input.disabled).toBe(true);
    expect(track.disabled).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="themeColorReset (100%)"]')!
        .disabled,
    ).toBe(true);
    expect(input.value).toBe('103.5');
  });
});
