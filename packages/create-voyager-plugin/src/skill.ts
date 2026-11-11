/**
 * `skill --out <dir>`: the write-voyager-plugin skill as the folder the docs
 * site serves, SKILL.md plus the site, primitive and example files it links.
 * `create-pages --out <dir>`: the per-site page a chat AI reads. Both only
 * write; a file they no longer have is left for the repository's staleness
 * tests to name, so `--out` never deletes anything in a folder the caller chose.
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

import { renderWriteVoyagerPluginSkillFiles } from '../../../src/features/plugins/local/authoring/authoringDocs';
import { renderCreatePages } from '../../../src/features/plugins/local/authoring/createPages';
import type { SiteAdapter } from '../../../src/features/plugins/types';

/** Every Markdown file under `dir`, as sorted paths relative to it with `/` separators. */
export function listSkillMarkdown(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.md'))
    .map((path) => path.split(sep).join('/'))
    .sort();
}

function writeFiles(dir: string, files: ReadonlyMap<string, string>): void {
  for (const [path, text] of files) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
}

export function writeSkillDir(dir: string, sites: readonly SiteAdapter[]): void {
  writeFiles(dir, renderWriteVoyagerPluginSkillFiles(sites));
}

export function writeCreatePagesDir(dir: string, sites: readonly SiteAdapter[]): void {
  writeFiles(dir, renderCreatePages(sites));
}
