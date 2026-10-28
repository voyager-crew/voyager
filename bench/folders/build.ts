/**
 * Bundles the bench entries with the repository's own esbuild, resolving the
 * `@/` aliases from tsconfig.json, `?raw` CSS imports as text, eager
 * and lazy `import.meta.glob` calls as static imports, and `webextension-polyfill` to
 * the in-memory stub.
 */

import { type Plugin, build } from 'esbuild';
import { globSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(BENCH_DIR, '../..');

const rawImports: Plugin = {
  name: 'raw-imports',
  setup(context) {
    context.onResolve({ filter: /\?raw$/ }, (args) => {
      const file = args.path.replace(/\?raw$/, '');
      return {
        path: file.startsWith('@/')
          ? path.join(REPO_ROOT, 'src', file.slice(2))
          : path.resolve(args.resolveDir, file),
        namespace: 'raw',
      };
    });
    context.onLoad({ filter: /.*/, namespace: 'raw' }, async (args) => ({
      contents: await readFile(args.path, 'utf8'),
      loader: 'text',
    }));
  },
};

// `import.meta.glob(<pattern or [patterns, '!excluded']>, { eager?, import?, query? })`, as src/ writes it.
const GLOB_CALL =
  /import\.meta\.glob(?:<[^(]*>)?\(\s*((['"])[^'"]+\2|\[[^\]]*\])\s*,\s*(\{[^}]*\})\s*,?\s*\)/g;

function globPatterns(argument: string): string[] {
  return [...argument.matchAll(/(['"])([^'"]+)\1/g)].map((match) => match[2]);
}

function globOption(options: string, name: string): string | undefined {
  return options.match(new RegExp(`\\b${name}\\s*:\\s*(['"])([^'"]*)\\1`))?.[2];
}

/**
 * Expands one glob into imports plus the object literal Vite would produce. A lazy
 * glob's loaders resolve the same static imports: the bench measures work, not chunks.
 */
function expandGlob(dir: string, patterns: string[], options: string, prefix: string) {
  const eager = /\beager\s*:\s*true\b/.test(options);
  const imported = globOption(options, 'import');
  const query = globOption(options, 'query') ?? '';
  const excluded = new Set(
    patterns
      .filter((pattern) => pattern.startsWith('!'))
      .flatMap((pattern) => globSync(pattern.slice(1), { cwd: dir })),
  );
  const files = patterns
    .filter((pattern) => !pattern.startsWith('!'))
    .flatMap((pattern) => globSync(pattern, { cwd: dir }))
    .filter((file) => !excluded.has(file))
    .sort();
  const imports = files.map((file, index) => {
    const source = JSON.stringify(path.resolve(dir, file) + query);
    const name = `${prefix}${index}`;
    if (!imported) return `import * as ${name} from ${source};`;
    if (imported === 'default') return `import ${name} from ${source};`;
    return `import { ${imported} as ${name} } from ${source};`;
  });
  const keyOf = (file: string) => (file.startsWith('.') ? file : `./${file}`);
  const value = (index: number) =>
    eager ? `${prefix}${index}` : `() => Promise.resolve(${prefix}${index})`;
  const entries = files.map((file, index) => `${JSON.stringify(keyOf(file))}: ${value(index)}`);
  return { imports, literal: `({ ${entries.join(', ')} })` };
}

// src/ discovers sites, primitives and their messages with Vite's import.meta.glob,
// which esbuild leaves as a runtime call that does not exist.
const importMetaGlob: Plugin = {
  name: 'import-meta-glob',
  setup(context) {
    context.onLoad({ filter: /\.tsx?$/ }, async (args) => {
      const contents = await readFile(args.path, 'utf8');
      if (!contents.includes('import.meta.glob')) return undefined;
      const imports: string[] = [];
      let count = 0;
      const rewritten = contents.replace(GLOB_CALL, (_call, argument, _quote, options) => {
        const patterns = globPatterns(argument);
        const expanded = expandGlob(
          path.dirname(args.path),
          patterns,
          options,
          `__glob${count++}_`,
        );
        imports.push(...expanded.imports);
        return expanded.literal;
      });
      return {
        contents: `${imports.join('\n')}\n${rewritten}`,
        loader: args.path.endsWith('x') ? 'tsx' : 'ts',
      };
    });
  },
};

export async function bundle(entry: string, platform: 'node' | 'browser'): Promise<string> {
  const result = await build({
    entryPoints: [path.join(BENCH_DIR, entry)],
    bundle: true,
    write: false,
    format: 'esm',
    platform,
    target: platform === 'node' ? 'node20' : 'chrome120',
    absWorkingDir: REPO_ROOT,
    tsconfig: path.join(REPO_ROOT, 'tsconfig.json'),
    jsx: 'automatic',
    jsxImportSource: 'preact',
    // Production builds minify; keep names so a profile of the page stays readable.
    minifySyntax: true,
    minifyWhitespace: true,
    keepNames: false,
    sourcemap: false,
    logLevel: 'error',
    define: {
      'import.meta.env': '{}',
      'process.env.NODE_ENV': '"production"',
    },
    alias: {
      'webextension-polyfill': path.join(BENCH_DIR, 'stubs/webextensionPolyfill.ts'),
    },
    plugins: [rawImports, importMetaGlob],
  });
  return result.outputFiles[0].text;
}
