import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_CATALOG_DIR, writeHostCatalogs } from '../build-plugin-catalog';

export const GENERATED_AT = '2026-01-02T03:04:05.000Z';
export const SOURCE_REVISION = 42;

/** host -> adapter id the published `site` section must carry. */
export const EXPECTED_SITES: Readonly<Record<string, string>> = {
  'claude.ai': 'claude',
  'chatgpt.com': 'chatgpt',
  'chat.openai.com': 'chatgpt',
  'chat.deepseek.com': 'deepseek',
  'www.kimi.com': 'kimi',
};

const tempRoots: string[] = [];

export function makeTempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'gv-catalog-'));
  tempRoots.push(root);
  return root;
}

export function build(outDir: string, catalogDir = DEFAULT_CATALOG_DIR) {
  return writeHostCatalogs({
    catalogDir,
    outDir,
    generatedAt: GENERATED_AT,
    catalogRevision: SOURCE_REVISION,
  });
}

export function readHostFile(outDir: string, host: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(outDir, 'hosts', `${host}.json`), 'utf8')) as Record<
    string,
    unknown
  >;
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export interface FixtureOverrides {
  readonly matches?: readonly string[];
  /** Merged into the plugin manifest, so one knob per rule under test. */
  readonly manifest?: Record<string, unknown>;
  /** Merged into the site adapter's semantic selectors. */
  readonly selectors?: Record<string, string>;
  /** Merged into the site adapter itself (optional sections). */
  readonly site?: Record<string, unknown>;
}

/**
 * A minimal catalog with one site and one plugin, so a rule can be exercised
 * without touching the shipped snapshot.
 */
export function makeFixtureCatalog(overrides: FixtureOverrides = {}): string {
  const catalogDir = join(makeTempDir(), 'catalog');
  const siteDir = join(catalogDir, 'sites', 'demo');
  const pluginDir = join(siteDir, 'plugins', 'widen');

  writeJson(join(siteDir, 'site.json'), {
    id: 'demo',
    label: 'Demo',
    matches: ['https://demo.example/*'],
    selectors: { composer: 'textarea', ...overrides.selectors },
    theme: { hostSelector: 'html', lightSelector: 'html.light', darkSelector: 'html.dark' },
    capabilities: ['chat'],
    conversationIdPattern: '^/c/([^/?#]+)',
    ...overrides.site,
  });
  writeJson(join(pluginDir, 'plugin.json'), {
    id: 'demo.widen',
    name: 'Demo · Widen',
    version: '1.0.0',
    description: 'A fixture plugin.',
    author: 'voyager-official',
    category: 'readability',
    license: 'MIT',
    engine: '>=1.2.0',
    tier: 'declarative',
    matches: overrides.matches ?? ['https://demo.example/*'],
    contributes: { styles: [{ file: 'style.css' }] },
    ...overrides.manifest,
  });
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'style.css'), 'body { color: red; }\n', 'utf8');

  return catalogDir;
}

/** Native hosts receive locator data while official plugins remain packaged (D14). */
export const NATIVE_HOSTS = [
  'gemini.google.com',
  'business.gemini.google',
  'aistudio.google.com',
  'aistudio.google.cn',
] as const;

export const PACKAGED_SITES = [
  {
    id: 'gemini',
    label: 'Gemini',
    matches: ['https://gemini.google.com/*', 'https://business.gemini.google/*'],
  },
  {
    id: 'aistudio',
    label: 'AI Studio',
    matches: ['https://aistudio.google.com/*', 'https://aistudio.google.cn/*'],
  },
] as const;

/**
 * The demo fixture plus Gemini and AI Studio sites, each with one CSS-only
 * plugin that would be valid anywhere. `gemini` is merged into the Gemini one.
 */
export function makePackagedFixtureCatalog(gemini: Record<string, unknown> = {}): string {
  const catalogDir = makeFixtureCatalog();
  for (const site of PACKAGED_SITES) {
    const siteDir = join(catalogDir, 'sites', site.id);
    const pluginDir = join(siteDir, 'plugins', 'compact');
    writeJson(join(siteDir, 'site.json'), {
      ...site,
      selectors: { composer: 'textarea' },
      theme: { hostSelector: 'body', lightSelector: 'body.light', darkSelector: 'body.dark' },
      capabilities: ['chat'],
    });
    writeJson(join(pluginDir, 'plugin.json'), {
      id: `voyager.${site.id}-compact`,
      name: `${site.label} · Compact`,
      version: '1.0.0',
      description: 'A fixture plugin.',
      author: 'voyager-official',
      category: 'readability',
      license: 'MIT',
      engine: '>=1.2.0',
      tier: 'declarative',
      matches: site.matches,
      contributes: { styles: [{ file: 'style.css' }] },
      ...(site.id === 'gemini' ? gemini : {}),
    });
    writeFileSync(join(pluginDir, 'style.css'), 'body { color: red; }\n', 'utf8');
  }
  return catalogDir;
}

/** Removes every temp dir a test made; call from afterEach. */
export function removeTempDirs(): void {
  for (const root of tempRoots.splice(0)) rmSync(root, { force: true, recursive: true });
}
