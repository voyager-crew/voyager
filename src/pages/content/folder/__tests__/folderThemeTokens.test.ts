import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A dark OS turns on the `prefers-color-scheme: dark` copies of the theme
 * tokens even when the site itself is light. The site's light scheme block is
 * what puts them back, so it has to reset every token those copies change.
 */
const css = readFileSync(resolve(__dirname, '../../../../../public/contentStyle.css'), 'utf8')
  // A comment may hold braces or token names; only parsed CSS counts.
  .replace(/\/\*[\s\S]*?\*\//g, ' ');

function tokensIn(body: string): Set<string> {
  return new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map(([, name]) => name));
}

/** The token names set by every `:root` rule inside a dark-OS media block. */
function darkOsRootTokens(): Set<string> {
  const tokens = new Set<string>();
  const media = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/g;
  for (const [, body] of css.matchAll(media)) for (const name of tokensIn(body)) tokens.add(name);
  return tokens;
}

function lightSchemeTokens(): Set<string> {
  const tokens = new Set<string>();
  for (const [, body] of css.matchAll(/html\[data-gv-scheme='light'\]\s*\{([^}]*)\}/g))
    for (const name of tokensIn(body)) tokens.add(name);
  return tokens;
}

describe('content style theme tokens', () => {
  it('keeps light selection colours on a light site when the OS is dark', () => {
    const dark = darkOsRootTokens();
    const light = lightSchemeTokens();

    expect(dark.size).toBeGreaterThan(0);
    expect([...dark].filter((name) => !light.has(name))).toEqual([]);
  });
});
