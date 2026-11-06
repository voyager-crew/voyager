import { afterEach, describe, expect, it } from 'vitest';

import { DeclarativeEngine } from '../runtime/declarativeEngine';
import { deepseekAdapter } from '../sites/adapters/deepseek';
import type { PluginManifest } from '../types';
import { BundledCatalogPluginSource } from './BundledCatalogPluginSource';

const ID = 'voyager.deepseek-reading-typography';
const OFF = {
  fontSizeEnabled: false,
  fontSize: 100,
  spacingEnabled: false,
  lineHeight: 160,
  paragraphSpacing: 16,
};

const PAGE =
  '<textarea>composer</textarea>' +
  '<div class="ds-message"><div class="ds-collapsible-text"><p id="user">User</p></div></div>' +
  '<div id="answer" class="ds-message" data-gv-spacing="host">' +
  '<div class="ds-think-content"><p id="think">Thinking</p></div>' +
  '<div class="ds-assistant-message-main-content">' +
  '<p id="first">First</p>' +
  '<p id="inline">Run <code id="inline-code">bun test</code> for <span class="katex">x</span></p>' +
  '<ul><li id="item">Item<ul><li id="nested">Nested</li></ul></li>' +
  '<li id="loose"><p id="loose-p">Loose</p></li></ul>' +
  '<p id="block-math"><span class="katex-display"><span class="katex">y</span></span></p>' +
  '<pre><code id="code">code</code></pre>' +
  '<table><thead><tr><th id="head">Head</th></tr></thead><tbody><tr><td id="cell">' +
  '<p id="cell-p">Cell</p><table><tbody><tr><td id="inner-cell">Inner</td></tr></tbody></table>' +
  '</td></tr></tbody></table>' +
  '<p id="last">Last</p></div></div>';

// jsdom leaves var() unresolved; the plugin sets its variables on <body>.
const applied = (id: string, property: string) =>
  getComputedStyle(document.getElementById(id)!)
    .getPropertyValue(property)
    .replace(
      /var\((--[\w-]+)(?:,\s*([^)]+))?\)/g,
      (_, name: string, fallback = '') => document.body.style.getPropertyValue(name) || fallback,
    );

async function loadManifest(): Promise<PluginManifest> {
  const manifest = (await new BundledCatalogPluginSource().list()).find((m) => m.id === ID);
  if (!manifest) throw new Error('Missing reading typography plugin');
  return manifest;
}

async function mountPage(settings: typeof OFF) {
  document.body.innerHTML = PAGE;
  const engine = new DeclarativeEngine({ doc: document, adapter: deepseekAdapter });
  engine.mount(await loadManifest(), settings);
  return engine;
}

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.body.removeAttribute('style');
});

describe('DeepSeek reading typography', () => {
  it('leaves answers native while both switches are off', async () => {
    const engine = await mountPage(OFF);
    try {
      for (const id of ['first', 'inline', 'item', 'last']) {
        expect(applied(id, 'font-size'), id).toBe('');
        expect(applied(id, 'line-height'), id).toBe('');
        expect(applied(id, 'margin-block-end'), id).toBe('');
      }
    } finally {
      engine.unmountAll();
    }
  });

  it('sizes a paragraph containing inline code like its neighbours', async () => {
    const engine = await mountPage({ ...OFF, fontSizeEnabled: true, fontSize: 125 });
    try {
      for (const id of ['first', 'inline', 'item', 'last']) {
        expect(applied(id, 'font-size'), id).toBe('125%');
        // The line keeps DeepSeek's 28/16 ratio instead of its fixed 28px, in em so
        // inline code inherits the paragraph's pixel line box.
        expect(applied(id, 'line-height'), id).toBe('calc(1.75em)');
      }
      // Inline code keeps its own em size, so it follows the paragraph.
      expect(applied('inline-code', 'font-size')).toBe('');
    } finally {
      engine.unmountAll();
    }
  });

  it('does not compound the size on nested list items or loose-list paragraphs', async () => {
    const engine = await mountPage({ ...OFF, fontSizeEnabled: true, fontSize: 150 });
    try {
      expect(applied('item', 'font-size')).toBe('150%');
      expect(applied('nested', 'font-size')).toBe('');
      expect(applied('loose-p', 'font-size')).toBe('');
    } finally {
      engine.unmountAll();
    }
  });

  it('scales table cells from their native 15px instead of the 16px answer text', async () => {
    const engine = await mountPage({ ...OFF, fontSizeEnabled: true, fontSize: 125 });
    try {
      // jsdom resolves DeepSeek's unset cell tokens to the native 15px/25px fallbacks.
      const flat = (value: string) =>
        value.replace(/\s+/g, ' ').replace(/\( | \)/g, (m) => m.trim());
      for (const id of ['head', 'cell']) {
        expect(flat(applied(id, 'font-size')), id).toBe('calc(15px * 125 / 100)');
        expect(flat(applied(id, 'line-height')), id).toBe('calc(25px * 125 / 100)');
      }
      // Text inside a cell inherits the cell's size instead of scaling again.
      expect(applied('cell-p', 'font-size')).toBe('');
      expect(applied('inner-cell', 'font-size')).toBe('');
    } finally {
      engine.unmountAll();
    }
  });

  it('keeps code blocks, block formulas, thinking and user messages native', async () => {
    const engine = await mountPage({
      ...OFF,
      fontSizeEnabled: true,
      fontSize: 150,
      spacingEnabled: true,
      lineHeight: 200,
    });
    try {
      for (const id of ['block-math', 'code', 'think', 'user']) {
        expect(applied(id, 'font-size'), id).toBe('');
        expect(applied(id, 'line-height'), id).toBe('');
      }
    } finally {
      engine.unmountAll();
    }
  });

  it('spaces paragraphs evenly without adding space at the answer edges', async () => {
    const engine = await mountPage({
      ...OFF,
      spacingEnabled: true,
      lineHeight: 180,
      paragraphSpacing: 8,
    });
    try {
      expect(applied('inline', 'line-height')).toBe('calc(180 / 100)');
      expect(applied('inline', 'font-size')).toBe('');
      expect(applied('inline', 'margin-block-start')).toBe('8px');
      expect(applied('inline', 'margin-block-end')).toBe('8px');
      expect(applied('first', 'margin-block-start')).toBe('');
      expect(applied('last', 'margin-block-end')).toBe('');
      expect(applied('loose-p', 'margin-block-end')).toBe('');
    } finally {
      engine.unmountAll();
    }
  });

  it('restores host attributes, body style and markup after each unmount', async () => {
    const manifest = await loadManifest();
    document.body.innerHTML = PAGE;
    document.body.setAttribute('style', 'color: red;');
    const engine = new DeclarativeEngine({ doc: document, adapter: deepseekAdapter });
    const answer = document.getElementById('answer')!;
    const markup = answer.innerHTML;
    try {
      for (let cycle = 0; cycle < 2; cycle++) {
        engine.mount(manifest, OFF);
        expect(answer.classList.contains('gv-plugin-deepseek-reading-typography')).toBe(true);
        expect(answer.getAttribute('data-gv-spacing')).toBe('false');
        engine.updateSettings(ID, { ...OFF, fontSizeEnabled: true, fontSize: 90 });
        expect(applied('first', 'font-size')).toBe('90%');
        engine.unmount(ID);
        expect(answer.className).toBe('ds-message');
        expect(answer.getAttribute('data-gv-spacing')).toBe('host');
        expect(answer.hasAttribute('data-gv-font-size')).toBe(false);
        expect(answer.innerHTML).toBe(markup);
        expect(document.body.getAttribute('style')).toBe('color: red;');
        expect(document.getElementById('gv-plugin-style-' + ID)).toBeNull();
        expect(applied('first', 'font-size')).toBe('');
      }
    } finally {
      engine.unmountAll();
    }
  });
});
