/**
 * Bundle the CLI into one dependency-free ESM file: `bun packages/create-voyager-plugin/build.ts [outdir]`.
 *
 * The extension's own gate modules go in as they are. Build-time seams
 * replace the Vite-only parts:
 * - `catalog/sites/index.ts` (it uses `import.meta.glob`) becomes
 *   `src/bundledSites.ts`, fed every `site.json` read from disk in glob order;
 * - `verbs/contractModules.ts` becomes the same `verbs/<name>/contract.ts`
 *   files found on disk (`scripts/lib/primitiveContractsSeam.ts`, shared with
 *   the Bun scripts);
 * - any other module that still reaches for `import.meta.glob` or
 *   `import.meta.env` fails the build, instead of crashing under Node later.
 *
 * Without an `[outdir]` (`bun run cli:build`, and so `skills:build`) it also
 * rewrites the primitive name enums of `docs/public/plugin.schema.json` from
 * the primitive folders, so adding a primitive needs no schema edit by hand;
 * `manifest/schema.test.ts` fails while they are stale.
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import {
  CONTRACT_MODULES_FILE,
  listPrimitiveFolders,
  renderContractModulesSource,
} from '../../scripts/lib/primitiveContractsSeam';
import { PRIMITIVE_NAME_PATTERN } from '../../src/features/plugins/verbs/contractTypes';

const PACKAGE_DIR = import.meta.dir;
const ROOT = resolve(PACKAGE_DIR, '../..');
const PLUGIN_SCHEMA = join(ROOT, 'docs/public/plugin.schema.json');
const SITES_DIR = join(ROOT, 'src/features/plugins/catalog/sites');
const SITES_INDEX = join(SITES_DIR, 'index.ts');
const SHIM = join(PACKAGE_DIR, 'src/bundledSites.ts');
const VIRTUAL_ENTRIES = 'voyager:site-entries';

/** What `import.meta.glob('./*\/site.json')` hands `listBundledSiteEntries`, from disk. */
function readSiteEntries(): { siteDir: string; path: string; siteJson: string }[] {
  return readdirSync(SITES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(SITES_DIR, entry.name, 'site.json')))
    .map((entry) => ({ glob: `./${entry.name}/site.json`, siteDir: entry.name }))
    .sort((a, b) => (a.glob < b.glob ? -1 : a.glob > b.glob ? 1 : 0))
    .map(({ siteDir }) => ({
      siteDir,
      path: `sites/${siteDir}/site.json`,
      siteJson: readFileSync(join(SITES_DIR, siteDir, 'site.json'), 'utf8'),
    }));
}

const VITE_ONLY = /import\.meta\.(?:glob|env)\b/;

const voyagerSeams: Bun.BunPlugin = {
  name: 'voyager-seams',
  setup(build) {
    build.onResolve({ filter: new RegExp(`^${VIRTUAL_ENTRIES}$`) }, () => ({
      path: VIRTUAL_ENTRIES,
      namespace: 'voyager',
    }));
    build.onLoad({ filter: /.*/, namespace: 'voyager' }, () => ({
      contents: `export default ${JSON.stringify(readSiteEntries())};`,
      loader: 'js',
    }));
    build.onLoad({ filter: /\.tsx?$/ }, (args) => {
      if (args.path === SITES_INDEX) {
        return { contents: `export * from ${JSON.stringify(SHIM)};`, loader: 'ts' };
      }
      if (args.path === CONTRACT_MODULES_FILE) {
        return { contents: renderContractModulesSource(), loader: 'ts' };
      }
      const contents = readFileSync(args.path, 'utf8');
      const code = contents.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
      if (VITE_ONLY.test(code)) {
        throw new Error(`${args.path} uses Vite-only import.meta APIs; give the CLI a seam for it`);
      }
      return { contents, loader: args.path.endsWith('x') ? 'tsx' : 'ts' };
    });
  },
};

export async function buildCli(outdir: string): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(PACKAGE_DIR, 'src/cli.ts')],
    outdir,
    naming: 'cli.mjs',
    target: 'node',
    format: 'esm',
    banner: '#!/usr/bin/env node',
    minify: { whitespace: false, identifiers: false, syntax: true },
    plugins: [voyagerSeams],
  });
  if (!result.success) {
    throw new AggregateError(result.logs, 'create-voyager-plugin build failed');
  }
  return join(outdir, 'cli.mjs');
}

/** Each primitive enum in the schema sits right after the primitive name pattern. */
const SCHEMA_PRIMITIVE_ENUM = new RegExp(
  `(${JSON.stringify(PRIMITIVE_NAME_PATTERN.source).replace(/[$()*+.?[\\\]^{|}]/g, '\\$&')},\\n( *)"enum": \\[)[^\\]]*\\]`,
  'g',
);

/** Rewrite the schema's primitive enums to the sorted primitive folders; true when it changed. */
export function syncSchemaPrimitiveEnums(): boolean {
  const names = listPrimitiveFolders();
  const text = readFileSync(PLUGIN_SCHEMA, 'utf8');
  let found = 0;
  const next = text.replace(SCHEMA_PRIMITIVE_ENUM, (_match, head: string, indent: string) => {
    found += 1;
    const items = names.map((name) => `${indent}  ${JSON.stringify(name)}`).join(',\n');
    return `${head}\n${items}\n${indent}]`;
  });
  if (found !== 2) {
    throw new Error(
      `expected 2 primitive enums in ${relative(ROOT, PLUGIN_SCHEMA)}, found ${found}`,
    );
  }
  if (next === text) return false;
  writeFileSync(PLUGIN_SCHEMA, next);
  return true;
}

if (import.meta.main) {
  const outArg = process.argv[2];
  const file = await buildCli(resolve(outArg ?? join(PACKAGE_DIR, 'dist')));
  process.stdout.write(`built ${relative(ROOT, file)}\n`);
  // A build into an explicit outdir (the CLI tests) leaves the repository alone.
  if (!outArg && syncSchemaPrimitiveEnums()) {
    process.stdout.write(`updated ${relative(ROOT, PLUGIN_SCHEMA)}\n`);
  }
}
