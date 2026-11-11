import './pluginManagerHarness';
import React, { act } from 'react';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import enMessages from '@locales/en/messages.json';

import { BUILTIN_PLUGINS } from '@/features/plugins/builtin';
import { VISUAL_EFFECTS_MANIFEST } from '@/features/plugins/builtin/visualEffectsManifest';
import type { PluginStatus } from '@/features/plugins/runtime/pluginStatus';
import type { PluginManifest } from '@/features/plugins/types';

import { PluginManager, type PluginManagerProps } from '../PluginManager';
import {
  container,
  root,
  widthPlugin,
  compactTimelinePlugin,
  PLUGIN_ID,
  pluginState,
  mockMessages,
  setPluginSetting,
  setPluginSettings,
  nativeSetSliderValue,
  render,
  renderManager,
  resetRoot,
} from './pluginManagerHarness';

describe('PluginManager setting persistence', () => {
  it('debounces rapid drag changes into a single storage write with the final value', async () => {
    await render();
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider).toBeTruthy();

    act(() => {
      for (const v of [800, 900, 1000, 1100, 1300]) nativeSetSliderValue(slider, v);
    });

    // Mid-drag: nothing persisted yet.
    expect(setPluginSetting).not.toHaveBeenCalled();

    // After the debounce window: exactly one write, carrying the last value.
    act(() => vi.advanceTimersByTime(200));
    expect(setPluginSetting).toHaveBeenCalledTimes(1);
    expect(setPluginSetting).toHaveBeenCalledWith(PLUGIN_ID, 'width', 1300);
  });

  it('flushes a pending write when the popup unmounts mid-drag', async () => {
    await render();
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;

    act(() => nativeSetSliderValue(slider, 1024));
    expect(setPluginSetting).not.toHaveBeenCalled();

    act(() => root.unmount());

    expect(setPluginSetting).toHaveBeenCalledTimes(1);
    expect(setPluginSetting).toHaveBeenCalledWith(PLUGIN_ID, 'width', 1024);
  });
});

describe('PluginManager accessible groups', () => {
  it('omits the visual effects row on Claude while keeping other plugin rows', async () => {
    await renderManager({
      manifests: [VISUAL_EFFECTS_MANIFEST, widthPlugin],
      activeUrl: 'https://claude.ai/',
    });

    expect(container.querySelector('input[aria-label="Test · Width"]')).not.toBeNull();
    expect(container.textContent).not.toContain(VISUAL_EFFECTS_MANIFEST.name);
    expect(container.querySelector('input[aria-label="Visual effects"]')).toBeNull();
    expect(container.querySelector('select')).toBeNull();
  });

  it('groups identically named controls under their owning plugins', async () => {
    const second: PluginManifest = {
      ...widthPlugin,
      id: 'voyager.second-width',
      name: 'ChatGPT · Width',
      matches: ['https://chatgpt.com/*'],
    };
    pluginState.current[second.id] = { enabled: true, installedAt: 0 };
    await act(async () => {
      root.render(React.createElement(PluginManager, { manifests: [widthPlugin, second] }));
    });
    const groups = Array.from(container.querySelectorAll('[role="group"]'));
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
      'Test · Width',
      'ChatGPT · Width',
    ]);
    for (const group of groups) {
      expect(group.querySelector('input[type="range"]')?.getAttribute('aria-label')).toBe(
        'Reading width (px)',
      );
    }
  });
});

describe('PluginManager timeline rail options', () => {
  const official = BUILTIN_PLUGINS.find((plugin) => plugin.id === 'voyager.chatgpt-timeline')!;
  const dedicated = {
    pluginId: official.id,
    settingKeys: ['timelineStyle', 'markerLevel'],
    render: () => null,
  };

  it('opens the rail options under its own row only while it is on, with the settings it took', async () => {
    const render = vi.fn((owned: readonly string[], name: string) => (
      <p data-testid="rail-options">{`${name}: ${owned.join(',')}`}</p>
    ));
    const local: PluginManifest = { ...official, id: 'local.me.rail', name: 'My rail' };
    pluginState.current[official.id] = { enabled: true, installedAt: 0 };
    pluginState.current[local.id] = { enabled: true, installedAt: 0 };
    await renderManager({
      manifests: [official, local],
      sourceIds: { [official.id]: 'builtin', [local.id]: 'local' },
      timelineRail: { ...dedicated, render },
    });
    expect(
      [...container.querySelectorAll('[data-testid="rail-options"]')].map((el) => el.textContent),
    ).toEqual(['ChatGPT · Timeline: timelineStyle,markerLevel']);

    // A local rail keeps its own controls, so the options take none of them.
    await renderManager({
      manifests: [local],
      sourceIds: { [local.id]: 'local' },
      timelineRail: { ...dedicated, pluginId: local.id, render },
    });
    expect(container.querySelector('[data-testid="rail-options"]')!.textContent).toBe('My rail: ');
  });

  it('still offers the rail options while the rail is off, and says it is off', async () => {
    const render = vi.fn((_owned: readonly string[], _name: string, on: boolean) => (
      <p data-testid="rail-options">{String(on)}</p>
    ));
    pluginState.current[official.id] = { enabled: false, installedAt: 0 };
    await renderManager({
      manifests: [official],
      sourceIds: { [official.id]: 'builtin' },
      timelineRail: { ...dedicated, render },
    });
    expect(container.querySelector('[data-testid="rail-options"]')!.textContent).toBe('false');
  });

  it('keeps local rail controls and other catalog fields editable', async () => {
    const catalog: PluginManifest = {
      ...official,
      contributes: {
        ...official.contributes,
        settings: {
          ...official.contributes.settings,
          density: { type: 'boolean', label: 'Dense rail', default: false },
        },
      },
    };
    const local: PluginManifest = { ...official, id: 'local.me.rail', name: 'My rail' };
    const other: PluginManifest = { ...official, id: 'voyager.other-rail', name: 'Other rail' };
    for (const plugin of [catalog, local, other])
      pluginState.current[plugin.id] = { enabled: true, installedAt: 0 };
    await renderManager({
      manifests: [catalog, local, other],
      sourceIds: { [catalog.id]: 'builtin', [local.id]: 'local', [other.id]: 'host-catalog' },
      timelineRail: dedicated,
    });
    const catalogGroup = container.querySelector(
      '[role="group"][aria-label="ChatGPT · Timeline"]',
    )!;
    expect(catalogGroup.querySelector('select')).toBeNull();
    expect(catalogGroup.querySelector('input[aria-label="enableMarkerLevel"]')).toBeNull();
    const density = catalogGroup.querySelector<HTMLInputElement>('input[aria-label="Dense rail"]')!;
    expect(density).toBeTruthy();
    act(() => density.click());
    expect(setPluginSettings).toHaveBeenLastCalledWith(catalog.id, { density: true });
    for (const name of ['My rail', 'Other rail']) {
      const group = container.querySelector(`[role="group"][aria-label="${name}"]`)!;
      expect(group.querySelector('select')).toBeTruthy();
      expect(group.querySelector('input[aria-label="enableMarkerLevel"]')).toBeTruthy();
    }
  });

  it.each([
    'no card',
    'unknown source',
    'another rail',
    'extra style',
    'custom rail named constructor',
  ])('keeps the plugin style accessible with %s', async (scenario) => {
    const plugin: PluginManifest =
      scenario === 'extra style'
        ? {
            ...official,
            contributes: {
              ...official.contributes,
              settings: {
                ...official.contributes.settings,
                timelineStyle: {
                  ...official.contributes.settings!.timelineStyle,
                  options: [
                    ...official.contributes.settings!.timelineStyle.options!,
                    { value: 'custom', label: 'Custom' },
                  ],
                },
              },
            },
          }
        : scenario === 'custom rail named constructor'
          ? { ...official, id: 'constructor' }
          : official;
    pluginState.current[plugin.id] = { enabled: true, installedAt: 0 };
    await renderManager({
      manifests: [plugin],
      sourceIds:
        scenario === 'unknown source'
          ? undefined
          : {
              [plugin.id]:
                scenario === 'custom rail named constructor' ? 'host-catalog' : 'builtin',
            },
      timelineRail:
        scenario === 'no card'
          ? undefined
          : {
              ...dedicated,
              pluginId: scenario === 'another rail' ? 'voyager.another-rail' : plugin.id,
            },
    });
    const select = container.querySelector('select')!;
    expect(select).toBeTruthy();
    act(() => {
      select.value = 'compact';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(setPluginSettings).toHaveBeenLastCalledWith(plugin.id, {
      timelineStyle: 'compact',
      compactView: true,
    });
  });
});

describe('PluginManager plugin status', () => {
  const READY: PluginStatus = { id: PLUGIN_ID, version: widthPlugin.version, kind: 'ready' };

  function pluginToggle(): HTMLInputElement {
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Test · Width"]');
    if (!input) throw new Error('Expected the plugin toggle');
    return input;
  }

  beforeEach(() => {
    mockMessages.current = {
      pluginNeedsNewerVoyager: enMessages.pluginNeedsNewerVoyager.message,
      pluginNeedsVoyagerUpdate: enMessages.pluginNeedsVoyagerUpdate.message,
      pluginUnavailableOnMobile: enMessages.pluginUnavailableOnMobile.message,
      pluginNeedsSiteAdapterUpdate: enMessages.pluginNeedsSiteAdapterUpdate.message,
      pluginNoEffectOnPage: enMessages.pluginNoEffectOnPage.message,
      pluginUpdateAfterReload: enMessages.pluginUpdateAfterReload.message,
    };
  });

  it('names the engine range, blocks enabling for needs-engine and still lets an enabled plugin be switched off', async () => {
    const statuses: PluginManagerProps['statuses'] = [
      { ...READY, kind: 'needs-engine', requiredEngine: '>=2.0.0' },
    ];
    await renderManager({ statuses });

    expect(container.textContent).toContain('Needs Voyager >=2.0.0');
    expect(container.textContent).not.toContain('{engine}');
    // Enabled in storage: turning it off is the one action that still makes sense.
    expect(pluginToggle().disabled).toBe(false);

    pluginState.current = { [PLUGIN_ID]: { enabled: false, installedAt: 0 } };
    await act(async () => root.unmount());
    resetRoot();
    await renderManager({ statuses });
    expect(pluginToggle().disabled).toBe(true);
  });

  it('falls back to the manifest engine range when the status omits it', async () => {
    await renderManager({ statuses: [{ ...READY, kind: 'needs-engine' }] });

    expect(container.textContent).toContain('Needs Voyager >=1.0.0');
  });

  it('asks for a newer Voyager without a version for needs-handler', async () => {
    pluginState.current = { [PLUGIN_ID]: { enabled: false, installedAt: 0 } };
    await renderManager({
      statuses: [{ ...READY, kind: 'needs-handler', missingHandlers: ['formula-copy'] }],
    });

    expect(container.textContent).toContain('Needs a newer Voyager to run');
    expect(pluginToggle().disabled).toBe(true);
  });

  it('says a phone cannot run it and blocks enabling there', async () => {
    pluginState.current = { [PLUGIN_ID]: { enabled: false, installedAt: 0 } };
    await renderManager({
      statuses: [{ ...READY, kind: 'needs-form-factor', formFactor: 'mobile' }],
    });

    expect(container.textContent).toContain('Not available on phones yet');
    expect(pluginToggle().disabled).toBe(true);
  });

  it('names the active site for needs-semantic and blocks enabling', async () => {
    pluginState.current = { [PLUGIN_ID]: { enabled: false, installedAt: 0 } };
    await renderManager({
      activeUrl: 'https://claude.ai/chat/current',
      statuses: [{ ...READY, kind: 'needs-semantic', missingSemantic: ['message'] }],
    });

    expect(container.textContent).toContain('Needs an updated Claude adapter');
    expect(container.textContent).not.toContain('{site}');
    expect(pluginToggle().disabled).toBe(true);
  });

  it('falls back to the host when no site adapter names the active URL', async () => {
    await renderManager({
      activeUrl: 'https://unknown.example.org/chat',
      statuses: [{ ...READY, kind: 'needs-semantic', missingSemantic: ['message'] }],
    });

    expect(container.textContent).toContain('Needs an updated unknown.example.org adapter');
  });

  it('warns about a no-effect plugin while leaving the toggle usable', async () => {
    await renderManager({ statuses: [{ ...READY, kind: 'no-effect' }] });

    expect(container.textContent).toContain('Found nothing to act on in this page');
    expect(pluginToggle().disabled).toBe(false);
  });

  it('says a pending update applies after a reload, naming the version', async () => {
    await renderManager({
      statuses: [{ ...READY, kind: 'mounted', pendingVersion: '2.1.0' }],
    });

    expect(container.textContent).toContain('Update 2.1.0 applies after you reload the page');
    expect(container.textContent).not.toContain('{version}');
    expect(pluginToggle().disabled).toBe(false);
  });

  it('keeps the plain toggle for a mounted plugin and for one the tab never reported', async () => {
    await renderManager({ statuses: [{ ...READY, kind: 'mounted' }] });
    expect(pluginToggle().disabled).toBe(false);
    expect(container.textContent).not.toContain('Needs');

    await renderManager({ statuses: [] });
    expect(pluginToggle().disabled).toBe(false);
    expect(container.textContent).not.toContain('Needs');
    expect(container.textContent).not.toContain('Found nothing to act on');
  });

  it('ignores a status reported for a different plugin', async () => {
    await renderManager({
      statuses: [{ id: 'voyager.other', version: '1.0.0', kind: 'needs-handler' }],
    });

    expect(pluginToggle().disabled).toBe(false);
    expect(container.textContent).not.toContain('Needs a newer Voyager to run');
  });
});

describe('PluginManager passes its props to each plugin card', () => {
  it('shows provenance, the held-back update and the catalog switch, and collapses the card', async () => {
    mockMessages.current = {
      pluginUpdateNeedsNewerVoyager: enMessages.pluginUpdateNeedsNewerVoyager.message,
    };
    await renderManager({
      sourceIds: { [PLUGIN_ID]: 'host-catalog' },
      blockedUpdates: { [PLUGIN_ID]: { version: '2.4.0', engine: '>=9.0.0' } },
      catalogHost: 'claude.ai',
    });

    expect(container.textContent).toContain(`v${widthPlugin.version} · pluginSourceOnline`);
    expect(container.textContent).toContain('2.4.0');
    expect(container.querySelector('input[aria-label="pluginsOnlineUpdates"]')).toBeTruthy();

    const header = container.querySelector<HTMLButtonElement>('button[aria-expanded]');
    expect(header?.getAttribute('aria-expanded')).toBe('true');
    act(() => header?.click());
    expect(header?.getAttribute('aria-expanded')).toBe('false');
  });

  it('persists a boolean setting immediately', async () => {
    await renderManager({ manifests: [compactTimelinePlugin] });

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Use compact timeline"]',
    );
    act(() => input?.click());

    expect(setPluginSettings).toHaveBeenCalledOnce();
    expect(setPluginSettings).toHaveBeenCalledWith(PLUGIN_ID, { compactView: true });
  });
});
