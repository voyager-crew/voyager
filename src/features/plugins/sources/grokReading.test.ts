import { afterEach, describe, expect, it } from 'vitest';

import { requireBundledSiteAdapter } from '../catalog/sites';
import { DeclarativeEngine } from '../runtime/declarativeEngine';
import type { PluginManifest, PluginSettingValue } from '../types';
import { BundledCatalogPluginSource } from './BundledCatalogPluginSource';

// Grok's page as measured live (2026-11-17): the [data-chat-width] wrapper
// carries --grok-page-max-width inline (800px), which the plugin's !important
// rule beats in a browser; jsdom lets the inline value win, so the fixture omits
// it. The answer's markdown row holds <p>, lists and tables at 15px; block math
// sits in a span beside the paragraphs.
const PAGE =
  '<aside id="app-sidebar"></aside>' +
  '<div id="wrap" data-chat-width="medium">' +
  '<div data-testid="user-message" role="article"><p id="user">Question</p></div>' +
  '<div data-testid="assistant-message" role="article">' +
  '<div data-testid="conversation-thought"><div data-markdown-row=""><p id="think">Thinking</p></div></div>' +
  '<div data-markdown-row=""><div>' +
  '<p id="first">First</p>' +
  '<ul><li id="item">Item<ul><li id="nested">Nested</li></ul></li></ul>' +
  '<span><span class="katex-display" id="block-math"><span class="katex">y</span></span></span>' +
  '<table><tbody><tr><td id="cell">Cell</td></tr></tbody></table>' +
  '<div><pre id="pre"><code id="code">x = 1</code></pre></div>' +
  '<p id="last">Last</p>' +
  '</div></div></div></div>';

const TYPOGRAPHY_OFF = {
  fontSizeEnabled: false,
  fontSize: 100,
  spacingEnabled: false,
  lineHeight: 160,
  paragraphSpacing: 16,
};

// jsdom leaves var() unresolved; the plugins set their variables on <body>.
const applied = (id: string, property: string) =>
  getComputedStyle(document.getElementById(id)!)
    .getPropertyValue(property)
    .replace(
      /var\((--[\w-]+)(?:,\s*([^)]+))?\)/g,
      (_, name: string, fallback = '') => document.body.style.getPropertyValue(name) || fallback,
    )
    .replace(/\s+/g, ' ')
    .replace(/\( | \)/g, (m) => m.trim());

async function mount(id: string, settings: Readonly<Record<string, PluginSettingValue>>) {
  const manifest = (await new BundledCatalogPluginSource().list()).find(
    (m): m is PluginManifest => m.id === id,
  );
  if (!manifest) throw new Error(`Missing bundled ${id}`);
  document.body.innerHTML = PAGE;
  const engine = new DeclarativeEngine({
    doc: document,
    adapter: requireBundledSiteAdapter('grok'),
  });
  engine.mount(manifest, settings);
  return engine;
}

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.body.removeAttribute('style');
  document.body.removeAttribute('class');
});

describe('Grok reading width', () => {
  it("replaces Grok's page width, which sizes the column, user bubble and composer together", async () => {
    const engine = await mount('voyager.grok-reading-width', { width: 1200 });
    try {
      expect(document.body.style.getPropertyValue('--gv-plugin-reading-width')).toBe('1200px');
      expect(applied('wrap', '--grok-page-max-width')).toBe('1200px');

      engine.unmountAll();
      expect(applied('wrap', '--grok-page-max-width')).toBe('');
    } finally {
      engine.unmountAll();
    }
  });
});

describe('Grok reading typography', () => {
  it('scales answer paragraphs, list items and cells from their native 15px', async () => {
    const engine = await mount('voyager.grok-reading-typography', {
      ...TYPOGRAPHY_OFF,
      fontSizeEnabled: true,
      fontSize: 125,
    });
    try {
      for (const id of ['first', 'item', 'nested', 'cell', 'last']) {
        expect(applied(id, 'font-size'), id).toBe('calc(15px * 125 / 100)');
        expect(applied(id, 'line-height'), id).toBe('1.6em');
      }
    } finally {
      engine.unmountAll();
    }
  });

  it('keeps thinking, code, block formulas and user messages native', async () => {
    const engine = await mount('voyager.grok-reading-typography', {
      fontSizeEnabled: true,
      fontSize: 150,
      spacingEnabled: true,
      lineHeight: 200,
      paragraphSpacing: 8,
    });
    try {
      for (const id of ['think', 'pre', 'code', 'block-math', 'user']) {
        expect(applied(id, 'font-size'), id).toBe('');
        expect(applied(id, 'line-height'), id).toBe('');
      }
      expect(applied('first', 'margin-block-end')).toBe('8px');
      for (const id of ['think', 'user', 'last']) {
        expect(applied(id, 'margin-block-end'), id).toBe('');
      }
    } finally {
      engine.unmountAll();
    }
  });

  it('leaves answers native while both switches are off', async () => {
    const engine = await mount('voyager.grok-reading-typography', TYPOGRAPHY_OFF);
    try {
      for (const id of ['first', 'item', 'cell']) {
        expect(applied(id, 'font-size'), id).toBe('');
        expect(applied(id, 'line-height'), id).toBe('');
      }
    } finally {
      engine.unmountAll();
    }
  });
});
