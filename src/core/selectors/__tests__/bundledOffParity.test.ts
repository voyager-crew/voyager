// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

import { inputSiteId } from '@/core/services/composer/siteInputData';
import { StorageKeys } from '@/core/types/common';
import { EXTENSION_VERSION } from '@/core/utils/version';
import { hostCatalogStorageKey } from '@/features/plugins/remote/hostCatalogCache';
import { startPageSelectors } from '@/pages/content/pageSelectorStartup';
import { resetPageUrl, setPageUrl } from '@/tests/pageUrl';

import { SITE_SELECTOR_CONTRACTS } from '../contracts';
import { getSiteSelectorView } from '../service';
import { BUNDLED_LOCATOR_SITES, locatorSiteForHost } from '../sites';
import { bundledOffData } from './bundledOffData';

const FIXTURES = join(import.meta.dirname, 'fixtures/bundled-off');
const stops: Array<() => void> = [];

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  resetPageUrl();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function storageRead(area: 'sync' | 'local', value: Record<string, unknown>): void {
  vi.mocked(chrome.storage[area].get).mockImplementation(async () => value);
}

function snapshot(site: string): unknown[] {
  return readdirSync(FIXTURES)
    .filter((file) => file.startsWith(`${site}-`) && file.endsWith('.json'))
    .sort()
    .flatMap((file) => {
      const data: unknown = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));
      if (!Array.isArray(data)) throw new Error(`Invalid OFF snapshot: ${file}`);
      return data;
    });
}

it('OFF preserves bundled profiles and runtime catalog values on every host and custom profile', async () => {
  vi.stubEnv('VOYAGER_PLUGIN_CATALOG_REMOTE', 'on');
  storageRead('sync', {
    [StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]: false,
  });
  const concreteHosts = BUNDLED_LOCATOR_SITES.flatMap((site) =>
    site.matches.flatMap((pattern) => {
      const host = new URL(pattern).hostname;
      return host.includes('*') ? [] : [host];
    }),
  );
  const hosts = [
    ...concreteHosts,
    'custom.example',
    'gemini.google.com.custom.example',
    'artifact.frame.claudeusercontent.com',
  ];
  expect(hosts.map((host) => [host, locatorSiteForHost(host) ?? 'generic'])).toEqual(
    JSON.parse(readFileSync(join(FIXTURES, 'hosts.json'), 'utf8')),
  );
  for (const host of hosts) {
    setPageUrl(`https://${host}/`);
    const site = inputSiteId();
    const bundle = BUNDLED_LOCATOR_SITES.find((entry) => entry.id === site);
    // An eligible newer cache must not replace any namespaced bundled value while OFF.
    storageRead(
      'local',
      bundle
        ? {
            [hostCatalogStorageKey(host)]: {
              host,
              status: 'ok',
              manifests: [],
              extensionVersion: EXTENSION_VERSION,
              fetchedAt: 1,
              lastAttemptAt: 1,
              failureCount: 0,
              site: {
                ...bundle,
                catalogRevision: Number.MAX_SAFE_INTEGER,
                locators: Object.fromEntries(
                  SITE_SELECTOR_CONTRACTS[bundle.id].keys
                    .filter((key) => !Object.hasOwn(bundle.selectors, key))
                    .map((key) => [key, ['.snapshot-canary']]),
                ),
              },
            },
          }
        : {},
    );
    const startup = startPageSelectors({
      url: `https://${host}/`,
      doc: document,
      lifetime: new AbortController().signal,
    });
    stops.push(startup.stop);
    await startup.legacySettings?.load();
    await startup.ready;
    expect(site).toBe(locatorSiteForHost(host));
    const view = site ? getSiteSelectorView(site) : undefined;
    const actual = bundledOffData(site, host, view);
    expect(actual, host).toEqual(snapshot(site ?? 'generic'));
    startup.stop();
    if (site) {
      storageRead('sync', {
        [StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]: true,
      });
      const enabled = startPageSelectors({
        url: `https://${host}/`,
        doc: document,
        lifetime: new AbortController().signal,
      });
      stops.push(enabled.stop);
      await enabled.ready;
      expect(
        Object.values(getSiteSelectorView(site).profiles),
        `${host} eligible cache`,
      ).toContainEqual(['.snapshot-canary']);
      enabled.stop();
      storageRead('sync', {
        [StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]: false,
      });
    }
  }
});
