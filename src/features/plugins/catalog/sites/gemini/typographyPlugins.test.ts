/**
 * The packaged Gemini typography plugins (chat font size; chat spacing, which
 * is line height plus paragraph spacing) retain their message selectors,
 * percentage sizing, code scaling and spacing cascade. Their values arrive from the legacy sliders through the value
 * bindings; see `runtime/PluginHost.legacyValues.test.ts` for that path.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { elementValue } from '@/tests/pseudoElementPaint';

import { renderSettingTemplate } from '../../../manifest/sinkGuards';
import { BundledCatalogPluginSource } from '../../../sources/BundledCatalogPluginSource';
import type { PluginManifest, PluginSettings } from '../../../types';

async function packaged(id: string): Promise<PluginManifest> {
  const manifest = (await new BundledCatalogPluginSource().list()).find((m) => m.id === id);
  if (!manifest) throw new Error(`${id} is not packaged`);
  return manifest;
}

function rendered(manifest: PluginManifest, settings: PluginSettings): string {
  const css = (manifest.contributes.styles ?? []).map((style) => style.css).join('\n');
  return renderSettingTemplate(css, manifest.contributes.settings, settings);
}

/**
 * The plugin's rules with its setting custom properties resolved to the
 * values they carry, as the browser does: the `:root` block that declares
 * them goes, and each `var()` becomes its value.
 */
function resolvedRules(css: string): string {
  const declared = new Map<string, string>();
  const withoutRoot = css.replace(/:root\s*\{([^}]*)\}/, (_, body: string) => {
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      declared.set(name, value.trim());
    }
    return '';
  });
  let resolved = withoutRoot;
  for (const [name, value] of declared) resolved = resolved.replaceAll(`var(${name})`, value);
  return resolved;
}

function inject(css: string): void {
  const style = document.createElement('style');
  style.textContent = resolvedRules(css);
  document.head.append(style);
}

function messageFixture(): void {
  document.body.innerHTML = `<main>
    <user-query><span class="query-text gv-font-target">User</span><p class="query-text-line gv-font-target">Line</p><span class="gds-body-l gv-font-target">Body</span></user-query>
    <user-query-content><span class="gds-body-l gv-font-target">Content</span></user-query-content>
    <div class="user-query-bubble-with-background"><span class="gds-body-l gv-font-target">Bubble</span></div>
    <div aria-label="User message"><span class="gds-body-l gv-font-target">Aria</span></div>
    <div data-message-author-role="user"><span class="gds-body-l gv-font-target">Role</span></div>
    <model-response><message-content id="nested-parent" class="gv-font-target">
      <p id="nested-child" class="gv-font-target gv-paragraph-target">Answer</p>
      <ul class="gv-paragraph-target"><li class="gv-font-target">Item</li></ul>
      <pre class="gv-paragraph-target"><code id="code">Code</code></pre>
      <table class="gv-paragraph-target"><tbody><tr><td class="gv-font-target">Cell</td><th class="gv-font-target">Heading</th></tr></tbody></table>
      <blockquote class="gv-paragraph-target">Quote</blockquote>
      <div class="code-container gv-paragraph-target">Code block</div>
    </message-content></model-response>
    <div class="response-content gv-font-target">Response</div>
    <div class="response-container"><div class="markdown-main-panel gv-font-target">Panel</div></div>
    <div data-message-author-role="assistant"><div class="markdown gv-font-target">Assistant</div></div>
    <div data-message-author-role="model"><div class="markdown gv-font-target">Model</div></div>
  </main>`;
}

let fontSize: PluginManifest;
let spacing: PluginManifest;

beforeEach(async () => {
  fontSize = await packaged('voyager.gemini-chat-font-size');
  spacing = await packaged('voyager.gemini-chat-line-height');
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('Gemini typography plugins', () => {
  it('sizes Gemini user and response text and keeps nested matches as percentages', () => {
    messageFixture();
    for (const size of [80, 100, 123, 150]) {
      inject(rendered(fontSize, { fontSize: size }));
      for (const target of document.querySelectorAll('.gv-font-target')) {
        expect(elementValue(target, 'font-size')).toBe(`${size}%`);
      }
      // Both matched levels resolve their percentage against their own parent.
      expect(elementValue(document.getElementById('nested-parent')!, 'font-size')).toBe(`${size}%`);
      expect(elementValue(document.getElementById('nested-child')!, 'font-size')).toBe(`${size}%`);
    }
  });

  it('keeps code blocks at 0.875 of the chosen size', () => {
    const style = document.createElement('style');
    style.textContent = resolvedRules(rendered(fontSize, { fontSize: 120 }));
    document.head.append(style);
    const rules = Array.from(style.sheet?.cssRules ?? []) as CSSStyleRule[];
    const code = rules.find((rule) => rule.selectorText.includes('model-response code'));
    // 0.875 × 120 %, as the CSS engine resolves it.
    expect(code?.style.getPropertyValue('font-size')).toBe('calc(105%)');
    expect(code?.style.getPropertyPriority('font-size')).toBe('important');
  });

  it('applies line height to message and code text and spacing to markdown blocks', () => {
    messageFixture();
    for (const [lineHeight, paragraphSpacing] of [
      [120, 0],
      [160, 12],
      [185, 24],
    ]) {
      inject(
        rendered(spacing, { lineHeight, paragraphSpacing }).replaceAll(
          `calc(var(--gv-chat-line-height) / 100)`,
          String(lineHeight / 100),
        ),
      );
      for (const target of document.querySelectorAll('.gv-font-target, #code')) {
        expect(elementValue(target, 'line-height')).toBe(String(lineHeight / 100));
      }
      for (const target of document.querySelectorAll('.gv-paragraph-target')) {
        expect(elementValue(target, 'margin-top')).toBe(`${paragraphSpacing}px`);
        expect(elementValue(target, 'margin-bottom')).toBe(`${paragraphSpacing}px`);
      }
    }
  });

  it('lets the spacing line height win over the font size line height whichever mounts first', () => {
    // Both sheets mark line-height !important, so specificity decides, not
    // order: every element the font size rules give a line height to gets
    // one from a spacing selector that is the same selector under `body`.
    const sheet = (css: string): CSSStyleRule[] => {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.append(style);
      return Array.from(style.sheet?.cssRules ?? []) as CSSStyleRule[];
    };
    const selectorsSetting = (rules: CSSStyleRule[], property: string): Set<string> =>
      new Set(
        rules
          .filter((rule) => rule.style.getPropertyValue(property) !== '')
          .flatMap((rule) => rule.selectorText.split(',').map((part) => part.trim())),
      );
    const fontLineHeights = selectorsSetting(
      sheet(rendered(fontSize, { fontSize: 100 })),
      'line-height',
    );
    const spacingLineHeights = selectorsSetting(
      sheet(rendered(spacing, { lineHeight: 200, paragraphSpacing: 12 })),
      'line-height',
    );
    expect(fontLineHeights.size).toBeGreaterThan(0);
    for (const selector of fontLineHeights) {
      expect(spacingLineHeights, selector).toContain(`body ${selector}`);
    }
  });
});
