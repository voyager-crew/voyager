import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { PluginManifest } from '@/features/plugins/types';
import { readContentStyle } from '@/tests/contentStyle';

import {
  DEFAULT_ACCENT,
  PLATFORM_THEME_CLASS,
  accentHue,
  applyBrandTheme,
  effectiveAccentForDisplay,
  readableForeground,
  resolveBrandColor,
} from '../index';

afterEach(() => {
  document.documentElement.className = '';
  document.documentElement.style.removeProperty('--gv-pm-brand');
  document.documentElement.style.removeProperty('--gv-pm-brand-fg');
  document.documentElement.style.removeProperty('--gv-pm-brand-h');
});

const PUBLIC_ROLE = {
  '--gv-pm-brand': 'accent',
  '--gv-pm-brand-fg': 'accent-fg',
  '--gv-pm-brand-h': 'accent-hue',
} as const;

/** The site value set inline on the root, read through the public variable it yields to. */
function siteAccent(name: keyof typeof PUBLIC_ROLE): string {
  const inline = document.documentElement.style.getPropertyValue(name);
  if (inline === '') return '';
  const prefix = `var(--gv-theme-${PUBLIC_ROLE[name]}, `;
  expect(inline.startsWith(prefix) && inline.endsWith(')'), inline).toBe(true);
  return inline.slice(prefix.length, -1);
}

const themedPlugin = (brand: string, matches: string[]): PluginManifest => ({
  id: 'x.themed',
  name: 'Themed',
  version: '1.0.0',
  description: 'd',
  author: 'a',
  category: 'theme',
  license: 'MIT',
  engine: '>=1.0.0',
  tier: 'declarative',
  matches,
  contributes: {},
  theme: { brand },
});

describe('resolveBrandColor with a published site override', () => {
  const remoteClaude = {
    id: 'claude',
    label: 'Claude',
    matches: ['https://claude.ai/*'],
    selectors: {},
    theme: { hostSelector: ':root', lightSelector: ':root', darkSelector: ':root.dark' },
    brandColor: '#112233',
    capabilities: new Set<'chat'>(['chat']),
  };

  it('uses the override brand colour instead of the bundled one', () => {
    expect(resolveBrandColor('https://claude.ai/chat/1', [], {}, remoteClaude)).toBe('#112233');
    expect(resolveBrandColor('https://claude.ai/chat/1', [], {})).toBe('#d97757');
  });

  it('still lets a user accent and an enabled plugin theme win over the override', () => {
    expect(
      resolveBrandColor('https://claude.ai/chat/1', [], { claude: '#abcdef' }, remoteClaude),
    ).toBe('#abcdef');
    expect(
      resolveBrandColor(
        'https://claude.ai/chat/1',
        [themedPlugin('#00ff00', ['https://claude.ai/*'])],
        {},
        remoteClaude,
      ),
    ).toBe('#00ff00');
  });

  it('paints the override colour on the document root', () => {
    applyBrandTheme('https://claude.ai/chat/1', [], document, {}, remoteClaude);
    expect(siteAccent('--gv-pm-brand')).toBe('#112233');
    expect(document.documentElement.classList.contains(PLATFORM_THEME_CLASS)).toBe(true);
  });
});

describe('resolveBrandColor', () => {
  it('uses the adapter brandColor for Claude, ChatGPT and DeepSeek', () => {
    expect(resolveBrandColor('https://claude.ai/chat/1')).toBe('#d97757');
    expect(resolveBrandColor('https://chatgpt.com/c/1')).toBe('#0ea5e9');
    expect(resolveBrandColor('https://chat.openai.com/')).toBe('#0ea5e9');
    expect(resolveBrandColor('https://chat.deepseek.com/a/chat/s/1')).toBe('#4d6bfe');
  });

  it('returns null for Gemini / AI Studio / unknown sites', () => {
    expect(resolveBrandColor('https://gemini.google.com/app')).toBeNull();
    expect(resolveBrandColor('https://aistudio.google.com/')).toBeNull();
    expect(resolveBrandColor('https://example.com/')).toBeNull();
  });

  it('lets a matching plugin theme override the adapter default', () => {
    const plugins = [themedPlugin('#ff0000', ['https://claude.ai/*'])];
    expect(resolveBrandColor('https://claude.ai/x', plugins)).toBe('#ff0000');
  });

  it('never takes a plugin theme on Gemini or AI Studio', () => {
    const plugins = [
      themedPlugin('#ff0000', ['https://gemini.google.com/*', 'https://aistudio.google.com/*']),
    ];
    expect(resolveBrandColor('https://gemini.google.com/app', plugins)).toBeNull();
    expect(resolveBrandColor('https://aistudio.google.com/prompts', plugins)).toBeNull();
    const frame = [themedPlugin('#ff0000', ['https://*.frame.claudeusercontent.com/*'])];
    expect(
      resolveBrandColor('https://gemini.google.com/app/abc?x=.frame.claudeusercontent.com/', frame),
    ).toBeNull();
  });

  it('ignores a plugin theme whose matches do not cover the url', () => {
    const plugins = [themedPlugin('#ff0000', ['https://chatgpt.com/*'])];
    // Falls back to Claude's adapter brandColor, not the ChatGPT-scoped plugin.
    expect(resolveBrandColor('https://claude.ai/x', plugins)).toBe('#d97757');
  });

  it('lets a per-site override win over the adapter default and plugin theme', () => {
    const plugins = [themedPlugin('#ff0000', ['https://claude.ai/*'])];
    expect(resolveBrandColor('https://claude.ai/x', plugins, { claude: '#123456' })).toBe(
      '#123456',
    );
    // Override is scoped per site id: a gemini override does not leak to claude.
    expect(resolveBrandColor('https://claude.ai/x', [], { gemini: '#123456' })).toBe('#d97757');
  });

  it('applies a per-site override on Gemini (which otherwise has no colour)', () => {
    expect(resolveBrandColor('https://gemini.google.com/app', [], { gemini: '#abcdef' })).toBe(
      '#abcdef',
    );
    // A blank/whitespace override is ignored.
    expect(resolveBrandColor('https://gemini.google.com/app', [], { gemini: '  ' })).toBeNull();
  });
});

describe('effectiveAccentForDisplay', () => {
  it('returns the sage default for Gemini with no override', () => {
    expect(effectiveAccentForDisplay('https://gemini.google.com/app')).toBe(DEFAULT_ACCENT);
  });

  it('returns the DeepSeek adapter colour for a plugin-platform page', () => {
    expect(effectiveAccentForDisplay('https://chat.deepseek.com/a/chat/s/1')).toBe('#4d6bfe');
  });

  it('returns the adapter colour for Claude and the override when set', () => {
    expect(effectiveAccentForDisplay('https://claude.ai/x')).toBe('#d97757');
    expect(effectiveAccentForDisplay('https://claude.ai/x', [], { claude: '#0f0f0f' })).toBe(
      '#0f0f0f',
    );
  });
});

describe('readableForeground', () => {
  it('uses white ink on dark accents and dark ink on light accents', () => {
    expect(readableForeground('#1f2a24')).toBe('#ffffff'); // very dark → white
    expect(readableForeground('#0ea5e9')).toBe('#ffffff'); // mid sky blue → white
    expect(readableForeground('#A7C080')).not.toBe('#ffffff'); // light sage → dark ink
    expect(readableForeground('#ffffff')).not.toBe('#ffffff'); // white bg → dark ink
  });

  it('expands 3-digit hex and falls back to white for junk', () => {
    expect(readableForeground('#fff')).not.toBe('#ffffff'); // near-white → dark ink
    expect(readableForeground('not-a-color')).toBe('#ffffff');
  });
});

describe('accentHue', () => {
  it('extracts a sensible OKLCH hue, null for grey / junk', () => {
    const sage = accentHue('#5f8f55');
    expect(sage).not.toBeNull();
    expect(sage!).toBeGreaterThan(120); // green sits ~140°
    expect(sage!).toBeLessThan(160);
    expect(accentHue('#888888')).toBeNull(); // grey → no meaningful hue
    expect(accentHue('not-a-color')).toBeNull();
  });
});

describe('applyBrandTheme', () => {
  it('sets the themed class + --gv-pm-brand on the root for a themed site', () => {
    applyBrandTheme('https://claude.ai/x', [], document);
    expect(document.documentElement.classList.contains(PLATFORM_THEME_CLASS)).toBe(true);
    expect(siteAccent('--gv-pm-brand')).toBe('#d97757');
  });

  it('lets a creation’s public accent variables outrank the inline site accent', () => {
    applyBrandTheme('https://claude.ai/x', [], document);
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--gv-pm-brand')).toBe('var(--gv-theme-accent, #d97757)');
    expect(style.getPropertyValue('--gv-pm-brand-fg')).toBe('var(--gv-theme-accent-fg, #ffffff)');
    expect(style.getPropertyValue('--gv-pm-brand-h')).toMatch(
      /^var\(--gv-theme-accent-hue, [\d.]+\)$/,
    );
  });

  it('applies the DeepSeek adapter colour to the Voyager UI root', () => {
    applyBrandTheme('https://chat.deepseek.com/a/chat/s/1', [], document);
    expect(document.documentElement.classList.contains(PLATFORM_THEME_CLASS)).toBe(true);
    expect(siteAccent('--gv-pm-brand')).toBe('#4d6bfe');
    expect(siteAccent('--gv-pm-brand-fg')).toBe('#ffffff');
  });

  it('adds no accent on Gemini, but still names the platform', () => {
    applyBrandTheme('https://gemini.google.com/app', [], document);
    expect(document.documentElement.className).toBe('');
    expect(siteAccent('--gv-pm-brand')).toBe('');
    // A rule that belongs to one platform needs to name it. gv-platform-themed
    // only says "declares a brand", which three platforms do at once.
    expect(document.documentElement.getAttribute('data-gv-platform')).toBe('gemini');
  });

  it('names each platform on the root and clears it off an unknown site', () => {
    for (const [url, id] of [
      ['https://chat.deepseek.com/a/chat/s/1', 'deepseek'],
      ['https://chatgpt.com/c/1', 'chatgpt'],
      ['https://claude.ai/chat/1', 'claude'],
    ] as const) {
      applyBrandTheme(url, [], document);
      expect(document.documentElement.getAttribute('data-gv-platform'), url).toBe(id);
    }
    applyBrandTheme('https://example.com/', [], document);
    expect(document.documentElement.hasAttribute('data-gv-platform')).toBe(false);
  });

  it('clears a previously-applied theme when navigating to an un-themed site', () => {
    applyBrandTheme('https://claude.ai/x', [], document);
    applyBrandTheme('https://gemini.google.com/app', [], document);
    expect(document.documentElement.classList.contains(PLATFORM_THEME_CLASS)).toBe(false);
    expect(siteAccent('--gv-pm-brand')).toBe('');
    expect(siteAccent('--gv-pm-brand-fg')).toBe('');
  });

  it('sets a luminance-matched --gv-pm-brand-fg alongside the brand', () => {
    applyBrandTheme('https://claude.ai/x', [], document); // #d97757 → white ink
    expect(siteAccent('--gv-pm-brand-fg')).toBe('#ffffff');
  });

  it('applies a per-site override (incl. on Gemini) with a readable foreground', () => {
    applyBrandTheme('https://gemini.google.com/app', [], document, { gemini: '#A7C080' });
    expect(document.documentElement.classList.contains(PLATFORM_THEME_CLASS)).toBe(true);
    expect(siteAccent('--gv-pm-brand')).toBe('#A7C080');
    // Light sage → dark ink, not white.
    expect(siteAccent('--gv-pm-brand-fg')).not.toBe('#ffffff');
  });

  it('injects --gv-pm-brand-h so the tinted accent palette re-hues to the custom colour', () => {
    applyBrandTheme('https://gemini.google.com/app', [], document, { gemini: '#3a6df0' });
    const hue = parseFloat(siteAccent('--gv-pm-brand-h'));
    expect(Number.isFinite(hue)).toBe(true);
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThanOrEqual(360);
    // Clearing removes it so the theme-aware default hue stands again.
    applyBrandTheme('https://gemini.google.com/app', [], document);
    expect(siteAccent('--gv-pm-brand-h')).toBe('');
  });
});

describe('platform theme CSS', () => {
  it('paints the FAB with the brand and lets nothing repaint it afterwards', () => {
    const css = readContentStyle();
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body], order) => ({
      selector: selector
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .trim(),
      body,
      order,
    }));

    const brand = rules.find(
      (r) => r.selector.includes('.gv-pm-trigger') && r.body.includes('--gv-pm-brand,'),
    );
    expect(brand, 'no brand rule for .gv-pm-trigger').toBeTruthy();
    expect(brand!.body).toContain('var(--gv-pm-brand, var(--gv-pm-brand-default))');
    expect(brand!.body).toContain('var(--gv-pm-brand-fg, var(--gv-pm-brand-fg-default))');

    // The brand rule used to win on specificity alone: it was scoped to Gemini's
    // .theme-host (0,3,0) while a neutral white/black pair sat below it at
    // (0,2,1). Once every site shares one hook those weigh the same and the
    // later rule wins, which is how the FAB silently lost its colour once.
    const repaints = rules.filter((r) => {
      if (r.order <= brand!.order) return false;
      if (!/(^|[\s,])[^,]*\.gv-pm-trigger($|[\s,:])/.test(`${r.selector},`)) return false;
      const background = r.body.match(/(?:^|[;\s])background\s*:([^;]*)/)?.[1];
      // Another brand-driven rule is the system working; a literal colour is the
      // bug — that is how a neutral white/black pair silently won once.
      return background !== undefined && !background.includes('--gv-pm-brand');
    });
    expect(
      repaints.map((r) => r.selector),
      'a later rule repaints the FAB with a literal colour',
    ).toEqual([]);
  });

  it('never re-declares the JS-overridable --gv-pm-brand in a scheme block (would shadow the inline custom colour)', () => {
    const css = readContentStyle();
    // Each .theme-host theme block must define only the *-default vars; a bare
    // `--gv-pm-brand:` there would shadow the inline <html> override so a custom
    // colour could never reach the Voyager UI inside .theme-host.
    for (const sel of ["html[data-gv-scheme='light']", "html[data-gv-scheme='dark']"]) {
      const escaped = sel.replace(/[.[\]']/g, '\\$&');
      const block =
        css.match(new RegExp(`${escaped} \\{([^}]*--gv-pm-brand-default[^}]*)\\}`))?.[1] ?? '';
      expect(block).toContain('--gv-pm-brand-default:');
      expect(/--gv-pm-brand:\s/.test(block)).toBe(false);
      expect(/--gv-pm-brand-fg:\s/.test(block)).toBe(false);
    }
  });

  it('re-hues tinted accents via var(--gv-pm-brand-h), not the low-support oklch(from …) syntax', () => {
    const css = [
      readContentStyle(),
      ...[
        'src/features/timeline/timeline.css',
        'src/features/timeline/timelineContextMenu.css',
        'src/features/timeline/timelineSlider.css',
        'src/features/timeline/timelinePreview.css',
      ].map((path) => readFileSync(resolve(process.cwd(), path), 'utf8')),
    ].join('\n');
    // CSS relative-colour syntax is too new (Chrome 119+/Safari 16.4+/Firefox 128+);
    // tints must use the broadly-supported oklch(L C var(--gv-pm-brand-h)) form.
    // Matched as a regex, not a substring: the formatter wraps long values, and a
    // `toContain('oklch(from ')` check silently stopped matching once it did.
    expect(/oklch\(\s*from\s/.test(css)).toBe(false);
    expect(css).toContain('var(--gv-pm-brand-h, var(--gv-pm-brand-h-default))');
    // The modern timeline search panel's focus ring re-hues with the accent.
    const focusRing = css.match(/\.timeline-preview-search input:focus\s*{([\s\S]*?)}/)?.[1] ?? '';
    expect(focusRing).toContain('var(--gv-pm-brand-h');
  });

  it('uses the site accent for formula hover instead of hard-coded Gemini blue', () => {
    const css = readContentStyle();
    const formulaHover =
      css.match(
        /:root\.gv-formula-copy-enabled \.math-inline:not\(\.gv-formula-copy-ignored\):hover,\s*:root\.gv-formula-copy-enabled \.math-display:not\(\.gv-formula-copy-ignored\):hover,\s*:root\.gv-formula-copy-enabled \[data-math\]:not\(\.gv-formula-copy-ignored\):hover\s*{([\s\S]*?)}/,
      )?.[1] ?? '';

    expect(formulaHover).toContain('var(--gv-pm-brand-soft)');
    expect(formulaHover).toContain('var(--gv-pm-brand, var(--gv-pm-brand-default))');
    expect(formulaHover).not.toContain('rgba(66, 133, 244');
    expect(css).toContain(
      ':root.gv-platform-themed.gv-formula-copy-enabled .math-inline .katex:hover',
    );
  });
});
