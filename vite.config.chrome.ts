import { ManifestV3Export, crx } from '@crxjs/vite-plugin';
import { existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Plugin, defineConfig, mergeConfig } from 'vite';

import {
  collectBundleAssetPaths,
  collectStaticAssetPaths,
  pruneDevBuildAssets,
  readViteManifestAssetPaths,
  shouldPruneDevBuildAssets,
} from './scripts/dev-build-assets';
import { type DevBuildLock, acquireDevBuildLock } from './scripts/dev-build-lock';
import baseConfig, { baseBuildOptions, baseManifest } from './vite.config.base';

const isDev = process.env.__DEV__ === 'true';
const outDirName =
  process.env.VOYAGER_BUILD_TARGET === 'edge'
    ? 'dist_edge'
    : isDev
      ? 'dist_chrome_dev'
      : 'dist_chrome';
const outDir = resolve(__dirname, outDirName);
// Only the unpacked dist_chrome_dev build reloads itself when its build id
// changes; see src/pages/background/devAutoReload.ts.
const isChromeDevBuild = isDev && outDirName === 'dist_chrome_dev';

function devBuildReadyPlugin(): Plugin | null {
  if (!isChromeDevBuild) return null;

  const viteManifestPath = resolve(outDir, '.vite', 'manifest.json');
  let previousAssets = new Set<string>();
  let canPruneAssets = false;
  let buildLock: DevBuildLock | null = null;
  const releaseBuildLock = async () => {
    const lock = buildLock;
    buildLock = null;
    await lock?.release();
  };

  return {
    name: 'voyager-dev-build-ready',
    apply: 'build',
    enforce: 'post',
    async buildStart() {
      // Overlapping dev builds into this outDir (say, a one-off build while the
      // nodemon watcher rebuilds) would let Chrome reload into a half-written
      // dist, or prune the generation Chrome just loaded. Wait for the other
      // build to commit, then read its manifest below.
      buildLock = await acquireDevBuildLock(outDir, {
        onWait: (pid) => console.warn(`[voyager] Waiting for dev build ${pid} to finish...`),
        onForeignListener: (port) =>
          console.warn(`[voyager] Port ${port} is held by another program; building unlocked.`),
      });
      const hadPreviousManifest = existsSync(viteManifestPath);
      previousAssets = readViteManifestAssetPaths(viteManifestPath);
      // A missing manifest is normal for the first build. If one exists but
      // cannot be read, skip cleanup rather than guessing which live assets are
      // safe to remove.
      canPruneAssets = shouldPruneDevBuildAssets(hadPreviousManifest, previousAssets.size);
    },
    async writeBundle(_options, bundle) {
      if (canPruneAssets) {
        const currentAssets = collectBundleAssetPaths(Object.keys(bundle));
        const staticAssets = collectStaticAssetPaths(resolve(__dirname, 'public', 'assets'));
        pruneDevBuildAssets(
          outDir,
          new Set([...previousAssets, ...currentAssets, ...staticAssets]),
        );
      }
      // This is the commit marker consumed by launch-chrome.cjs and, as the
      // build id, by the dev background's auto-reload. It is written
      // only after Rollup has finished writing every asset and stale generations
      // have been pruned, so Chrome never reloads against a half-written bundle.
      writeFileSync(resolve(outDir, '.voyager-build-ready'), `${Date.now()}\n`);
      await releaseBuildLock();
    },
    closeBundle: releaseBuildLock,
  };
}
const chromeSharedContentScripts = (
  baseManifest as unknown as { content_scripts?: Array<Record<string, unknown>> }
).content_scripts;
const chromeMainWorldObservers = [
  {
    matches: ['https://gemini.google.com/*', 'https://business.gemini.google/*'],
    js: ['public/usage-observer.js'],
    run_at: 'document_start' as const,
    world: 'MAIN' as const,
  },
  {
    matches: ['https://gemini.google.com/*', 'https://business.gemini.google/*'],
    js: ['public/conversation-history-observer.js'],
    run_at: 'document_start' as const,
    world: 'MAIN' as const,
  },
];

export const chromeManifest = {
  ...baseManifest,
  // Browser-managed MAIN-world scripts avoid Gemini's Trusted Types/CSP
  // blocking the old DOM <script src="chrome-extension://..."> bridge. Edge
  // builds reuse this manifest, so keep the observers statically registered.
  content_scripts: [...(chromeSharedContentScripts ?? []), ...chromeMainWorldObservers],
  // declarativeContent is Chrome/Edge-only (absent on Firefox/Safari).
  // Injected here so the shared base manifest stays cross-browser clean.
  permissions: [
    ...((baseManifest as { permissions?: string[] }).permissions ?? []),
    'declarativeContent',
    // unlimitedStorage has no Chrome/Edge permission warning. Keep it required
    // so every install gets predictable local capacity; Voyager's own
    // 25/50/100 MB soft cap still bounds actual usage.
    'unlimitedStorage',
  ],
  // Edge builds reuse this Chrome manifest.
  optional_permissions: (
    (baseManifest as { optional_permissions?: string[] }).optional_permissions ?? []
  ).filter((permission) => permission !== 'unlimitedStorage'),
} as ManifestV3Export;

export default mergeConfig(
  baseConfig,
  defineConfig({
    define: {
      'import.meta.env.VOYAGER_DEV_AUTO_RELOAD': JSON.stringify(isChromeDevBuild),
      'import.meta.env.VOYAGER_DEV_SETTINGS_BRIDGE': JSON.stringify(isChromeDevBuild),
      // With the catalog channel off below, a dev build could never renew its bridge policy.
      'import.meta.env.VOYAGER_DEV_BRIDGE_POLICY_NO_EXPIRY': JSON.stringify(isChromeDevBuild),
      // A dev build shares the store version, so the published catalog would be
      // authoritative and hide bundled plugins main has not deployed yet.
      'import.meta.env.VOYAGER_PLUGIN_CATALOG_REMOTE': JSON.stringify(
        process.env.VOYAGER_PLUGIN_CATALOG_REMOTE ?? (isChromeDevBuild ? 'off' : 'on'),
      ),
    },
    plugins: [
      crx({
        manifest: chromeManifest,
        browser: 'chrome',
        contentScripts: {
          injectCss: true,
        },
      }),
      devBuildReadyPlugin(),
    ],
    build: {
      ...baseBuildOptions,
      outDir,
      rollupOptions: {
        input: {
          panel: resolve(__dirname, 'src/pages/panel/index.html'),
          // The renderer's all-origin WAR entry supports authorized custom sites;
          // embedding this document grants no host access.
          mermaidRenderer: resolve(__dirname, 'src/pages/mermaidRenderer/index.html'),
          // Opened by the background on first install; nothing in the manifest
          // references it, so it must be a build input of its own.
          welcome: resolve(__dirname, 'src/pages/welcome/index.html'),
          library: resolve(__dirname, 'src/pages/library/index.html'),
        },
      },
    },
  }),
);
