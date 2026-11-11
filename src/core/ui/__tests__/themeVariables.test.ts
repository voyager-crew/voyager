import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { THEME_VARIABLES, themeVariableName } from '../themeVariables';

const SRC = resolve(__dirname, '../../..');

function shippedStylesheets(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.css') && !path.split(/[\\/]/).includes('__tests__'))
    .map((path) => readFileSync(join(SRC, path), 'utf8'));
}

function readNames(css: string): string[] {
  return [...css.matchAll(/var\(\s*(--gv-theme-[a-z-]+)\s*,/g)].map((match) => match[1]);
}

describe('public theme variables', () => {
  const read = new Set(shippedStylesheets().flatMap(readNames));
  const listed = THEME_VARIABLES.map(({ role }) => themeVariableName(role));

  it('are each read by a shipped stylesheet', () => {
    for (const name of listed) expect(read, name).toContain(name);
  });

  it('cover every --gv-theme-* a shipped stylesheet reads', () => {
    expect([...read].filter((name) => !listed.includes(name as never))).toEqual([]);
  });

  it('are never set by Voyager itself, so a creation that sets one always wins', () => {
    for (const css of shippedStylesheets()) expect(css).not.toMatch(/--gv-theme-[a-z-]+\s*:/);
  });
});
