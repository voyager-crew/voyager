/**
 * The published CLI is one bundled file, so these tests build it into a temp
 * folder and run it under Node, the way an agent's `npx` would: it must judge
 * every plugin exactly as the popup's import does, and carry nothing that
 * needs a browser.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readLocalPluginFiles } from '@/features/plugins/local/localPluginFiles';
import { validateLocalManifest } from '@/features/plugins/local/validateLocalManifest';
import type { ManifestIssue } from '@/features/plugins/manifest/validate';
import { DEFAULT_ADAPTERS } from '@/features/plugins/sites/registry';
import { EFFECTIVE_PLUGIN_ENGINE_VERSION } from '@/features/plugins/verbs/contracts';

import { listSkillMarkdown } from '../src/skill';
import { CORPUS, type CorpusCase } from './corpus';

const PACKAGE_DIR = resolve(__dirname, '..');
const ROOT = resolve(PACKAGE_DIR, '../..');
const SKILL_DIR = join(ROOT, 'docs/public/skills/write-voyager-plugin');
const CREATE_DIR = join(ROOT, 'docs/public/create');

let work = '';
let cli = '';

function run(...args: string[]) {
  const result = spawnSync('node', [cli, ...args], { encoding: 'utf8', cwd: work });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function writeCase(entry: CorpusCase): string {
  const dir = join(work, 'corpus', entry.name);
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(entry.files)) writeFileSync(join(dir, name), text);
  return dir;
}

/** The popup's Import files with the files `check` picks: plugin.json and the CSS beside it. */
async function popupIssues(entry: CorpusCase): Promise<ManifestIssue[]> {
  const files = Object.entries(entry.files)
    .filter(([name]) => name === 'plugin.json' || name.endsWith('.css'))
    .map(([name, text]) => ({ name, text }));
  const read = await readLocalPluginFiles(files);
  if (!read.success) return read.error;
  const result = validateLocalManifest(read.data);
  return result.success ? [] : result.error;
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'voyager-cli-'));
  const build = spawnSync('bun', [join(PACKAGE_DIR, 'build.ts'), join(work, 'dist')], {
    encoding: 'utf8',
  });
  if (build.status !== 0) {
    throw new Error(`CLI build failed (needs bun on PATH):\n${build.stderr}${build.stdout}`);
  }
  cli = join(work, 'dist', 'cli.mjs');
}, 60_000);

afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

describe('create-voyager-plugin check', () => {
  it.each(CORPUS.map((entry) => [entry.name, entry] as const))(
    'judges %s exactly as the popup import does',
    async (_name, entry) => {
      const expected = await popupIssues(entry);
      expect(expected.length === 0).toBe(entry.imports);
      const result = run('check', writeCase(entry), '--json');
      expect(JSON.parse(result.stdout)).toEqual(expected);
      expect(result.code).toBe(entry.imports ? 0 : 1);
    },
  );

  it('checks the contributor next notation for the real DeepSeek table-copy plugin', () => {
    const result = run(
      'check',
      join(ROOT, 'src/features/plugins/catalog/sites/deepseek/plugins/table-copy'),
      '--json',
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([]);
  });

  it('prints one path: message line per problem and exits 1', () => {
    const entry = CORPUS.find((candidate) => candidate.name === 'class-without-prefix')!;
    const result = run('check', writeCase(entry));
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/\n {2}contributes\.domOps\[0\]\.className: "rounded" must /);
  });

  it('reports a folder without plugin.json instead of crashing', () => {
    mkdirSync(join(work, 'empty'), { recursive: true });
    const result = run('check', join(work, 'empty'), '--json');
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual([
      { path: 'file', message: `no plugin.json in ${join(work, 'empty')}` },
    ]);
  });
});

describe('create-voyager-plugin init', () => {
  it.each(DEFAULT_ADAPTERS.map((site) => [site.id] as const))(
    'scaffolds a %s plugin that check accepts, with no other JSON file',
    (siteId) => {
      const dir = join(work, 'init', `${siteId}-plugin`);
      expect(run('init', dir, '--site', siteId).code).toBe(0);
      expect(readdirSync(dir).sort()).toEqual(['AGENTS.md', 'plugin.json', 'style.css']);
      expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toContain('"NOT POSSIBLE: ');
      const check = run('check', dir);
      expect(check.stdout).toContain(`imports as local.me.${siteId}-plugin 1.0.0`);
      expect(check.code).toBe(0);
    },
  );

  it('refuses to overwrite a plugin unless --force', () => {
    const dir = join(work, 'init', 'twice');
    expect(run('init', dir, '--site', 'claude').code).toBe(0);
    const again = run('init', dir, '--site', 'claude');
    expect(again.code).toBe(2);
    expect(again.stderr).toContain('--force');
    expect(run('init', dir, '--site', 'claude', '--force').code).toBe(0);
  });

  it('names the valid sites when --site is missing or unknown', () => {
    for (const args of [
      ['init', 'x'],
      ['init', 'x', '--site', 'bing'],
    ]) {
      const result = run(...args);
      expect(result.code).toBe(2);
      for (const site of DEFAULT_ADAPTERS) expect(result.stderr).toContain(site.id);
    }
  });
});

describe('create-voyager-plugin bundle', () => {
  it('reports the Voyager version it was built from and checks for', () => {
    const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      version: string;
    };
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')) as {
      version: string;
      dependencies?: unknown;
    };
    expect(pkg.version).toBe(root.version);
    expect(pkg.dependencies).toBeUndefined();
    const result = run('--version');
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      `create-voyager-plugin ${root.version} (checks plugins for Voyager ${EFFECTIVE_PLUGIN_ENGINE_VERSION})\n`,
    );
  });

  it('needs no browser API and imports nothing but Node built-ins', () => {
    const code = readFileSync(cli, 'utf8');
    const browserUses = code.match(/\b(?:chrome|browser|window)\s*(?:\?\.|\.|\[)/g) ?? [];
    expect(browserUses).toEqual([]);
    const imports = [...code.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) expect(specifier).toMatch(/^node:/);
  });

  it('writes the committed write-voyager-plugin skill folder with --out', () => {
    const out = join(work, 'skill');
    expect(run('skill', '--out', out).code).toBe(0);
    const committed = listSkillMarkdown(SKILL_DIR);
    expect(listSkillMarkdown(out)).toEqual(committed);
    for (const path of committed) {
      expect(readFileSync(join(out, path), 'utf8'), path).toBe(
        readFileSync(join(SKILL_DIR, path), 'utf8'),
      );
    }
  });

  it('writes the committed chat pages with create-pages --out', () => {
    const out = join(work, 'create');
    expect(run('create-pages', '--out', out).code).toBe(0);
    const committed = listSkillMarkdown(CREATE_DIR);
    // One page per site plus the shared scripted page.
    expect(committed.length).toBe(DEFAULT_ADAPTERS.length + 1);
    expect(listSkillMarkdown(out)).toEqual(committed);
    for (const path of committed) {
      expect(readFileSync(join(out, path), 'utf8'), path).toBe(
        readFileSync(join(CREATE_DIR, path), 'utf8'),
      );
    }
  });

  it('prints every skill file, SKILL.md first, without --out', () => {
    const result = run('skill');
    expect(result.code).toBe(0);
    expect(result.stdout.startsWith(readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8'))).toBe(true);
    for (const path of listSkillMarkdown(SKILL_DIR)) {
      expect(result.stdout).toContain(readFileSync(join(SKILL_DIR, path), 'utf8'));
    }
  });
});
