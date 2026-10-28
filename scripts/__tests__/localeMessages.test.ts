import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { type OutputChunk, rollup } from 'rollup';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { crxI18n, localeMessages, localeMessagesChunk } from '../../custom-vite-plugins';

const BASE = {
  greeting: {
    message: 'Bonjour "Jesse"\nC:\\voyager\t世界\u2028\u2029',
    description: 'Translator context',
  },
  empty: { message: '', description: 'An intentionally empty message' },
};
const FRAGMENT = {
  copy: { message: 'Copier "le code"\n\\ $1', description: 'Button label' },
};
const BASE_PATH = 'src/locales/fr/messages.json';
const FRAGMENT_PATH = 'src/features/plugins/verbs/copy/messages/fr.json';
const OTHER_JSON_PATHS = [
  '_locales/fr/messages.json',
  'src/locales/fr/nested/messages.json',
  'src/features/plugins/catalog/fr/messages.json',
];

let root: string;
const transformedModules = new Map<string, string>();

function fixture(path: string, content: string): void {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function defaultExport(code: string): unknown {
  return runInNewContext(code.replace('export default', 'module.exports ='), {
    module: { exports: undefined },
  });
}

function transformedCode(path: string): string {
  const code = transformedModules.get(path);
  if (!code) throw new Error(`Vite did not transform ${path}`);
  return code;
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'voyager-locale-messages-')));
  for (const language of ['en', 'fr', 'ja']) {
    fixture(`src/locales/${language}/messages.json`, JSON.stringify(BASE));
    for (const verb of ['copy', 'quote']) {
      fixture(
        `src/features/plugins/verbs/${verb}/messages/${language}.json`,
        JSON.stringify(FRAGMENT),
      );
    }
  }
  for (const path of OTHER_JSON_PATHS) {
    fixture(path, JSON.stringify(BASE));
  }
  fixture(
    'entry.js',
    `import english from './src/locales/en/messages.json';
import englishCopy from './src/features/plugins/verbs/copy/messages/en.json';
export const en = { ...english, ...englishCopy };
export const fr = () => Promise.all([
  import('./src/locales/fr/messages.json'),
  import('./src/features/plugins/verbs/copy/messages/fr.json'),
  import('./src/features/plugins/verbs/quote/messages/fr.json'),
]);
export const ja = () => Promise.all([
  import('./src/locales/ja/messages.json'),
  import('./src/features/plugins/verbs/copy/messages/ja.json'),
]);`,
  );
  fixture('src/utils/language.ts', "export const languages = ['en', 'fr', 'ja'];");
  fixture(
    'src/utils/translations.ts',
    `import english from '../locales/en/messages.json';
import englishCopy from '../features/plugins/verbs/copy/messages/en.json';
import { languages } from './language.ts';
export const messages = { en: { ...english, ...englishCopy } };
export const supportedLanguages = languages;
export const load = {
  fr: () => Promise.all([
    import('../locales/fr/messages.json'),
    import('../features/plugins/verbs/copy/messages/fr.json'),
  ]),
  ja: () => Promise.all([
    import('../locales/ja/messages.json'),
    import('../features/plugins/verbs/copy/messages/ja.json'),
  ]),
};`,
  );
  fixture(
    'content.js',
    `export { messages, supportedLanguages, load } from './src/utils/translations.ts';`,
  );
  fixture(
    'background.js',
    `import en from './src/locales/en/messages.json';
import fr from './src/locales/fr/messages.json';
import ja from './src/locales/ja/messages.json';
import enCopy from './src/features/plugins/verbs/copy/messages/en.json';
import frCopy from './src/features/plugins/verbs/copy/messages/fr.json';
import jaCopy from './src/features/plugins/verbs/copy/messages/ja.json';
import { languages } from './src/utils/language.ts';
export const all = { en: { ...en, ...enCopy }, fr: { ...fr, ...frCopy }, ja: { ...ja, ...jaCopy } };
export { languages };`,
  );
  const requests = [
    BASE_PATH,
    FRAGMENT_PATH,
    ...OTHER_JSON_PATHS,
    `${BASE_PATH}?raw`,
    `${FRAGMENT_PATH}?url`,
  ];
  // Vite requires Node's own Uint8Array realm, so keep it outside jsdom.
  // Explicit config/env opt-outs also prevent reading any project config or .env.
  const probe = `import { createServer } from 'vite';
import { localeMessages } from ${JSON.stringify(join(process.cwd(), 'custom-vite-plugins.ts'))};
const server = await createServer({
  root: ${JSON.stringify(root)}, configFile: false, envFile: false,
  publicDir: false, logLevel: 'silent', plugins: [localeMessages()],
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, ws: false, watch: null },
});
try {
  const results = [];
  for (const path of ${JSON.stringify(requests)}) {
    const transformed = await server.transformRequest('/' + path);
    results.push([path, transformed?.code]);
  }
  process.stdout.write(JSON.stringify(results));
} finally { await server.close(); }`;
  const result: unknown = JSON.parse(execFileSync('bun', ['--eval', probe], { encoding: 'utf-8' }));
  if (!Array.isArray(result)) throw new Error('Vite probe did not return its transformed modules');
  for (const entry of result) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string' || typeof entry[1] !== 'string') {
      throw new Error('Vite probe returned an invalid transformed module');
    }
    transformedModules.set(entry[0], entry[1]);
  }
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('locale message modules', () => {
  it.each([
    [BASE_PATH, { greeting: { message: BASE.greeting.message }, empty: { message: '' } }],
    [FRAGMENT_PATH, { copy: { message: FRAGMENT.copy.message } }],
  ])(
    'keeps message objects and escaped text in %s without translator metadata',
    (path, expected) => {
      const code = transformedCode(path);
      expect(code).toMatch(/^export default JSON\.parse\(/);
      expect(code).not.toContain('description');
      expect(defaultExport(code)).toEqual(expected);
    },
  );

  it.each(OTHER_JSON_PATHS)('leaves other JSON modules unchanged at %s', (path) => {
    const code = transformedCode(path);
    expect(code).toContain('description');
    expect(code).not.toMatch(/^export default JSON\.parse\(/);
    expect(localeMessagesChunk(join(root, path))).toBeUndefined();
  });

  it('preserves raw imports including their descriptions', () => {
    const code = transformedCode(`${BASE_PATH}?raw`);
    expect(defaultExport(code)).toBe(readFileSync(join(root, BASE_PATH), 'utf-8'));
    expect(localeMessagesChunk(join(root, `${BASE_PATH}?raw`))).toBeUndefined();
  });

  it('preserves URL imports of primitive fragments', () => {
    const code = transformedCode(`${FRAGMENT_PATH}?url`);
    expect(defaultExport(code)).toBe(`/${FRAGMENT_PATH}`);
    expect(localeMessagesChunk(join(root, `${FRAGMENT_PATH}?url`))).toBeUndefined();
  });

  it('keeps English eager and groups Windows paths by their locale', () => {
    expect(localeMessagesChunk('C:\\voyager\\src\\locales\\zh_TW\\messages.json')).toBe(
      'locale-zh_TW',
    );
    expect(
      localeMessagesChunk('C:\\voyager\\src\\features\\plugins\\verbs\\copy\\messages\\zh_TW.json'),
    ).toBe('locale-zh_TW');
    expect(localeMessagesChunk(join(root, 'src/locales/en/messages.json'))).toBeUndefined();
  });
});

describe('locale bundles', () => {
  it.each([false, true])(
    'merges each lazy language into one chunk and preserves crxI18n stripping=%s',
    async (stripDescriptions) => {
      const bundle = await rollup({
        input: join(root, 'entry.js'),
        plugins: [
          localeMessages(),
          crxI18n({ localize: true, src: join(root, 'src/locales'), stripDescriptions }),
        ],
      });
      try {
        const { output } = await bundle.generate({
          format: 'es',
          entryFileNames: '[name].js',
          chunkFileNames: '[name].js',
          manualChunks: localeMessagesChunk,
        });
        const chunks = output.filter((file) => file.type === 'chunk');
        const entry = chunks.find((chunk) => chunk.isEntry);
        const french = chunks.find((chunk) => chunk.name === 'locale-fr');
        const japanese = chunks.find((chunk) => chunk.name === 'locale-ja');

        expect(chunks).toHaveLength(3);
        expect(french?.moduleIds.sort()).toEqual(
          [
            join(root, BASE_PATH),
            join(root, FRAGMENT_PATH),
            join(root, 'src/features/plugins/verbs/quote/messages/fr.json'),
          ].sort(),
        );
        expect(japanese?.moduleIds).toHaveLength(2);
        expect(entry?.moduleIds).toContain(join(root, 'src/locales/en/messages.json'));
        expect(entry?.imports).toEqual([]);
        expect([...new Set(entry?.dynamicImports)].sort()).toEqual([
          'locale-fr.js',
          'locale-ja.js',
        ]);
        expect(french?.imports).toEqual([]);
        expect(japanese?.imports).toEqual([]);

        const localeAsset = output.find((file) => file.fileName === '_locales/fr/messages.json');
        expect(localeAsset?.type).toBe('asset');
        if (localeAsset?.type !== 'asset') throw new Error('Locale asset was not emitted');
        expect(JSON.parse(String(localeAsset.source))).toEqual(
          stripDescriptions
            ? { greeting: { message: BASE.greeting.message }, empty: { message: '' } }
            : BASE,
        );
        expect(output.some((file) => file.fileName.startsWith('_locales/copy/'))).toBe(false);
      } finally {
        await bundle.close();
      }
    },
  );

  it('keeps static worker translations separate from content locale loading', async () => {
    const bundle = await rollup({
      input: { background: join(root, 'background.js'), content: join(root, 'content.js') },
      plugins: [localeMessages()],
    });
    try {
      const { output } = await bundle.generate({
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        manualChunks: localeMessagesChunk,
      });
      const chunks = output.filter((file) => file.type === 'chunk');
      const staticGraph = (entryName: string): OutputChunk[] => {
        const visited = new Map<string, OutputChunk>();
        const walk = (fileName: string) => {
          if (visited.has(fileName)) return;
          const chunk = chunks.find((file) => file.fileName === fileName);
          if (!chunk) throw new Error(`Missing generated import ${fileName}`);
          visited.set(fileName, chunk);
          for (const imported of chunk.imports) walk(imported);
        };
        const entry = chunks.find((chunk) => chunk.isEntry && chunk.name === entryName);
        if (!entry) throw new Error(`Missing ${entryName} entry`);
        walk(entry.fileName);
        return [...visited.values()];
      };
      const workerGraph = staticGraph('background');
      const contentGraph = staticGraph('content');
      expect(
        workerGraph.flatMap((chunk) => chunk.dynamicImports),
        JSON.stringify(
          chunks.map(({ name, moduleIds, imports }) => ({ name, moduleIds, imports })),
        ),
      ).toEqual([]);
      expect(workerGraph.flatMap((chunk) => chunk.moduleIds)).not.toContain(
        join(root, 'src/utils/translations.ts'),
      );
      expect(contentGraph.flatMap((chunk) => chunk.moduleIds)).toContain(
        join(root, 'src/locales/en/messages.json'),
      );
      expect(contentGraph.flatMap((chunk) => chunk.moduleIds)).not.toContain(
        join(root, 'background.js'),
      );
      expect(contentGraph.flatMap((chunk) => chunk.moduleIds)).not.toContain(join(root, BASE_PATH));
      expect(contentGraph.flatMap((chunk) => chunk.moduleIds)).not.toContain(
        join(root, 'src/locales/ja/messages.json'),
      );
      expect(
        chunks
          .filter((chunk) => chunk.name.startsWith('locale-'))
          .map((chunk) => chunk.name)
          .sort(),
      ).toEqual(['locale-fr', 'locale-ja']);
      expect([...new Set(contentGraph.flatMap((chunk) => chunk.dynamicImports))].sort()).toEqual([
        'locale-fr.js',
        'locale-ja.js',
      ]);
    } finally {
      await bundle.close();
    }
  });
});
