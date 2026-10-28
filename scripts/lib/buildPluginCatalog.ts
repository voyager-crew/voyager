/**
 * Publish the bundled plugin catalog as per-host JSON files for the docs site.
 *
 * VitePress copies `docs/public/` to the root of its dist, so the files this
 * writes are served as `https://voyager.nagi.fun/catalog/hosts/<host>.json` —
 * exactly what the background refresher fetches (see
 * `src/features/plugins/remote/config.ts` and `HostCatalogSource`).
 *
 * The build reads the same per-site layout as `BundledCatalogPluginSource`:
 *
 *   catalog/sites/<site>/site.json                 the adapter as data
 *   catalog/sites/<site>/plugins/<id>/plugin.json  a declarative plugin
 *   catalog/sites/<site>/plugins/<id>/*.css        its style files
 *
 * `src/features/plugins/catalog/sites/index.ts` discovers the same files with
 * `import.meta.glob`, which does not exist under Bun — hence the disk walk here
 * rather than an import. `marketplace.json` is a hand-kept index of the site
 * plugins, checked by tests and appended by `plugin:new`, and is deliberately not read.
 *
 * Every `site.json` passes `validateSiteAdapterData` with no optional-section
 * issue (`readSiteAdapterData`), every `plugin.json` passes
 * `validateManifest` with its `contributes.styles[].file` inlined as `css`, and
 * a plugin may not target a URL its own site does not cover (plan D18). On top
 * of that, the primitive checks run here: a plugin may only
 * name primitives this build ships, its `engine` range may not admit a build
 * older than those primitives, and every semantic key it relies on must be
 * defined by its own site. A published site may not use a semantic key that
 * the oldest consumer would reject together with its whole adapter
 * (`sites/semanticKeyPublishing.ts`). Those rules live in `scripts/lib/pluginChecks.ts` so
 * that `bun run plugin:check` enforces exactly the same ones before a
 * contribution ever reaches this script. Any violation aborts the build: the
 * snapshot we ship is expected to be clean, and a broken host file would be
 * silently discarded by every client.
 *
 * Gemini and AI Studio (`sites/gemini`, `sites/aistudio`) are read and checked
 * like every site, so a broken manifest there still fails the build. Every supported
 * host, including AI Studio and Gemini Enterprise, receives its own locator profiles;
 * native plugins stay packaged (D14).
 *
 * Output is deterministic — sites, hosts and plugin ids are sorted — so a re-run
 * with the same `generatedAt` produces byte-identical files.
 *
 * Usage: bun scripts/build-plugin-catalog.ts [--out <dir>] [--now <ISO>]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveManifestEngine } from '../../src/features/plugins/engineVersion';
import { validateManifest } from '../../src/features/plugins/manifest/validate';
import {
  HOST_CATALOG_FORMAT,
  validateHostCatalogFile,
} from '../../src/features/plugins/remote/hostCatalogFile';
import {
  type PackagedSiteRecord,
  packagedSiteRecordToData,
} from '../../src/features/plugins/remote/packagedSiteRecord';
import { isStaticallyInjectedHost } from '../../src/features/plugins/sites/hostPolicy';
import { matchesAnyPattern } from '../../src/features/plugins/sites/matchPattern';
import {
  OLDEST_REMOTE_SITE_CONSUMER_VERSION,
  UNKNOWN_SEMANTIC_KEY_TOLERANT_VERSION,
  semanticKeysTooNewToPublish,
} from '../../src/features/plugins/sites/semanticKeyPublishing';
import type { SiteAdapterData } from '../../src/features/plugins/sites/siteAdapterData';
import {
  readSiteAdapterData,
  siteAdapterToData,
} from '../../src/features/plugins/sites/siteAdapterData';
import { resolveStyleFileContributions } from '../../src/features/plugins/sources/styleFiles';
import type { PluginManifest, SiteAdapter } from '../../src/features/plugins/types';
import { readPublishedSiteLocators } from './buildSiteLocators';
import { getCatalogRevision } from './catalogRevision';
import { pluginCoversHost, readSiteRevocations } from './catalogRevocations';
import {
  checkManifestAgainstSite,
  compareStrings,
  formatIssues,
  listSubdirectories,
  loadSiteAdapter,
} from './pluginChecks';

/** One published `hosts/<host>.json`. Consumed by `validateHostCatalogFile`. */
export interface HostCatalogFile {
  readonly format: typeof HOST_CATALOG_FORMAT;
  readonly host: string;
  readonly generatedAt: string;
  readonly site?: SiteAdapterData | PackagedSiteRecord;
  readonly plugins: readonly PluginManifest[];
  readonly revoked?: readonly string[];
}

export interface BuildOptions {
  readonly catalogDir: string;
  readonly generatedAt: string;
  readonly catalogRevision: number;
}

export interface WriteOptions extends BuildOptions {
  readonly outDir: string;
}

export interface WrittenHostCatalog {
  readonly host: string;
  readonly pluginCount: number;
  readonly path: string;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const DEFAULT_CATALOG_DIR = join(repoRoot, 'src/features/plugins/catalog');
export const DEFAULT_OUT_DIR = join(repoRoot, 'docs/public/catalog');

/** `https://<host>/*` with a literal host — the only form that yields a file. */
const CONCRETE_HTTPS_MATCH = /^https:\/\/([^/*]+)\/\*$/i;
/** Plain domain labels; anything else (ports, credentials, `..`) is a mistake. */
const PLAIN_HOST = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
/** Remove once the oldest remote consumer accepts underscores. */
const PUBLISHABLE_ROUTE_WORD = /^[a-z0-9-]{1,64}$/;

/** A `sites/<dir>` entry: its validated adapter plus its validated plugins. */
interface CatalogSite {
  /** Directory name under `sites/`; equals the adapter id. */
  readonly dir: string;
  readonly adapter: SiteAdapter;
  readonly plugins: readonly PluginManifest[];
  readonly revoked?: readonly string[];
}

/**
 * Read and validate `sites/<siteDir>/site.json`. Throws on anything unusable,
 * including a problem in an optional section (`modelPicker`, `bridge`): clients
 * drop such a section quietly, so publishing one would ship a capability no
 * client turns on, or a bridge policy that denies everything.
 */
function readSiteAdapter(catalogDir: string, siteDir: string): SiteAdapter {
  const sitePath = join(catalogDir, 'sites', siteDir, 'site.json');
  const displayPath = relative(catalogDir, sitePath);
  const load = loadSiteAdapter(sitePath, siteDir, displayPath);
  if (!load.adapter) throw new Error(load.issues.join('\n'));
  const { sectionIssues } = readSiteAdapterData(JSON.parse(readFileSync(sitePath, 'utf8')));
  if (sectionIssues.length > 0) {
    throw new Error(`${displayPath}: invalid site.json section\n${formatIssues(sectionIssues)}`);
  }
  return load.adapter;
}

/**
 * Read every `sites/<site>/plugins/<id>/plugin.json`, inline its CSS files and
 * validate it against both the manifest schema and its site.
 */
async function readSitePlugins(
  catalogDir: string,
  site: { readonly dir: string; readonly adapter: SiteAdapter },
): Promise<readonly PluginManifest[]> {
  const pluginsRoot = join(catalogDir, 'sites', site.dir, 'plugins');
  const manifests: PluginManifest[] = [];

  for (const pluginDir of listSubdirectories(pluginsRoot)) {
    const dir = join(pluginsRoot, pluginDir);
    const manifestPath = join(dir, 'plugin.json');
    if (!existsSync(manifestPath)) {
      throw new Error(`${relative(catalogDir, dir)}: missing plugin.json`);
    }
    const relPath = relative(catalogDir, manifestPath);

    const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const resolved = await resolveStyleFileContributions(parsed, relPath, async (file) =>
      readFileSync(join(dir, file), 'utf8'),
    );
    // Published floors must be concrete so released extensions can filter newer engines.
    const result = validateManifest(resolveManifestEngine(resolved));
    if (!result.success) {
      throw new Error(`${relPath}: invalid plugin manifest\n${formatIssues(result.error)}`);
    }
    const siteIssues = checkManifestAgainstSite(result.data, site, relPath);
    if (siteIssues.length > 0) throw new Error(siteIssues.join('\n'));
    manifests.push(result.data);
  }

  return manifests;
}

/** Walk `catalogDir/sites/` in directory order. Throws on the first problem. */
async function readCatalogSites(catalogDir: string): Promise<readonly CatalogSite[]> {
  const sitesRoot = join(catalogDir, 'sites');
  if (!existsSync(sitesRoot)) {
    throw new Error(`${sitesRoot}: the catalog has no sites/ directory`);
  }

  const sites: CatalogSite[] = [];
  for (const dir of listSubdirectories(sitesRoot)) {
    const base = readSiteAdapter(catalogDir, dir);
    const locators = readPublishedSiteLocators(catalogDir, dir);
    const adapter = locators ? { ...base, locators } : base;
    const plugins = await readSitePlugins(catalogDir, { dir, adapter });
    const revoked = readSiteRevocations(catalogDir, dir, plugins);
    sites.push({ dir, adapter, plugins, revoked });
  }
  return sites;
}

/**
 * Concrete hosts a manifest targets. Wildcard patterns such as
 * `https://*.frame.claudeusercontent.com/*` get no file — there is no single
 * host a client could derive from `location.host`.
 */
function concreteHosts(matches: readonly string[]): readonly string[] {
  const hosts = new Set<string>();
  for (const pattern of matches) {
    const match = CONCRETE_HTTPS_MATCH.exec(pattern.trim());
    if (!match) continue;
    const host = match[1].toLowerCase();
    if (!PLAIN_HOST.test(host)) {
      throw new Error(`Unsupported host "${host}" in match pattern "${pattern}"`);
    }
    hosts.add(host);
  }
  return [...hosts];
}

/**
 * Every release that fetches this host file must read the site's keys, or it
 * would drop all of the site's remote selector fixes for one key it lacks.
 */
function assertPublishableSemanticKeys(host: string, site: CatalogSite): void {
  const tooNew = semanticKeysTooNewToPublish(Object.keys(site.adapter.selectors));
  if (tooNew.length === 0) return;
  const keys = tooNew.map(({ key, since }) => `  - selectors.${key} (read since ${since})`);
  throw new Error(
    [
      `${host}: sites/${site.dir}/site.json uses keys Voyager ${OLDEST_REMOTE_SITE_CONSUMER_VERSION} cannot read;`,
      'that release would discard the whole remote adapter:',
      ...keys,
      `Publish them once OLDEST_REMOTE_SITE_CONSUMER_VERSION reaches ${UNKNOWN_SEMANTIC_KEY_TOLERANT_VERSION}`,
      '(src/features/plugins/sites/semanticKeyPublishing.ts), or keep them out of published sites.',
    ].join('\n'),
  );
}

function assertPublishableRouteWords(host: string, site: CatalogSite): void {
  const unreadable = (site.adapter.routeWords ?? []).filter(
    (word) => !PUBLISHABLE_ROUTE_WORD.test(word),
  );
  if (unreadable.length === 0) return;
  throw new Error(
    [
      `${host}: sites/${site.dir}/site.json uses route words Voyager 2.2.1 cannot read;`,
      'that release would discard the whole remote site record:',
      ...unreadable.map((word) => `  - routeWords: "${word}"`),
    ].join('\n'),
  );
}

/**
 * Build every host file from a catalog directory. Pure: nothing is written and
 * nothing outside `catalogDir` is read.
 */
export async function buildHostCatalogs(
  options: BuildOptions,
): Promise<Map<string, HostCatalogFile>> {
  const sites = await readCatalogSites(options.catalogDir);

  const byHost = new Map<string, PluginManifest[]>();
  for (const site of sites) {
    const hosts = new Set([
      ...concreteHosts(site.adapter.matches),
      ...site.plugins.flatMap((plugin) => concreteHosts(plugin.matches)),
    ]);
    // A locator-only native host has no remote plugin authority, including revocations.
    if (
      existsSync(join(options.catalogDir, 'sites', site.dir, 'revoked.json')) &&
      ![...hosts].some((host) => !isStaticallyInjectedHost(host))
    ) {
      throw new Error(
        `sites/${site.dir}/revoked.json: no concrete host allows remote catalog publication; revocations would never reach clients`,
      );
    }
    // A narrowed matches list must also stop bundled copies on the site's other hosts.
    if (site.plugins.length || site.revoked?.length || site.adapter.locators) {
      for (const host of hosts) {
        if (!byHost.has(host)) byHost.set(host, []);
      }
    }
    for (const manifest of site.plugins) {
      for (const host of concreteHosts(manifest.matches)) {
        // Native official plugins are validated above but remain packaged.
        if (isStaticallyInjectedHost(host)) continue;
        const bucket = byHost.get(host);
        if (bucket) bucket.push(manifest);
        else byHost.set(host, [manifest]);
      }
    }
  }

  const files = new Map<string, HostCatalogFile>();
  for (const host of [...byHost.keys()].sort(compareStrings)) {
    const plugins = [...(byHost.get(host) ?? [])].sort((a, b) => compareStrings(a.id, b.id));
    const site = sites.find((entry) =>
      matchesAnyPattern(`https://${host}/`, entry.adapter.matches),
    );
    // Every plugin lives under a site whose matches cover its own, so a host
    // without an adapter means the layout is broken, not that the site is
    // optional — publishing it would strip the selectors clients rely on.
    if (!site) {
      throw new Error(`${host}: no site.json under sites/ covers this host`);
    }
    const packaged = isStaticallyInjectedHost(host);
    // Strict D14 clients skip these hosts; v1.9 rejects their newer keys, and current readers tolerate them.
    if (!packaged) {
      assertPublishableSemanticKeys(host, site);
      assertPublishableRouteWords(host, site);
    }
    const revoked = packaged
      ? []
      : [
          ...new Set([
            ...(site.revoked ?? []),
            ...site.plugins
              .filter((plugin) => !pluginCoversHost(plugin.matches, host))
              .map((plugin) => plugin.id),
          ]),
        ].sort(compareStrings);
    const adapter = { ...site.adapter, catalogRevision: options.catalogRevision };
    files.set(host, {
      format: HOST_CATALOG_FORMAT,
      host,
      generatedAt: options.generatedAt,
      site: packaged ? packagedSiteRecordToData(adapter) : siteAdapterToData(adapter),
      plugins,
      ...(revoked.length ? { revoked } : {}),
    });
  }
  return files;
}

/**
 * Build and write `<outDir>/hosts/<host>.json`, dropping stale host files that
 * this run no longer produces. Every file passes `validateHostCatalogFile`
 * before it lands, so a client-rejecting file fails the build instead of the
 * fetch.
 */
export async function writeHostCatalogs(
  options: WriteOptions,
): Promise<readonly WrittenHostCatalog[]> {
  const files = await buildHostCatalogs(options);
  const hostsDir = join(options.outDir, 'hosts');
  mkdirSync(hostsDir, { recursive: true });

  const written = new Set<string>();
  const results: WrittenHostCatalog[] = [];
  for (const [host, file] of files) {
    const json = `${JSON.stringify(file, null, 2)}\n`;
    // Validate what actually lands on disk, not the in-memory object: JSON
    // drops `undefined` fields and the client only ever sees the parsed form.
    const validation = validateHostCatalogFile(JSON.parse(json) as unknown, host);
    if (!validation) {
      throw new Error(`${host}: host catalog file was rejected by validateHostCatalogFile`);
    }
    const fileIssues = [...validation.issues, ...validation.siteIssues];
    if (fileIssues.length > 0) {
      throw new Error(`${host}: host catalog file has issues\n${formatIssues(fileIssues)}`);
    }
    if (validation.manifests.length !== file.plugins.length) {
      throw new Error(
        `${host}: ${file.plugins.length - validation.manifests.length} plugin(s) were dropped by validateHostCatalogFile`,
      );
    }

    const fileName = `${host}.json`;
    const filePath = join(hostsDir, fileName);
    writeFileSync(filePath, json, 'utf8');
    written.add(fileName);
    results.push({ host, pluginCount: file.plugins.length, path: filePath });
  }

  for (const name of readdirSync(hostsDir)) {
    if (!name.endsWith('.json') || written.has(name)) continue;
    rmSync(join(hostsDir, name), { force: true });
  }

  return results;
}

export interface CliOptions {
  readonly outDir: string;
  readonly now: string;
}

export function parseArgs(argv: readonly string[], defaults: CliOptions): CliOptions {
  let outDir = defaults.outDir;
  let now = defaults.now;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const eq = arg.indexOf('=');
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const readValue = (): string => {
      const value = eq === -1 ? argv[++index] : arg.slice(eq + 1);
      if (!value) throw new Error(`Missing value for ${flag}`);
      return value;
    };

    if (flag === '--out') outDir = resolve(readValue());
    else if (flag === '--now') now = readValue();
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return { outDir, now };
}

/** Repo-relative when it stays inside the repo, absolute otherwise. */
function displayPath(target: string): string {
  const rel = relative(repoRoot, target);
  return rel && !rel.startsWith('..') ? rel : target;
}

export async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2), {
    outDir: DEFAULT_OUT_DIR,
    now: new Date().toISOString(),
  });

  const catalogRevision = getCatalogRevision(repoRoot, 'production');
  const results = await writeHostCatalogs({
    catalogDir: DEFAULT_CATALOG_DIR,
    outDir: options.outDir,
    generatedAt: options.now,
    catalogRevision,
  });

  for (const result of results) {
    console.log(`  ${result.host} — ${result.pluginCount} plugin(s) → ${displayPath(result.path)}`);
  }
  console.log(`Wrote ${results.length} host catalog file(s) to ${displayPath(options.outDir)}`);
}
