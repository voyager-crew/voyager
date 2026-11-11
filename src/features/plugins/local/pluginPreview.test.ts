import { describe, expect, it } from 'vitest';

import type { PluginManifest } from '../types';
import { authoringSites } from './authoringSites';
import { previewPlugin } from './pluginPreview';
import { validateLocalManifest } from './validateLocalManifest';

function gated(raw: Record<string, unknown>): PluginManifest {
  const result = validateLocalManifest(raw);
  if (!result.success) throw new Error(JSON.stringify(result.error));
  return result.data.manifest;
}

const base = {
  id: 'me.tidy',
  name: 'Tidy Claude',
  version: '1.0.0',
  description: 'Narrower messages, no sidebar',
  author: 'me',
  category: 'layout',
  license: 'MIT',
  engine: '>=1.0.0',
  tier: 'declarative',
  matches: ['https://claude.ai/*', 'https://*.frame.claudeusercontent.com/*'],
};

const site = (id: string) => authoringSites().find((candidate) => candidate.id === id) ?? null;

describe('plain-language plugin preview', () => {
  it('lists the site once, every change in order, and its CSS in full', () => {
    const preview = previewPlugin(
      gated({
        ...base,
        contributes: {
          styles: [{ css: '.gv-plugin-narrow{max-width:720px}' }, { css: '.gv-plugin-x{}' }],
          domOps: [
            {
              op: 'addClass',
              target: { kind: 'semantic', key: 'userTurn' },
              className: 'gv-plugin-narrow',
            },
            {
              op: 'setStyle',
              target: { kind: 'semantic', key: 'composer' },
              styles: { 'max-width': '720px', margin: '0 auto' },
            },
          ],
        },
      }),
      { targetSite: site('claude') },
    );
    expect(preview.name).toBe('Tidy Claude');
    expect(preview.sites).toEqual(['Claude']);
    expect(preview.changes).toEqual([
      { kind: 'css', chars: 48 },
      {
        kind: 'addClass',
        target: { kind: 'semantic', key: 'userTurn' },
        className: 'gv-plugin-narrow',
      },
      {
        kind: 'setStyle',
        target: { kind: 'semantic', key: 'composer' },
        styles: 'max-width: 720px; margin: 0 auto',
      },
    ]);
    // CSS can do anything, so it is shown in full and never summarized away.
    expect(preview.css).toEqual(['.gv-plugin-narrow{max-width:720px}', '.gv-plugin-x{}']);
    expect(preview.warnings).toEqual([{ kind: 'css' }]);
  });

  it('says plainly that CSS is not summarized, even when it hides the page', () => {
    const preview = previewPlugin(
      gated({ ...base, contributes: { styles: [{ css: 'main{display:none!important}' }] } }),
    );
    expect(preview.css).toEqual(['main{display:none!important}']);
    expect(preview.warnings).toEqual([{ kind: 'css' }]);
  });

  it('warns about hiding through setStyle and the hidden or style attribute', () => {
    const hiding = (domOp: Record<string, unknown>) =>
      previewPlugin(gated({ ...base, contributes: { domOps: [domOp] } })).warnings;
    const composer = { kind: 'semantic', key: 'composer' };
    for (const styles of [
      { display: 'none' },
      { DISPLAY: ' None !important' },
      { visibility: 'hidden' },
      { visibility: 'collapse' },
      { opacity: '0' },
      { opacity: '0.0%' },
      { 'content-visibility': 'hidden' },
      { display: 'var(--gv-x)' },
    ]) {
      expect(hiding({ op: 'setStyle', target: composer, styles }), JSON.stringify(styles)).toEqual([
        { kind: 'hides' },
      ]);
    }
    expect(hiding({ op: 'setAttribute', target: composer, name: 'hidden', value: '' })).toEqual([
      { kind: 'hides' },
    ]);
    expect(
      hiding({
        op: 'setAttribute',
        target: composer,
        name: 'style',
        value: 'color:red; display : none',
      }),
    ).toEqual([{ kind: 'hides' }]);
    for (const styles of [{ display: 'flex' }, { opacity: '0.8' }, { visibility: 'visible' }]) {
      expect(hiding({ op: 'setStyle', target: composer, styles }), JSON.stringify(styles)).toEqual(
        [],
      );
    }
    expect(
      hiding({ op: 'setAttribute', target: composer, name: 'aria-hidden', value: 'true' }),
    ).toEqual([]);
  });

  it('reads hiding values through CSS comments and escapes', () => {
    const hiding = (domOp: Record<string, unknown>) =>
      previewPlugin(gated({ ...base, contributes: { domOps: [domOp] } })).warnings;
    const composer = { kind: 'semantic', key: 'composer' };
    for (const styles of [
      { display: '/**/none' },
      { display: 'n\\6f ne' },
      { display: 'n\\6F\tne' },
      { display: '\\6e one' },
      { display: 'none/* still none */' },
      { visibility: 'hid\\64 en' },
      { opacity: '/**/0' },
      { opacity: '\\30' },
      { display: 'no/**/ne' },
    ]) {
      expect(hiding({ op: 'setStyle', target: composer, styles }), JSON.stringify(styles)).toEqual([
        { kind: 'hides' },
      ]);
    }
    for (const value of [
      'display:/**/none',
      'display:n\\6f ne',
      'displ\\61y: none',
      'display/**/:none',
      '/* ; */display:none',
      '--x:"/*";display:none;--y:"*/"',
      'color:red;/*;*/display:none',
      'visibility:/*x*/hidden',
    ]) {
      expect(hiding({ op: 'setAttribute', target: composer, name: 'style', value }), value).toEqual(
        [{ kind: 'hides' }],
      );
    }
  });

  it('warns on a global keyword, whose result depends on the cascade', () => {
    // `visibility:inherit` under a hidden ancestor hides a child the page made visible.
    const warnings = (domOp: Record<string, unknown>) =>
      previewPlugin(gated({ ...base, contributes: { domOps: [domOp] } })).warnings;
    const composer = { kind: 'semantic', key: 'composer' };
    for (const property of ['display', 'visibility', 'opacity', 'content-visibility']) {
      for (const keyword of ['inherit', 'initial', 'unset', 'revert', 'revert-layer', 'INHERIT']) {
        const styles = { [property]: keyword };
        expect(
          warnings({ op: 'setStyle', target: composer, styles }),
          JSON.stringify(styles),
        ).toEqual([{ kind: 'hides' }]);
        const value = `color:red;${property}:/**/${keyword}`;
        expect(
          warnings({ op: 'setAttribute', target: composer, name: 'style', value }),
          value,
        ).toEqual([{ kind: 'hides' }]);
      }
    }
  });

  it('warns when a value on a hiding property cannot be read with confidence', () => {
    const hiding = (styles: Record<string, unknown>) =>
      previewPlugin(
        gated({
          ...base,
          contributes: {
            domOps: [{ op: 'setStyle', target: { kind: 'semantic', key: 'composer' }, styles }],
          },
        }),
      ).warnings;
    for (const styles of [
      { display: 'revert-layer' },
      { display: 'nothing-known' },
      { opacity: '1e-3' },
      { opacity: '.05' },
      { visibility: 'whatever' },
      { 'content-visibility': 'hidden-matchable' },
      // A column box renders none of its content.
      { display: 'table-column' },
      { display: 'table-column-group' },
    ]) {
      expect(hiding(styles), JSON.stringify(styles)).toEqual([{ kind: 'hides' }]);
    }
    for (const styles of [
      { display: 'inline-block' },
      { display: 'block flow' },
      { display: 'contents' },
      { opacity: '50%' },
      { opacity: '1 !important' },
      { 'content-visibility': 'auto' },
      { '--gv-plugin-x': 'none' },
    ]) {
      expect(hiding(styles), JSON.stringify(styles)).toEqual([]);
    }
  });

  it('shows inline style values in full, so a long one cannot push a hiding declaration out of view', () => {
    const padding = `--gv-plugin-pad:${'0 '.repeat(150)}`;
    const value = `${padding};display:none`;
    const preview = previewPlugin(
      gated({
        ...base,
        contributes: {
          domOps: [
            {
              op: 'setAttribute',
              target: { kind: 'semantic', key: 'composer' },
              name: 'style',
              value,
            },
            {
              op: 'setStyle',
              target: { kind: 'semantic', key: 'userTurn' },
              styles: { '--gv-plugin-pad': '0 '.repeat(150).trim(), display: 'none' },
            },
          ],
        },
      }),
    );
    expect(preview.changes).toContainEqual({
      kind: 'setAttribute',
      target: { kind: 'semantic', key: 'composer' },
      name: 'style',
      value,
    });
    expect(preview.changes).toContainEqual({
      kind: 'setStyle',
      target: { kind: 'semantic', key: 'userTurn' },
      styles: `--gv-plugin-pad: ${'0 '.repeat(150).trim()}; display: none`,
    });
    expect(preview.warnings).toContainEqual({ kind: 'hides' });
  });

  it('warns about hiding, raw selectors, the wrong site and a replaced version', () => {
    const preview = previewPlugin(
      gated({
        ...base,
        contributes: { domOps: [{ op: 'hide', target: 'nav[aria-label]' }] },
      }),
      { targetSite: site('chatgpt'), previousVersion: '0.9.0' },
    );
    expect(preview.changes).toEqual([
      { kind: 'hide', target: { kind: 'css', selector: 'nav[aria-label]' } },
    ]);
    expect(preview.css).toEqual([]);
    expect(preview.warnings).toEqual([
      { kind: 'replaces', version: '0.9.0' },
      { kind: 'not-on-site', site: 'ChatGPT' },
      { kind: 'hides' },
      { kind: 'raw-selector' },
    ]);
  });

  it('flags a theme the prompt asked the AI to leave out, but not a primitive it offers', () => {
    const preview = previewPlugin(
      gated({
        ...base,
        engine: '>=1.4.0',
        theme: { brand: '#112233' },
        requires: { handlers: ['formulaCopy'] },
        contributes: { domOps: [{ op: 'native', handler: 'formulaCopy', params: {} }] },
      }),
    );
    expect(preview.changes).toEqual([
      { kind: 'native', handler: 'formulaCopy' },
      { kind: 'theme', brand: '#112233' },
    ]);
    expect(preview.warnings).toEqual([{ kind: 'theme' }]);
  });
});
