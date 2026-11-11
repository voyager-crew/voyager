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
  return [...css.matchAll(/var\(\s*(--gv-theme-[a-z-]+)\s*[,)]/g)].map((match) => match[1]);
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

  // What Voyager draws straight on the host page has no Voyager surface behind it,
  // so a creation's panel text there would vanish on the host's own background.
  it('keep the neutral roles off the page root and off what Voyager draws on the host', () => {
    const neutral = /var\(\s*--gv-theme-(surface|hover|text|text-muted|border)\s*,/;
    const pageRoot = /^(:root|html)(\[[^\]]*\]|:[\w-]+(\([^)]*\))?)*$/;
    const onHost =
      /\.(gv-folder-(header(?!-menu)|container|conversation|action-btn|add-btn|section-toggle|inline-|search)|gv-pm-trigger|gv-export-dropdown|gv-persistent-export|timeline-(dot|bar|track)|gv-timeline-ruler|gv-folders-anchor-toggle|gv-default-star-btn|gv-hide-archived-nudge|gv-gems-|gv-conversation-star-btn|gv-multi-select|gv-create-)|:host\((\[data-gv-tree-inline\]|\.gv-site-folder-section)/;
    const offenders = shippedStylesheets().flatMap((css) =>
      [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .map(([, selector, body]) => ({ selector: selector.trim(), body }))
        .filter(({ selector, body }) => {
          if (!neutral.test(body)) return false;
          const parts = selector.split(',').map((part) => part.trim());
          return parts.some((part) => pageRoot.test(part)) || onHost.test(selector);
        })
        .map(({ selector }) => selector),
    );
    expect(offenders).toEqual([]);
  });

  it('let the timeline role reach only the timeline’s own marks on the host page', () => {
    const mark =
      /^(html\[data-gv-scheme(='dark')?\] )?(\.gemini-timeline-bar|\.timeline-dot|\.timeline-left-slider::before)/;
    const offenders = shippedStylesheets().flatMap((css) =>
      [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .map(([, selector, body]) => ({ selector: selector.trim(), body }))
        .filter(({ body }) => /var\(\s*--gv-theme-timeline\s*[,)]/.test(body))
        .filter(({ selector }) => !selector.split(',').every((part) => mark.test(part.trim())))
        .map(({ selector }) => selector),
    );
    expect(offenders).toEqual([]);
  });

  it('are never set by Voyager itself, so a creation that sets one always wins', () => {
    for (const css of shippedStylesheets()) expect(css).not.toMatch(/--gv-theme-[a-z-]+\s*:/);
  });
});
