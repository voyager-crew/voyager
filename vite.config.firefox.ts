import { ManifestV3Export, crx } from '@crxjs/vite-plugin';
import { resolve } from 'path';
import { defineConfig, loadEnv, mergeConfig } from 'vite';

import pkg from './package.json';
import baseConfig, { baseBuildOptions, baseManifest } from './vite.config.base';

const outDir = resolve(__dirname, 'dist_firefox');
const firefoxVersionOverride = process.env.VOYAGER_FIREFOX_VERSION?.trim();
// loadEnv reads .env files and falls back to the process environment (CI secrets).
const firefoxOAuthClientSecret =
  loadEnv(
    'production',
    process.cwd(),
    'VOYAGER_FIREFOX_OAUTH_',
  ).VOYAGER_FIREFOX_OAUTH_CLIENT_SECRET?.trim() ?? '';
if (firefoxVersionOverride && !/^\d+(?:\.\d+){0,3}$/.test(firefoxVersionOverride)) {
  throw new Error(`Invalid Firefox extension version: ${firefoxVersionOverride}`);
}
const FIREFOX_SAKURA_RENDERER_RESOURCE = 'src/pages/sakuraRenderer/index.html';
// This only makes the renderer frame loadable where a separately-authorized
// content script creates it; it does not grant Voyager access to any new site.
const FIREFOX_SAKURA_RENDERER_MATCHES = ['<all_urls>'];

type WebAccessibleResourceLike = {
  resources?: string[];
};

type FirefoxManifestLike<TResource extends WebAccessibleResourceLike = WebAccessibleResourceLike> =
  {
    web_accessible_resources?: TResource[];
  };

function appendFirefoxChangelogResources<
  TManifest extends FirefoxManifestLike<TResource>,
  TResource extends WebAccessibleResourceLike,
>(manifest: TManifest): TManifest {
  const existingEntries = manifest.web_accessible_resources ?? [];
  if (existingEntries.length === 0) return manifest;

  const [first, ...rest] = existingEntries;
  const existingResources = first.resources ?? [];
  const mergedResources = Array.from(new Set(existingResources));

  return {
    ...manifest,
    web_accessible_resources: [
      {
        resources: [FIREFOX_SAKURA_RENDERER_RESOURCE],
        matches: FIREFOX_SAKURA_RENDERER_MATCHES,
      } as unknown as TResource,
      {
        ...first,
        resources: mergedResources,
      },
      ...rest,
    ],
  } as TManifest;
}

export const firefoxManifest = appendFirefoxChangelogResources({
  ...baseManifest,
  version: firefoxVersionOverride ?? pkg.version,
  // Firefox models unlimitedStorage as a required no-prompt permission,
  // rather than an optional permission requested at runtime.
  permissions: Array.from(
    new Set([
      ...((baseManifest as { permissions?: string[] }).permissions ?? []),
      'unlimitedStorage',
    ]),
  ),
  browser_specific_settings: {
    gecko: {
      id: 'gemini-voyager@nagi-ovo',
      // Keep the floor at the 115 ESR line so its users aren't dropped. The MV3
      // optional_host_permissions key is only honored from Firefox 128
      // (Bugzilla 1766026); on older Firefox the plugin / custom-website
      // host-grant flow is feature-gated off with an explanation rather
      // than left to silently fail (see supportsOptionalHostPermissions()).
      //
      // The CSS side has to hold this floor too, and nothing about it is
      // visible at build time: an unsupported selector silently invalidates
      // the whole rule group. Anything newer than 115 lives behind an
      // @supports guard in src/styles/contentStyle/, and
      // firefoxCssFloor.test.ts fails on an unguarded use.
      strict_min_version: '115.0',
      data_collection_permissions: {
        required: ['none'],
      },
    },
    gecko_android: {
      // Android export needs the popup's optional host permission grant flow.
      strict_min_version: '128.0',
    },
  },
  background: {
    scripts: ['src/pages/background/index.ts'],
    type: 'module',
  },
} as unknown as FirefoxManifestLike) as unknown as ManifestV3Export;

export default mergeConfig(
  baseConfig,
  defineConfig({
    define: {
      'import.meta.env.VOYAGER_BUILD_TARGET': JSON.stringify('firefox'),
      // Desktop OAuth client secret for the Firefox loopback sign-in. It comes
      // from the environment (.env locally, a CI secret in release) so it never
      // lands in the repository; Chromium bundles do not receive it.
      'import.meta.env.VOYAGER_FIREFOX_OAUTH_CLIENT_SECRET':
        JSON.stringify(firefoxOAuthClientSecret),
    },
    plugins: [
      crx({
        manifest: firefoxManifest,
        browser: 'firefox',
        contentScripts: {
          injectCss: true,
        },
      }),
    ],
    resolve: {
      alias: {
        // Firefox uses mermaid v9.2.2 (max compatible version)
        // Chrome/Safari use mermaid v11.x (latest) by default
        mermaid: 'mermaid-legacy',
      },
    },
    build: {
      ...baseBuildOptions,
      outDir,
      rollupOptions: {
        input: {
          panel: resolve(__dirname, 'src/pages/panel/index.html'),
          mermaidRenderer: resolve(__dirname, 'src/pages/mermaidRenderer/index.html'),
          sakuraRenderer: resolve(__dirname, 'src/pages/sakuraRenderer/index.html'),
          welcome: resolve(__dirname, 'src/pages/welcome/index.html'),
          library: resolve(__dirname, 'src/pages/library/index.html'),
        },
      },
    },
    publicDir: resolve(__dirname, 'public'),
  }),
);
