import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DEFAULT_ADAPTERS } from '../../sites/registry';
import { EFFECTIVE_PLUGIN_ENGINE_VERSION } from '../../verbs/contracts';
import { validateLocalManifest } from '../validateLocalManifest';
import { renderWriteVoyagerPluginSkillFiles } from './authoringDocs';
import { renderCreatePages } from './createPages';
import { offeredPrimitiveNames } from './primitivesSection';
import { SCRIPTED_PAGE_FILE } from './scriptedContract';
import { siteAnchors } from './siteFacts';
import { WRITE_PLUGIN_SKILL_BASE_URL, createPageFile } from './skillLink';

const CREATE_DIR = join(process.cwd(), 'docs/public/create');
const pages = renderCreatePages(DEFAULT_ADAPTERS);
const skillFiles = renderWriteVoyagerPluginSkillFiles(DEFAULT_ADAPTERS);
const cases = DEFAULT_ADAPTERS.map(
  (site) => [site.label, site, pages.get(createPageFile(site.id))!] as const,
);

function jsonBlocks(text: string): unknown[] {
  return [...text.matchAll(/(?:^ {4}.*\n)+/gm)].map((match) =>
    JSON.parse(match[0].replace(/^ {4}/gm, '')),
  );
}

describe('create pages', () => {
  it('are current: run `bun run skills:build` after changing sites, primitives or the contract (and delete a page it no longer writes)', () => {
    const committed = readdirSync(CREATE_DIR).filter((path) => path.endsWith('.md'));
    expect(committed.sort()).toEqual([...pages.keys()].sort());
    for (const [path, text] of pages) {
      expect(readFileSync(join(CREATE_DIR, path), 'utf8'), path).toBe(text);
    }
  });

  it.each(cases)('give %s its URL patterns, anchors and engine version', (_label, site, page) => {
    for (const pattern of site.matches) expect(page).toContain(`- ${pattern}\n`);
    for (const key of siteAnchors(site)) expect(page).toContain(`- ${key}: `);
    expect(page).toContain(`engine ${EFFECTIVE_PLUGIN_ENGINE_VERSION}`);
    expect(page).toContain('exactly one fenced code block labeled json');
  });

  it.each(cases)('show %s one example the local gate accepts', (_label, site, page) => {
    const [example, ...rest] = jsonBlocks(page) as { matches: string[] }[];
    expect(rest).toEqual([]);
    expect(example.matches).toEqual(site.matches);
    const result = validateLocalManifest(example);
    expect(result.success ? [] : result.error).toEqual([]);
  });

  it.each(cases)(
    'name on %s the primitives that run there, and nothing else',
    (_label, site, page) => {
      const offered = offeredPrimitiveNames(site);
      const names = /these run: ([^.\n]+)\./.exec(page)?.[1].split(', ') ?? [];
      expect(names).toEqual(offered);
    },
  );

  it('point only at skill files the docs site serves', () => {
    for (const [path, page] of pages) {
      const urls = [...page.matchAll(/https:\/\/voyager\.nagi\.fun\/skills\/\S+\.md/g)].map(
        (match) => match[0],
      );
      expect(urls.length, path).toBeGreaterThan(0);
      for (const url of urls) {
        expect(skillFiles.has(url.slice(WRITE_PLUGIN_SKILL_BASE_URL.length)), url).toBe(true);
      }
    }
  });

  it('hold no code fence, since a page may be pasted into a composer', () => {
    for (const [path, page] of pages) {
      if (path !== SCRIPTED_PAGE_FILE) expect(page, path).not.toContain('```');
    }
  });

  it('stay short enough for a chat AI to read whole', () => {
    for (const [path, page] of pages) expect(page.length, path).toBeLessThan(10_000);
  });
});
