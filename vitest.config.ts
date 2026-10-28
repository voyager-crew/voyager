import path from 'path';
import { configDefaults, defineConfig } from 'vitest/config';

import { getCatalogRevision } from './scripts/lib/catalogRevision';

export default defineConfig({
  define: {
    'import.meta.env.VOYAGER_CATALOG_REVISION': JSON.stringify(
      getCatalogRevision(__dirname, 'unstamped'),
    ),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/tests/vmRealm.ts', './src/tests/setup.ts'],
    // Agent and local worktrees are full checkouts inside the repo; their
    // copies of the suite belong to their own runs.
    exclude: [...configDefaults.exclude, '.claude/worktrees/**', '.worktrees/**'],
    // Vitest stubs CSS imports to '' unless the file is listed here, which
    // also swallows `?raw` imports. The bundled plugin catalog is plain CSS
    // read as text, so let Vite serve it for real; app CSS stays stubbed.
    css: { include: [/src\/features\/plugins\/catalog\/.*\.css(?:\?raw)?$/] },
    // khroma imports `.//index.js`. The VM pools' loader joins that as a URL
    // and keeps the `//`, so the module's own `../` imports miss; Vite's
    // resolver does not. Both Mermaid builds import khroma, so Vite loads all three.
    server: {
      deps: {
        inline: [/\/node_modules\/(?:mermaid|mermaid-legacy)\/dist\//, /\/node_modules\/khroma\//],
      },
    },
    // `--changed` follows imports only. Tests read stylesheets and locale files
    // from disk and app CSS is stubbed, so a change to either runs everything.
    // Anchored at the root: a leading `**` never crosses `.claude/worktrees`.
    forceRerunTriggers: [
      'package.json',
      '{vite,vitest}.config.*',
      'src/**/*.css',
      'public/**/*.css',
      'src/locales/**',
    ].map((pattern) => path.join(__dirname, pattern)),
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'src/tests/', '**/*.d.ts', '**/*.config.*', '**/mockData.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@locales': path.resolve(__dirname, './src/locales'),
      '@/core': path.resolve(__dirname, './src/core'),
      '@/features': path.resolve(__dirname, './src/features'),
      'wavedrom/render-any': path.resolve(__dirname, './node_modules/wavedrom/lib/render-any.js'),
    },
  },
});
