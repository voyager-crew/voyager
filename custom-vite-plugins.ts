import fs from 'fs';
import { basename, resolve } from 'path';
import type { NormalizedInputOptions, NormalizedOutputOptions, OutputChunk } from 'rollup';
import type { Plugin, PluginOption } from 'vite';

import {
  CONTENT_STYLE_FILE_NAME,
  assembleContentStyle,
  listContentStyleParts,
} from './scripts/lib/contentStyle';

// Emits contentStyle.css from its parts where public/ used to supply it. It is
// emitted at buildStart so the asset is already in the bundle when CRXJS checks
// the manifest's files, and each part is watched for `vite build --watch`.
export function contentStyleAsset(repoRoot: string): PluginOption {
  return {
    name: 'voyager-content-style',
    apply: 'build',
    buildStart() {
      for (const part of listContentStyleParts(repoRoot)) this.addWatchFile(part);
      this.emitFile({
        type: 'asset',
        fileName: CONTENT_STYLE_FILE_NAME,
        source: assembleContentStyle(repoRoot),
      });
    },
  };
}

// plugin to remove dev icons from prod build
export function stripDevIcons(isDev: boolean) {
  if (isDev) return null;

  return {
    name: 'strip-dev-icons',
    resolveId(source: string) {
      return source === 'virtual-module' ? source : null;
    },
    renderStart(outputOptions: NormalizedOutputOptions, _inputOptions: NormalizedInputOptions) {
      const outDir = outputOptions.dir ?? '';

      fs.rm(resolve(outDir, 'dev-icon-32.png'), () =>
        console.log(`Deleted dev-icon-32.png from prod build`),
      );
      fs.rm(resolve(outDir, 'dev-icon-128.png'), () =>
        console.log(`Deleted dev-icon-128.png from prod build`),
      );

      // Remove assets directory if it exists
      const assetsDir = resolve(outDir, 'assets');
      fs.rm(assetsDir, { recursive: true, force: true }, () =>
        console.log(`Deleted assets/ directory from prod build`),
      );
    },
    writeBundle(outputOptions: NormalizedOutputOptions) {
      const outDir = outputOptions.dir ?? '';
      // Remove .vite directory (Vite's internal manifest, not needed for extension)
      const viteDir = resolve(outDir, '.vite');
      fs.rm(viteDir, { recursive: true, force: true }, () =>
        console.log(`Deleted .vite/ directory from prod build`),
      );
    },
  };
}

type LocaleMessages = Record<string, { message: string }>;

function stripDescriptions(raw: unknown): LocaleMessages {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Locale messages must be an object');
  }
  return Object.fromEntries(
    Object.entries(raw).map(([key, entry]: [string, unknown]) => {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        !('message' in entry) ||
        typeof entry.message !== 'string'
      ) {
        throw new Error(`Locale message ${key} must contain a string message`);
      }
      return [key, { message: entry.message }];
    }),
  );
}

const LOCALE_MESSAGE_PATH =
  /(?:^|\/)src\/(?:locales\/([^/]+)\/messages\.json|features\/plugins\/verbs\/[^/]+\/messages\/([^/]+)\.json)$/;

function localeMessageLanguage(id: string): string | undefined {
  // Raw and URL imports must retain Vite's normal asset semantics.
  if (id.includes('?')) return undefined;
  const match = LOCALE_MESSAGE_PATH.exec(id.replace(/\\/g, '/'));
  return match?.[1] ?? match?.[2];
}

export function localeMessagesChunk(id: string): string | undefined {
  const language = localeMessageLanguage(id);
  return language && language !== 'en' ? `locale-${language}` : undefined;
}

// Run after vite:json and replace its expanded object with one parsed string.
// Read the source JSON so this stays independent of Vite's generated ESM shape.
export function localeMessages(): Plugin {
  return {
    name: 'locale-messages',
    enforce: 'post',
    transform(_code, id) {
      if (!localeMessageLanguage(id)) return null;
      const raw: unknown = JSON.parse(fs.readFileSync(id, 'utf-8'));
      return {
        code: `export default JSON.parse(${JSON.stringify(JSON.stringify(stripDescriptions(raw)))});`,
        map: null,
      };
    },
  };
}

// plugin to support i18n
export function crxI18n(options: {
  localize: boolean;
  src: string;
  stripDescriptions?: boolean;
}): PluginOption {
  if (!options.localize) return null;

  const getJsonFiles = (dir: string): Array<string> => {
    const files = fs.readdirSync(dir, { recursive: true }) as string[];
    return files.filter((file) => !!file && file.endsWith('.json'));
  };
  const entry = resolve(__dirname, options.src);
  const localeFiles = getJsonFiles(entry);
  const files = localeFiles.map((file) => {
    const raw: unknown = JSON.parse(fs.readFileSync(resolve(entry, file), 'utf-8'));
    const source = options.stripDescriptions
      ? JSON.stringify(stripDescriptions(raw))
      : JSON.stringify(raw);
    return { id: '', fileName: file, source };
  });
  return {
    name: 'crx-i18n',
    enforce: 'pre',
    buildStart: {
      order: 'post',
      handler() {
        files.forEach((file) => {
          const refId = this.emitFile({
            type: 'asset',
            source: file.source,
            fileName: '_locales/' + file.fileName,
          });
          file.id = refId;
        });
      },
    },
  };
}

type ChunkFacts = Pick<OutputChunk, 'code' | 'imports' | 'dynamicImports' | 'exports'>;

const DYNAMIC_IMPORT = /\bimport\s*\(/;
const STATIC_IMPORT = /(?:^|[;}\n])\s*import\s*(?:[\w*{]|["'])/;

/** Why an emitted content script would not run synchronously on evaluation. */
export function selfContainedViolations(chunk: ChunkFacts): string[] {
  const problems: string[] = [];
  if (chunk.imports.length) problems.push(`imports ${chunk.imports.join(', ')}`);
  if (chunk.dynamicImports.length || DYNAMIC_IMPORT.test(chunk.code)) {
    problems.push('loads code with a dynamic import');
  }
  if (STATIC_IMPORT.test(chunk.code)) problems.push('contains an import statement');
  if (chunk.exports.length) problems.push(`exports ${chunk.exports.join(', ')}`);
  if (!chunk.code.includes('addEventListener(')) problems.push('registers no listener');
  return problems;
}

// plugin to fail the build when a content entry that must install synchronously
// at document_start would instead be emitted behind CRXJS's dynamic-import loader.
// CRXJS inlines a content chunk as one classic script only when it has no
// imports or exports, so a shared module silently brings the loader back.
export function selfContainedContentScripts(entries: readonly string[]): PluginOption {
  return {
    name: 'self-contained-content-scripts',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const entry of entries) {
        const chunk = Object.values(bundle).find(
          (file): file is OutputChunk =>
            file.type === 'chunk' && file.isEntry && !!file.facadeModuleId?.endsWith(entry),
        );
        if (!chunk) {
          this.error(`${entry} was not emitted as a content script entry`);
        }
        const problems = selfContainedViolations(chunk);
        const loaderName = `${basename(entry)}-loader`;
        if (Object.keys(bundle).some((fileName) => fileName.includes(loaderName))) {
          problems.push('was given a dynamic-import loader');
        }
        if (problems.length) {
          this.error(`${entry} must emit as one self-contained script: ${problems.join('; ')}`);
        }
      }
    },
  };
}
