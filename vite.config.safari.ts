import { ManifestV3Export, crx } from '@crxjs/vite-plugin';
import { build as buildWithEsbuild } from 'esbuild';
import { readFile, rename } from 'node:fs/promises';
import { resolve } from 'path';
import { Plugin, defineConfig, mergeConfig } from 'vite';

import manifest from './manifest.json';
import baseConfig, { baseBuildOptions, baseManifest } from './vite.config.base';

const outDir = resolve(__dirname, 'dist_safari');

function safariClassicBackground(): Plugin {
  return {
    name: 'safari-classic-background',
    apply: 'build',
    enforce: 'post',
    async closeBundle() {
      const manifestPath = resolve(outDir, 'manifest.json');
      const builtManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        background?: { scripts?: string[] };
      };
      const backgroundScript = builtManifest.background?.scripts?.[0];
      if (!backgroundScript) throw new Error('Safari background script was not emitted');

      const entryPath = resolve(outDir, backgroundScript);
      const bundledPath = `${entryPath}.classic.js`;
      await buildWithEsbuild({
        entryPoints: [entryPath],
        outfile: bundledPath,
        bundle: true,
        format: 'iife',
        platform: 'browser',
        target: 'safari14',
        minify: true,
      });
      await rename(bundledPath, entryPath);
    },
  };
}

// Direct-download Safari builds do not have a browser-store updater. Keep the
// existing release reminder on by default; packagers can explicitly disable it.
const enableSafariUpdateCheck = process.env.ENABLE_SAFARI_UPDATE_CHECK !== 'false';

const safariMainWorldScripts = [
  {
    // A static page-world hook exposes originals; visible preview blobs are low-resolution.
    matches: ['https://gemini.google.com/*', 'https://business.gemini.google/*'],
    js: ['public/fetchInterceptor.js'],
  },
  {
    matches: ['https://gemini.google.com/*', 'https://business.gemini.google/*'],
    js: ['public/usage-observer.js'],
  },
  {
    matches: ['https://gemini.google.com/*', 'https://business.gemini.google/*'],
    js: ['public/conversation-history-observer.js'],
  },
  {
    matches: ['https://gemini.google.com/*', 'https://business.gemini.google/*'],
    js: ['public/response-complete-observer.js'],
  },
  {
    matches: ['https://gemini.google.com/*', 'https://business.gemini.google/*'],
    js: ['public/prevent-auto-scroll.js'],
  },
  {
    matches: [
      'https://gemini.google.com/*',
      'https://business.gemini.google/*',
      'https://aistudio.google.com/*',
      'https://aistudio.google.cn/*',
    ],
    js: ['public/katex-config.js'],
  },
].map((entry) => ({ ...entry, run_at: 'document_start' as const, world: 'MAIN' as const }));

const sharedContentScripts = (
  baseManifest as unknown as { content_scripts?: Array<Record<string, unknown>> }
).content_scripts;

export const safariManifest = {
  ...baseManifest,
  browser_specific_settings: {
    safari: {
      // Manifest V3 support starts at Safari 15.4. The Vite target controls
      // syntax only, so the compatibility floor must also live in manifest.
      strict_min_version: '15.4',
    },
  },
  // Safari renders toolbar icons as template images (monochrome).
  // Use a transparent-background version so it doesn't appear as a solid square.
  action: {
    ...manifest.action,
    default_icon: {
      '16': 'icon-16-template.png',
      '19': 'icon-19-template.png',
      '32': 'icon-32-template.png',
      '38': 'icon-38-template.png',
    },
  },
  permissions: Array.from(
    new Set([
      ...manifest.permissions.filter(
        (permission) => permission !== 'notifications' && permission !== 'identity',
      ),
      'nativeMessaging',
    ]),
  ),
  optional_permissions: Array.from(
    new Set([
      ...(manifest.optional_permissions ?? []).filter(
        (permission) => permission !== 'notifications',
      ),
      'unlimitedStorage',
    ]),
  ),
  // The local bridge is not supported on Safari yet, so it never asks for loopback access.
  optional_host_permissions: (
    (manifest as { optional_host_permissions?: string[] }).optional_host_permissions ?? []
  ).filter((origin) => origin !== 'http://127.0.0.1/*'),
  // Safari applies the page CSP to DOM-injected extension scripts. Native
  // MAIN-world content scripts bypass that CSP and run early enough to observe
  // Gemini's initial network requests. Keep one file per entry because Safari
  // can partially execute multi-file MAIN-world registrations.
  content_scripts: [...(sharedContentScripts ?? []), ...safariMainWorldScripts],
  // Safari App Extensions load `background.scripts` as classic scripts. The
  // post-build plugin below folds CRXJS's shared chunks into this one entry.
  background: {
    scripts: ['src/pages/background/index.ts'],
  },
} as unknown as ManifestV3Export;

export default mergeConfig(
  baseConfig,
  defineConfig({
    define: {
      // Inject flag into the build
      'import.meta.env.ENABLE_SAFARI_UPDATE_CHECK': JSON.stringify(
        enableSafariUpdateCheck ? 'true' : 'false',
      ),
      'import.meta.env.VOYAGER_BUILD_TARGET': JSON.stringify('safari'),
    },
    plugins: [
      crx({
        manifest: safariManifest,
        browser: 'chrome', // Use 'chrome' mode as Safari uses WebKit
        contentScripts: {
          injectCss: true,
        },
      }),
      safariClassicBackground(),
    ],
    build: {
      ...baseBuildOptions,
      outDir,
      rollupOptions: {
        input: {
          panel: resolve(__dirname, 'src/pages/panel/index.html'),
          // Opened by the background on first install; nothing in the manifest
          // references it, so it must be a build input of its own.
          welcome: resolve(__dirname, 'src/pages/welcome/index.html'),
          library: resolve(__dirname, 'src/pages/library/index.html'),
        },
      },
      // Safari-specific build optimizations
      // JavaScript syntax floor only. It does not imply Safari 14 can run MV3;
      // runtime quota messaging uses the actual Safari product version.
      target: 'safari14',
    },
  }),
);
