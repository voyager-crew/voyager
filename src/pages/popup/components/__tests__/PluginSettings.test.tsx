import { act } from 'react';

import { describe, expect, it, vi } from 'vitest';

import { BUILTIN_PLUGINS } from '@/features/plugins/builtin';
import readingTypography from '@/features/plugins/catalog/sites/deepseek/plugins/reading-typography/plugin.json';
import deepseekTimeline from '@/features/plugins/catalog/sites/deepseek/plugins/timeline/plugin.json';
import { validateManifest } from '@/features/plugins/manifest/validate';
import { resolvePluginSettings } from '@/features/plugins/runtime/resolvePluginSettings';
import type { PluginManifest, PluginSettings } from '@/features/plugins/types';

import {
  container,
  nativeSetSliderValue,
  mockLanguage,
  mockMessages,
  renderSettings as render,
  compactTimelinePlugin,
  setPluginSetting,
  setPluginSettings,
  PLUGIN_ID,
  widthPlugin,
  pluginState,
} from './pluginManagerHarness';

const deepseek = validateManifest({
  ...deepseekTimeline,
  contributes: { ...deepseekTimeline.contributes, styles: [] },
});
if (!deepseek.success) throw new Error('invalid DeepSeek timeline');
const timelines = [
  ...BUILTIN_PLUGINS.filter((plugin) =>
    plugin.contributes.domOps?.some((op) => op.op === 'native' && op.handler === 'turnNavigator'),
  ),
  deepseek.data,
];

/** Mirrors the Pro weekly allowance: a 0–10,000 span where 50/100/200 are the useful values. */
const wideNumberPlugin: PluginManifest = {
  ...widthPlugin,
  contributes: {
    settings: {
      weeklyLimit: {
        type: 'number',
        label: 'Weekly Pro allowance',
        default: 0,
        min: 0,
        max: 10_000,
        messageKeys: {
          label: 'chatgptProUsageWeeklyLimit',
          hint: 'chatgptProUsageWeeklyLimitHint',
        },
      },
    },
  },
};

describe.each(timelines)('$name style setting', (plugin) => {
  it('lets a user choose the ruler timeline style', async () => {
    mockLanguage.current = 'zh';
    await render(plugin);
    const select = container.querySelector('select')!;
    expect(select.closest('label')?.textContent).toContain('时间线样式');
    expect(Array.from(select.options, (option) => option.textContent)).toEqual([
      '节点',
      '紧凑索引',
      '刻度',
    ]);
    expect(select.value).toBe('dots');
    act(() => {
      select.value = 'ruler';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(select.value).toBe('ruler');
    expect(setPluginSettings).toHaveBeenCalledWith(plugin.id, {
      timelineStyle: 'ruler',
      compactView: false,
    });
  });

  it('keeps an existing compact setting until the user chooses a style', async () => {
    pluginState.current = {
      [plugin.id]: { enabled: true, installedAt: 0, settings: { compactView: true } },
    };
    await render(plugin);
    const select = container.querySelector('select')!;
    expect(select.value).toBe('compact');
    expect(setPluginSettings).not.toHaveBeenCalled();
    act(() => {
      select.value = 'dots';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(select.value).toBe('dots');
    expect(setPluginSettings).toHaveBeenCalledWith(plugin.id, {
      timelineStyle: 'dots',
      compactView: false,
    });
  });
});

describe.each(timelines)('$name style no longer offered', (plugin) => {
  const withoutChoice = (removed: string): PluginManifest => {
    const style = plugin.contributes.settings!.timelineStyle;
    return {
      ...plugin,
      contributes: {
        ...plugin.contributes,
        settings: {
          ...plugin.contributes.settings,
          timelineStyle: {
            ...style,
            options: style.options!.filter((option) => option.value !== removed),
          },
        },
      },
    };
  };
  const stored = (settings: PluginSettings) => {
    pluginState.current = { [plugin.id]: { enabled: true, installedAt: 0, settings } };
  };

  it("a style removed from a plugin's choices shows and runs its default", async () => {
    const updated = withoutChoice('ruler');
    stored({ timelineStyle: 'ruler' });
    await render(updated);
    expect(container.querySelector('select')!.value).toBe('dots');
    expect(resolvePluginSettings(updated, { timelineStyle: 'ruler' }).timelineStyle).toBe('dots');
  });

  it('an old compact preference shows and runs the default when compact is not offered', async () => {
    const updated = withoutChoice('compact');
    stored({ compactView: true });
    await render(updated);
    expect(container.querySelector('select')!.value).toBe('dots');
    expect(resolvePluginSettings(updated, { compactView: true }).timelineStyle).toBe('dots');
  });
});

describe.each(
  BUILTIN_PLUGINS.filter((plugin) =>
    plugin.contributes.domOps?.some((op) => op.op === 'native' && op.handler === 'turnNavigator'),
  ),
)('$name node levels', (plugin) => {
  it('offers node levels as an experimental switch that starts off, in Gemini wording', async () => {
    await render(plugin);
    // Translations resolve to their key here: the switch reuses Gemini's own messages.
    const input = container.querySelector(
      'input[aria-label="enableMarkerLevel"]',
    ) as HTMLInputElement;
    expect(input.checked).toBe(false);
    const row = input.closest('div')!;
    expect(row.querySelector('[title="experimentalLabel"]')).not.toBeNull();
    expect(row.textContent).toContain('enableMarkerLevelHint');

    act(() => input.click());
    expect(setPluginSettings).toHaveBeenCalledWith(plugin.id, {
      markerLevel: true,
      timelineStyle: 'dots',
      compactView: false,
    });
  });

  it('with node levels on, only the nodes style can be chosen', async () => {
    pluginState.current = {
      [plugin.id]: { enabled: true, installedAt: 0, settings: { markerLevel: true } },
    };
    await render(plugin);
    const select = container.querySelector('select')!;
    const disabled = Array.from(select.options, (option) => [option.value, option.disabled]);
    expect(Object.fromEntries(disabled)).toEqual({ dots: false, compact: true, ruler: true });
  });

  it.each(['compact', 'ruler'])(
    'turning node levels on from %s switches to nodes in the same write',
    async (timelineStyle) => {
      pluginState.current = {
        [plugin.id]: { enabled: true, installedAt: 0, settings: { timelineStyle } },
      };
      await render(plugin);
      const input = container.querySelector<HTMLInputElement>(
        'input[aria-label="enableMarkerLevel"]',
      )!;
      act(() => input.click());
      expect(setPluginSettings).toHaveBeenCalledExactlyOnceWith(plugin.id, {
        markerLevel: true,
        timelineStyle: 'dots',
        compactView: false,
      });
      expect(container.querySelector('select')!.value).toBe('dots');
    },
  );
});

describe('PluginSettings select setting', () => {
  it('keeps English option labels when a translation is missing', async () => {
    mockLanguage.current = 'zh';
    await render({
      ...widthPlugin,
      i18n: { zh: { settings: { placement: { options: { right: '右侧' } } } } },
      contributes: {
        settings: {
          placement: {
            type: 'select',
            label: 'Placement',
            default: 'right',
            options: [
              { value: 'constructor', label: 'Left' },
              { value: 'right', label: 'Right' },
            ],
          },
        },
      },
    });
    const select = container.querySelector('select')!;
    expect(Array.from(select.options, (option) => option.textContent)).toEqual(['Left', '右侧']);
  });

  it('lets a user choose a declared option and persists it immediately', async () => {
    await render({
      ...widthPlugin,
      contributes: {
        settings: {
          placement: {
            type: 'select',
            label: 'Placement',
            default: 'right',
            options: [
              { value: 'left', label: 'Left' },
              { value: 'right', label: 'Right' },
            ],
          },
        },
      },
    });
    const select = container.querySelector('select')!;
    expect(select.closest('label')?.textContent).toContain('Placement');
    expect(Array.from(select.options, (option) => option.textContent)).toEqual(['Left', 'Right']);
    expect(select.value).toBe('right');

    act(() => {
      select.value = 'left';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(select.value).toBe('left');
    expect(setPluginSettings).toHaveBeenCalledOnce();
    expect(setPluginSettings).toHaveBeenCalledWith(PLUGIN_ID, { placement: 'left' });
  });
});

describe('PluginSettings setting slider', () => {
  it('a slider stays disabled while its switch is off and keeps its value when toggled', async () => {
    const plugin: PluginManifest = {
      ...widthPlugin,
      contributes: {
        settings: {
          enabled: { type: 'boolean', label: 'Custom width', default: false },
          width: { ...widthPlugin.contributes.settings!.width, enabledBy: 'enabled' },
        },
      },
    };
    pluginState.current = {
      [plugin.id]: { enabled: true, installedAt: 0, settings: { width: 900 } },
    };
    await render(plugin);
    const slider = container.querySelector<HTMLInputElement>('input[type="range"]')!;
    const toggle = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(slider.disabled).toBe(true);
    expect(slider.value).toBe('900');
    expect(container.textContent).toContain('900');
    slider.focus();
    expect(document.activeElement).not.toBe(slider);
    expect(setPluginSettings).not.toHaveBeenCalled();

    act(() => toggle.click());
    expect(slider.disabled).toBe(false);
    expect(slider.value).toBe('900');
    expect(setPluginSettings).toHaveBeenLastCalledWith(plugin.id, { enabled: true });
    act(() => toggle.click());
    expect(slider.disabled).toBe(true);
    expect(slider.value).toBe('900');
    expect(container.textContent).toContain('900');
    expect(setPluginSettings).toHaveBeenLastCalledWith(plugin.id, { enabled: false });
  });

  it.each([undefined, false, 'true', true])(
    'enables dependent controls only when the resolved switch is true (stored %s)',
    async (stored) => {
      const plugin: PluginManifest = {
        ...widthPlugin,
        contributes: {
          settings: {
            enabled: { type: 'boolean', label: 'Enable controls', default: true },
            width: { ...widthPlugin.contributes.settings!.width, enabledBy: 'enabled' },
            checked: {
              type: 'boolean',
              label: 'Dependent switch',
              default: true,
              enabledBy: 'enabled',
            },
            placement: {
              type: 'select',
              label: 'Placement',
              default: 'right',
              enabledBy: 'enabled',
              options: [{ value: 'right', label: 'Right' }],
            },
          },
        },
      };
      if (stored !== undefined) {
        pluginState.current = {
          [plugin.id]: { enabled: true, installedAt: 0, settings: { enabled: stored } },
        };
      }
      await render(plugin);
      const checkbox = container.querySelector<HTMLInputElement>(
        'input[aria-label="Dependent switch"]',
      )!;
      const select = container.querySelector('select')!;
      const inputs = [
        container.querySelector<HTMLInputElement>('input[type="range"]')!,
        checkbox,
        select,
      ];
      for (const input of inputs)
        expect(input.disabled).toBe(stored === false || stored === 'true');
      expect(checkbox.checked).toBe(true);
      expect(select.value).toBe('right');
      expect(setPluginSettings).not.toHaveBeenCalled();
      const toggle = container.querySelector<HTMLInputElement>(
        'input[aria-label="Enable controls"]',
      )!;
      const wasDisabled = inputs[0].disabled;
      act(() => toggle.click());
      for (const input of inputs) expect(input.disabled).toBe(!wasDisabled);
      expect(checkbox.checked).toBe(true);
      expect(select.value).toBe('right');
    },
  );

  it('DeepSeek typography sliders follow their own switches without erasing saved values', async () => {
    const parsed = validateManifest({
      ...readingTypography,
      contributes: { ...readingTypography.contributes, styles: [] },
    });
    if (!parsed.success) throw new Error('invalid reading typography');
    const plugin = parsed.data;
    pluginState.current = {
      [plugin.id]: {
        enabled: true,
        installedAt: 0,
        settings: { fontSize: 117, lineHeight: 165, paragraphSpacing: 17 },
      },
    };
    await render(plugin);
    const sliders = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="range"]'));
    expect(sliders.map((input) => input.disabled)).toEqual([true, true, true]);
    expect(sliders.map((input) => input.value)).toEqual(['117', '165', '17']);
    const fontInput = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(fontInput.value).toBe('117');
    expect(fontInput.disabled).toBe(true);
    const switches = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    );
    act(() => switches[0].click());
    expect(sliders.map((input) => input.disabled)).toEqual([false, true, true]);
    expect(fontInput.disabled).toBe(false);
    act(() => switches[1].click());
    expect(sliders.map((input) => input.disabled)).toEqual([false, false, false]);
    act(() => switches[1].click());
    expect(sliders.map((input) => input.disabled)).toEqual([false, true, true]);
    expect(sliders.map((input) => input.value)).toEqual(['117', '165', '17']);
    expect(setPluginSettings.mock.calls.map(([, values]) => values)).toEqual([
      { fontSizeEnabled: true },
      { spacingEnabled: true },
      { spacingEnabled: false },
    ]);
  });

  it('renders localized range labels from the plugin i18n map', async () => {
    mockLanguage.current = 'zh';
    await render();

    expect(container.textContent).toContain('阅读宽度（px）');
    expect(container.textContent).toContain('768');
    expect(container.querySelector('input[type="number"]')).toBeNull();
    expect(container.textContent).toContain('更窄');
    expect(container.textContent).toContain('更宽');
    expect(container.textContent).not.toContain('Reading width (px)');
  });
});
describe('PluginSettings number input', () => {
  it('adds a precise number input for a range the slider cannot resolve', async () => {
    await render(wideNumberPlugin);
    const slider = container.querySelector<HTMLInputElement>('input[type="range"]')!;
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(input.value).toBe('0');
    expect(input.min).toBe('0');
    expect(input.max).toBe('10000');
    expect(input.getAttribute('aria-label')).toBe('chatgptProUsageWeeklyLimit');
    expect(input.disabled).toBe(false);

    act(() => nativeSetSliderValue(input, 100));
    expect(input.value).toBe('100');
    expect(slider.value).toBe('100');
    act(() => vi.advanceTimersByTime(200));
    expect(setPluginSetting).toHaveBeenLastCalledWith(PLUGIN_ID, 'weeklyLimit', 100);
  });

  it('keeps the number input in sync when the slider moves', async () => {
    await render(wideNumberPlugin);
    const slider = container.querySelector<HTMLInputElement>('input[type="range"]')!;
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!;

    act(() => nativeSetSliderValue(slider, 200));

    expect(input.value).toBe('200');
    act(() => vi.advanceTimersByTime(200));
    expect(setPluginSetting).toHaveBeenLastCalledWith(PLUGIN_ID, 'weeklyLimit', 200);
  });

  it('clamps an out-of-range value on blur and restores it when cleared', async () => {
    await render(wideNumberPlugin);
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!;

    act(() => nativeSetSliderValue(input, 20_000));
    expect(input.value).toBe('20000');
    expect(setPluginSetting).not.toHaveBeenCalled();

    act(() => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(input.value).toBe('10000');
    act(() => vi.advanceTimersByTime(200));
    expect(setPluginSetting).toHaveBeenLastCalledWith(PLUGIN_ID, 'weeklyLimit', 10_000);

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.value).toBe('');
    act(() => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(input.value).toBe('10000');
    expect(setPluginSetting).toHaveBeenCalledTimes(1);
  });

  it('clamps a below-minimum value on Enter', async () => {
    pluginState.current = {
      [PLUGIN_ID]: { enabled: true, installedAt: 0, settings: { weeklyLimit: 50 } },
    };
    await render(wideNumberPlugin);
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!;

    act(() => nativeSetSliderValue(input, -5));
    expect(input.value).toBe('-5');
    expect(setPluginSetting).not.toHaveBeenCalled();

    act(() => {
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(input.value).toBe('0');
    act(() => vi.advanceTimersByTime(200));
    expect(setPluginSetting).toHaveBeenLastCalledWith(PLUGIN_ID, 'weeklyLimit', 0);
  });

  it('shows the hint of a number setting the way switch settings do', async () => {
    mockMessages.current = {
      chatgptProUsageWeeklyLimit: 'Weekly Pro allowance',
      chatgptProUsageWeeklyLimitHint: 'Leave at 0 to set it automatically.',
    };
    await render(wideNumberPlugin);

    expect(container.textContent).toContain('Weekly Pro allowance');
    expect(container.textContent).toContain('Leave at 0 to set it automatically.');
  });
});
describe('PluginSettings boolean setting', () => {
  it('renders a localized switch and persists changes immediately', async () => {
    mockLanguage.current = 'zh';
    await render(compactTimelinePlugin);

    const input = container.querySelector('input[aria-label="使用紧凑索引"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.checked).toBe(false);

    act(() => input.click());

    expect(input.checked).toBe(true);
    expect(setPluginSettings).toHaveBeenCalledOnce();
    expect(setPluginSettings).toHaveBeenCalledWith(PLUGIN_ID, { compactView: true });
  });
});
