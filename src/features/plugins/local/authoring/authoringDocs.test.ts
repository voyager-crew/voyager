import { readFileSync, readdirSync } from 'node:fs';
import { join, posix, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DEFAULT_ADAPTERS } from '../../sites/registry';
import { EFFECTIVE_PLUGIN_ENGINE_VERSION } from '../../verbs/contracts';
import { validateLocalManifest } from '../validateLocalManifest';
import {
  SKILL_ENTRY_FILE,
  SKILL_EXAMPLES_FILE,
  SKILL_PRIMITIVES_FILE,
  renderScaffoldAgents,
  renderWriteVoyagerPluginSkillFiles,
  skillSiteFile,
} from './authoringDocs';
import { siteAnchors } from './siteFacts';
import { WRITE_PLUGIN_SKILL_NAME } from './skillLink';

const SKILL_DIR = join(process.cwd(), 'docs/public/skills', WRITE_PLUGIN_SKILL_NAME);
const files = renderWriteVoyagerPluginSkillFiles(DEFAULT_ADAPTERS);
const skill = files.get(SKILL_ENTRY_FILE)!;

function committedMarkdown(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.md'))
    .map((path) => path.split(sep).join('/'))
    .sort();
}

/** Relative Markdown link targets in a file, resolved against the skill folder. */
function linkedFiles(path: string, text: string): string[] {
  return [...text.matchAll(/\]\(([^)\s]+\.md)\)/g)].map((match) =>
    posix.normalize(posix.join(posix.dirname(path), match[1])),
  );
}

function jsonBlocks(text: string): unknown[] {
  return [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]));
}

describe('write-voyager-plugin skill', () => {
  it('is current: run `bun run skills:build` after changing sites, primitives or the contract (and delete a file it no longer writes)', () => {
    expect(committedMarkdown(SKILL_DIR)).toEqual([...files.keys()].sort());
    for (const [path, text] of files) {
      expect(readFileSync(join(SKILL_DIR, path), 'utf8'), path).toBe(text);
    }
  });

  it('opens with skill frontmatter an agent can parse', () => {
    const frontmatter = /^---\nname: ([^\n]+)\ndescription: ("[^\n]+")\n---\n/.exec(skill);
    expect(frontmatter?.[1]).toBe(WRITE_PLUGIN_SKILL_NAME);
    expect(JSON.parse(frontmatter![2])).toMatch(/^Voyager plugin/);
  });

  it('links every file it ships from SKILL.md, and every link resolves', () => {
    const fromSkill = new Set(linkedFiles(SKILL_ENTRY_FILE, skill));
    for (const path of files.keys()) {
      if (path !== SKILL_ENTRY_FILE) expect(fromSkill.has(path), path).toBe(true);
    }
    for (const [path, text] of files) {
      for (const target of linkedFiles(path, text)) expect(files.has(target), target).toBe(true);
    }
  });

  it('gives local authors concrete primitive versions and this tree’s Voyager version', () => {
    expect(skill).toContain(`Voyager ${EFFECTIVE_PLUGIN_ENGINE_VERSION}.`);
    expect(skill).not.toContain('plugin engine');
    const primitives = files.get(SKILL_PRIMITIVES_FILE)!;
    for (const text of files.values()) expect(text).not.toMatch(/sinceEngine next|>=next/);
    const primitiveFloors = [...primitives.matchAll(/^- \w+ \(sinceEngine ([^)]+)\):/gm)];
    expect(primitiveFloors.length).toBeGreaterThan(0);
    for (const match of primitiveFloors) expect(match[1]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('gives every site a file with its URL patterns and anchors', () => {
    for (const site of DEFAULT_ADAPTERS) {
      const text = files.get(skillSiteFile(site))!;
      for (const pattern of site.matches) expect(text).toContain(`- ${pattern}\n`);
      for (const key of siteAnchors(site)) expect(text).toContain(`- ${key}: `);
    }
  });

  it('keeps one example in SKILL.md and the rest, all importable, in examples.md', () => {
    const inline = jsonBlocks(skill);
    const more = jsonBlocks(files.get(SKILL_EXAMPLES_FILE)!);
    expect(inline).toHaveLength(1);
    expect(more.length).toBeGreaterThan(0);
    for (const manifest of [...inline, ...more] as { contributes: object }[]) {
      // Style files are not inlined here; the gate checks the rest of the manifest.
      const result = validateLocalManifest({
        ...manifest,
        contributes: { ...manifest.contributes, styles: [] },
      });
      expect(result.success ? [] : result.error).toEqual([]);
    }
  });

  it('keeps the files SKILL.md links under the pre-commit size limit', () => {
    // scripts/check-staged-size.mjs blocks any file over 20,000 bytes and exempts only SKILL.md.
    for (const [path, text] of files) {
      if (path !== SKILL_ENTRY_FILE) expect(Buffer.byteLength(text), path).toBeLessThan(20_000);
    }
  });
});

describe('scaffold AGENTS.md', () => {
  it.each(DEFAULT_ADAPTERS.map((site) => [site.label, site] as const))(
    'shows %s examples whose manifests carry only what that site accepts',
    (_label, site) => {
      const agents = renderScaffoldAgents(site);
      const manifests = jsonBlocks(agents) as { matches: string[]; contributes: unknown }[];
      expect(manifests.length).toBeGreaterThan(1);
      for (const manifest of manifests) {
        expect(manifest.matches).toEqual(site.matches);
        // Style files are not inlined here; the gate checks the rest of the manifest.
        const inline = {
          ...manifest,
          contributes: { ...(manifest.contributes as object), styles: [] },
        };
        const result = validateLocalManifest(inline);
        expect(result.success ? [] : result.error).toEqual([]);
      }
    },
  );
});
