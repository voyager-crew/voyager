import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';

it('loads English and selected-language panel and shell fragments through Vite', () => {
  const root = mkdtempSync(join(tmpdir(), 'voyager-panel-translations-'));
  const fixture = (path: string, source: string): void => {
    const absolutePath = join(root, path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, source);
  };
  try {
    for (const path of ['src/utils/translations.ts', 'src/utils/language.ts']) {
      fixture(path, readFileSync(join(process.cwd(), path), 'utf8'));
    }
    for (const language of ['en', 'ru']) {
      for (const [path, key] of [
        [`src/locales/${language}/messages.json`, 'base'],
        [`src/features/plugins/verbs/example/messages/${language}.json`, 'primitive'],
        [`src/pages/content/panelShell/messages/${language}.json`, 'shell'],
        [`src/pages/panel/messages/${language}.json`, 'panel'],
      ]) {
        fixture(path, JSON.stringify({ [key]: { message: `${key} ${language}` } }));
      }
    }

    // Keep Vite in Node's own realm and disable project config and environment file loading.
    const probe = `import { createServer } from 'vite';
const server = await createServer({
  root: ${JSON.stringify(root)}, configFile: false, envFile: false,
  publicDir: false, logLevel: 'silent',
  resolve: { alias: { '@locales': ${JSON.stringify(join(root, 'src/locales'))} } },
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, ws: false, watch: null },
});
try {
  const loader = await server.ssrLoadModule('/src/utils/translations.ts');
  const english = await loader.loadTranslations('en');
  const russian = await loader.loadTranslations('ru');
  process.stdout.write(JSON.stringify({ english, russian, recognized: loader.isTranslationKey('shell') && loader.isTranslationKey('panel') }));
} finally { await server.close(); }`;
    const result: unknown = JSON.parse(
      execFileSync('bun', ['--eval', probe], { encoding: 'utf8' }),
    );
    expect(result).toEqual({
      english: { base: 'base en', primitive: 'primitive en', shell: 'shell en', panel: 'panel en' },
      russian: { base: 'base ru', primitive: 'primitive ru', shell: 'shell ru', panel: 'panel ru' },
      recognized: true,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
