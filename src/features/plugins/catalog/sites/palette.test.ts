/**
 * The six `voyager.<site>-palette` plugins: one palette on every site, every
 * public theme role set in both Nord palettes, and each option resolving on a
 * light and a dark page the way the README promises.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { THEME_VARIABLES, themeVariableName } from '@/core/ui/themeVariables';
import { VOYAGER_PALETTES, type VoyagerPalette } from '@/core/utils/voyagerPaletteValues';

import { DeclarativeEngine } from '../../runtime/declarativeEngine';
import { BundledCatalogPluginSource } from '../../sources/BundledCatalogPluginSource';
import type { PluginManifest } from '../../types';

const SITES = ['gemini', 'aistudio', 'claude', 'chatgpt', 'deepseek', 'kimi'] as const;

let palettes: PluginManifest[];

beforeAll(async () => {
  const bundled = await new BundledCatalogPluginSource().list();
  palettes = SITES.map((site) => {
    const manifest = bundled.find((m) => m.id === `voyager.${site}-palette`);
    if (!manifest) throw new Error(`voyager.${site}-palette is not bundled`);
    return manifest;
  });
});

afterEach(() => {
  document.head.innerHTML = '';
  document.documentElement.removeAttribute('data-gv-scheme');
});

function css(manifest: PluginManifest): string {
  return (manifest.contributes.styles ?? []).map((style) => style.css ?? '').join('\n');
}

function themeValues(): Record<string, string> {
  const computed = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    THEME_VARIABLES.map(({ role }) => [
      role,
      computed.getPropertyValue(themeVariableName(role)).trim(),
    ]),
  );
}

function probe(manifest: PluginManifest, scheme: 'light' | 'dark', palette: VoyagerPalette) {
  document.documentElement.setAttribute('data-gv-scheme', scheme);
  const engine = new DeclarativeEngine({ doc: document });
  engine.mount(manifest, { palette });
  const values = themeValues();
  void engine.unmount(manifest.id);
  return values;
}

describe('the Voyager palette plugins', () => {
  it('ship one stylesheet and one palette choice on every site, Nord following the page first', () => {
    const [first] = palettes;
    for (const manifest of palettes) {
      expect(css(manifest)).toBe(css(first));
      const setting = manifest.contributes.settings?.palette;
      expect(setting?.type).toBe('select');
      expect(setting?.options?.map((option) => option.value)).toEqual([...VOYAGER_PALETTES]);
      expect(setting?.default).toBe(VOYAGER_PALETTES[0]);
    }
  });

  it('set every public theme role, and nothing else, in both Nord palettes', () => {
    const declared = [...css(palettes[0]).matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]);
    const roles = THEME_VARIABLES.map(({ role }) => themeVariableName(role));
    expect([...new Set(declared)].sort()).toEqual([...roles].sort());
    expect(declared).toHaveLength(roles.length * 2);
  });

  it('follow the page with nord and force their own scheme with nord-dark and nord-light', () => {
    const manifest = palettes[0];
    const light = probe(manifest, 'light', 'nord-light');
    const dark = probe(manifest, 'dark', 'nord-dark');
    expect(light.surface).toBe('#eceff4');
    expect(dark.surface).toBe('#2e3440');
    expect(dark.timeline).toBe('#d8dee9');
    for (const role of Object.keys(light)) {
      expect(light[role], role).not.toBe('');
      expect(dark[role], role).not.toBe('');
    }

    expect(probe(manifest, 'light', 'nord')).toEqual(light);
    expect(probe(manifest, 'dark', 'nord')).toEqual(dark);
    expect(probe(manifest, 'light', 'nord-dark')).toEqual(dark);
    expect(probe(manifest, 'dark', 'nord-light')).toEqual(light);
  });

  it('leave no theme role set once switched off', () => {
    const manifest = palettes[0];
    document.documentElement.setAttribute('data-gv-scheme', 'dark');
    const engine = new DeclarativeEngine({ doc: document });
    engine.mount(manifest, { palette: 'nord-dark' });
    void engine.unmount(manifest.id);

    expect(document.documentElement.hasAttribute('data-gv-palette')).toBe(false);
    expect(Object.values(themeValues()).every((value) => value === '')).toBe(true);
  });
});
