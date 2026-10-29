import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BUNDLED_SITE_ADAPTERS } from '@/features/plugins/catalog/sites';
import { folderSkinCss } from '@/features/plugins/verbs/folders/skinCss';

/**
 * The folder tree laid into a sidebar is one structural sheet,
 * `floatingTree/inlineTree.css`, and a skin per site that only sets its
 * `--gv-folder-tree-*` tokens. A layout rule in a skin forks the tree again;
 * a token the core reads that a skin leaves unset silently drops that
 * declaration, so both are checked here.
 */
const root = resolve(__dirname, '../../../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const CORE = 'src/pages/content/folder/floatingTree/inlineTree.css';

/** Skins that each lay the full set of tree tokens over the core. */
const FULL_SKINS = [
  'src/pages/content/folder/sidebarTreeTokens.css',
  'src/features/plugins/verbs/folders/sectionTree.css',
] as const;

/** Site sheets layered over a full skin: tokens, plus the shared header layout. */
const SITE_SKINS = [
  ['AI Studio', read('src/pages/content/folder/aistudioTreeTokens.css')],
  ...BUNDLED_SITE_ADAPTERS.flatMap((site) =>
    site.folderSkin
      ? [[site.id, folderSkinCss(`gv-${site.id}-folder-section`, site.folderSkin)] as const]
      : [],
  ),
] as const;

/**
 * A shared header layout reserves space for a host's pinned history control.
 * The tree itself must still be skinned only through its tokens.
 */
const STRUCTURAL_EXCEPTIONS: ReadonlyArray<RegExp> = [
  /\.gv-[a-z0-9-]+-folder-section__header\b/,
  /\.gv-[a-z0-9-]+-folder-section__selection\b/,
];

function rules(css: string): Array<{ selector: string; declarations: string[] }> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim().replace(/\s+/g, ' '),
    declarations: match[2]
      .split(/;(?![^(]*\))/)
      .map((text) => text.trim())
      .filter(Boolean),
  }));
}

function layoutRules(css: string): string[] {
  return rules(css)
    .filter((rule) => !STRUCTURAL_EXCEPTIONS.some((pattern) => pattern.test(rule.selector)))
    .filter((rule) => rule.declarations.some((text) => !text.startsWith('--')))
    .map((rule) => rule.selector);
}

function definedTokens(css: string): Set<string> {
  return new Set([...css.matchAll(/(--gv-folder-tree-[\w-]+)\s*:/g)].map((match) => match[1]));
}

describe('inline folder tree skins', () => {
  it.each(FULL_SKINS)('%s sets tokens, not layout', (path) => {
    expect(layoutRules(read(path))).toEqual([]);
  });

  it.each(SITE_SKINS)('%s sets tokens, with only the shared header layout', (_site, css) => {
    expect(layoutRules(css)).toEqual([]);
  });

  it.each(FULL_SKINS)('%s sets every token the shared tree reads', (path) => {
    const core = read(CORE).replace(/\/\*[\s\S]*?\*\//g, '');
    // Only tokens read without a fallback; `marks` falls back to no edges.
    const read_ = new Set(
      [...core.matchAll(/var\((--gv-folder-tree-[\w-]+)\)/g)].map((match) => match[1]),
    );
    const defined = definedTokens(read(path));
    expect(read_.size).toBeGreaterThan(40);
    expect([...read_].filter((token) => !defined.has(token))).toEqual([]);
  });
});
