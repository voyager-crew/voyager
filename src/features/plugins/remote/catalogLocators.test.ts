import { afterEach, describe, expect, it, vi } from 'vitest';

import { getBundledGeminiSelectorView } from '@/core/gemini/selectors/bundle';

import { requireBundledSiteAdapter } from '../catalog/sites';
import { SiteRegistry } from '../sites/registry';
import { readSiteAdapterData, siteAdapterToData } from '../sites/siteAdapterData';
import { HostCatalogSource } from './HostCatalogSource';
import { type HostCatalogCacheEntry, siteAdapterFromEntry } from './hostCatalogCache';
import { validateHostCatalogFile } from './hostCatalogFile';
import { HostCatalogRefresher, defaultIsHostEligible } from './hostCatalogRefresh';
import { resolveSiteAdapterForUrl } from './siteOverride';

const HOST = 'gemini.google.com';
const VERSION = '1.0.0';
const BUNDLE = requireBundledSiteAdapter('gemini');
const PLUGIN = {
  id: 'example.plugin',
  name: 'Example',
  description: 'Fixture',
  author: 'Voyager',
  category: 'other',
  license: 'MIT',
  version: '1.0.0',
  engine: '>=1.0.0',
  tier: 'declarative',
  matches: [`https://${HOST}/*`],
  contributes: {},
};

function payload(locators: unknown, revision = 42) {
  return {
    format: 1,
    host: HOST,
    plugins: [PLUGIN],
    revoked: ['example.retired'],
    site: { ...siteAdapterToData(BUNDLE), catalogRevision: revision, locators },
  };
}

function entry(raw: ReturnType<typeof payload>): HostCatalogCacheEntry {
  const validation = validateHostCatalogFile(raw, raw.host);
  if (!validation?.site) throw new Error('Fixture site rejected');
  return {
    host: raw.host,
    status: 'ok',
    manifests: validation.manifests,
    revoked: validation.revoked,
    site: siteAdapterToData(validation.site),
    fetchedAt: 1,
    lastAttemptAt: 1,
    failureCount: 0,
    extensionVersion: VERSION,
  };
}

function query(profiles: Readonly<Record<string, readonly string[]>>, key: string) {
  return Array.from(document.querySelectorAll(profiles[key].join(','))).map((node) => node.id);
}

afterEach(() => document.body.replaceChildren());

describe('catalog locator sections', () => {
  it.each([
    null,
    { 'turn.user': [] },
    { 'turn.user': ['.wrong\u0000'] },
    { 'turn.user': Array.from({ length: 33 }, () => '.question') },
    { 'turn.user': ['.' + 'x'.repeat(2048)] },
    { 'composer.semanticInput': ['.wrong'] },
    { 'turn.user': Array.from({ length: 32 }, () => '.' + 'x'.repeat(2047)) },
  ])(
    'a malformed locator section keeps the plugin, kill switch and bundled page working: %j',
    (bad) => {
      document.body.innerHTML = '<div class="user-query-container" id="question">Question</div>';
      const validated = validateHostCatalogFile(payload(bad), HOST);
      expect(validated?.manifests.map((plugin) => plugin.id)).toEqual(['example.plugin']);
      expect(validated?.revoked).toEqual(['example.retired']);
      expect(validated?.site?.selectors).toEqual(BUNDLE.selectors);
      const profiles = { ...getBundledGeminiSelectorView().profiles, ...validated?.site?.locators };
      expect(query(profiles, 'turn.user')).toEqual(['question']);
      expect(validated?.siteIssues.length).toBeGreaterThan(0);
    },
  );

  it('a broken turn locator drops its whole surface while a repaired code host still works', () => {
    document.body.innerHTML =
      '<div class="user-query-container" id="question"></div><div class="renamed-code" id="code"></div>';
    const validated = validateHostCatalogFile(
      payload({
        'turn.user': ['['],
        'turn.assistant': ['.unrelated'],
        'code.host': ['.renamed-code'],
      }),
      HOST,
    );
    const profiles = { ...getBundledGeminiSelectorView().profiles, ...validated?.site?.locators };
    expect(query(profiles, 'turn.user')).toEqual(['question']);
    expect(profiles['turn.assistant']).toEqual(
      getBundledGeminiSelectorView().profiles['turn.assistant'],
    );
    expect(query(profiles, 'code.host')).toEqual(['code']);
  });

  it('an older extension keeps its working repairs when a newer catalog adds a key', () => {
    document.body.innerHTML = '<section class="repaired-turn" id="question">Question</section>';
    const validated = validateHostCatalogFile(
      payload({ 'turn.user': ['.repaired-turn'], 'future.user': ['body'] }),
      HOST,
    );
    expect(query(validated!.site!.locators!, 'turn.user')).toEqual(['question']);
    expect(validated?.site?.locators?.['future.user']).toBeUndefined();
    expect(validated?.siteIssues).toContainEqual({
      path: 'site.locators.future.user',
      message: 'unknown locator key',
    });
  });

  it('a locator-shaped extension to an unsupported site cannot change its adapter', () => {
    const claude = requireBundledSiteAdapter('claude');
    const read = readSiteAdapterData({
      ...siteAdapterToData(claude),
      locators: { 'turn.user': ['.evil'] },
    });
    expect(read.result.success && read.result.data.selectors).toEqual(claude.selectors);
    expect(read.sectionIssues).toEqual([
      { path: 'locators.turn.user', message: 'unknown locator key' },
    ]);
  });

  it('a site named constructor cannot break plugins or the kill switch through inherited locator policy', () => {
    const raw = payload({ 'turn.user': ['.evil'] });
    raw.site.id = 'constructor';
    const validated = validateHostCatalogFile(raw, HOST);
    expect(validated?.site?.id).toBe('constructor');
    expect(validated?.site?.selectors).toEqual(BUNDLE.selectors);
    expect(validated?.manifests.map((plugin) => plugin.id)).toEqual(['example.plugin']);
    expect(validated?.revoked).toEqual(['example.retired']);
    expect(validated?.siteIssues).toEqual([
      { path: 'site.locators', message: 'invalid or unsupported site locator profiles' },
    ]);
  });

  it('a cache for another native site cannot smuggle locators into the Gemini page', () => {
    document.body.innerHTML =
      '<div class="user-query-container" id="bundled"></div><div class="repaired" id="remote"></div>';
    const valid = entry(payload({ 'turn.user': ['.repaired'] }));
    const registry = new SiteRegistry();
    registry.register(BUNDLE);
    for (const patch of [{ id: 'claude' }, { matches: ['https://business.gemini.google/*'] }]) {
      const cached = { ...valid, site: { ...valid.site!, ...patch } };
      const adapter = resolveSiteAdapterForUrl(
        `https://${HOST}/app`,
        registry,
        siteAdapterFromEntry(cached, VERSION),
      );
      expect(
        query({ ...getBundledGeminiSelectorView().profiles, ...adapter?.locators }, 'turn.user'),
      ).toEqual(['bundled']);
    }
    const repaired = resolveSiteAdapterForUrl(
      `https://${HOST}/app`,
      registry,
      siteAdapterFromEntry(valid, VERSION),
    );
    expect(
      query({ ...getBundledGeminiSelectorView().profiles, ...repaired?.locators }, 'turn.user'),
    ).toEqual(['remote']);
  });

  it('only a newer catalog revision changes the page read, and empty newer data withdraws it', () => {
    document.body.innerHTML =
      '<div class="user-query-container" id="bundled"></div><div class="repaired" id="remote"></div>';
    const registry = new SiteRegistry();
    registry.register({ ...BUNDLE, catalogRevision: 20 });
    for (const [revision, expected] of [
      [19, 'bundled'],
      [20, 'bundled'],
      [21, 'remote'],
    ] as const) {
      const remote = siteAdapterFromEntry(
        entry(payload({ 'turn.user': ['.repaired'] }, revision)),
        VERSION,
      );
      const resolved = resolveSiteAdapterForUrl(`https://${HOST}/u/2/app/chat`, registry, remote);
      expect(
        query({ ...getBundledGeminiSelectorView().profiles, ...resolved?.locators }, 'turn.user'),
      ).toEqual([expected]);
    }
    const withdrawal = siteAdapterFromEntry(entry(payload({}, 22)), VERSION);
    const resolved = resolveSiteAdapterForUrl(`https://${HOST}/app`, registry, withdrawal);
    expect(
      query({ ...getBundledGeminiSelectorView().profiles, ...resolved?.locators }, 'turn.user'),
    ).toEqual(['bundled']);
  });

  it.each([
    { host: HOST, id: 'gemini', locator: 'turn.user' },
    { host: 'business.gemini.google', id: 'gemini', locator: 'turn.user' },
    { host: 'aistudio.google.com', id: 'aistudio', locator: 'input.candidates' },
    { host: 'aistudio.google.cn', id: 'aistudio', locator: 'input.candidates' },
  ])(
    'native routing, theme, plugins and identity survive a catalog trying to replace them on $host',
    async ({ host, id, locator }) => {
      const bundled = requireBundledSiteAdapter(id);
      const raw = {
        ...payload({ [locator]: ['.repaired'] }),
        host,
        plugins: [{ ...PLUGIN, matches: [`https://${host}/*`] }],
        site: {
          ...siteAdapterToData(bundled),
          catalogRevision: 42,
          label: 'Remote label',
          selectors: { userTurn: '.unsafe' },
          theme: { hostSelector: 'body', lightSelector: 'body', darkSelector: 'body' },
          capabilities: [],
          locators: { [locator]: ['.repaired'] },
        },
      };
      const cached = entry(raw);
      const source = new HostCatalogSource({
        extensionVersion: VERSION,
        enabled: true,
        loadEntry: async () => cached,
      });
      const remote = await source.siteOverride({ host });
      const expected = {
        ...bundled,
        catalogRevision: 42,
        locators: { [locator]: ['.repaired'] },
      };
      expect(remote).toEqual(expected);
      expect(await source.listWithAuthority({ host })).toEqual({
        manifests: [],
        authoritative: false,
      });
      const registry = new SiteRegistry();
      registry.register(bundled);
      expect(resolveSiteAdapterForUrl(`https://${host}/app`, registry, remote)).toEqual(expected);
    },
  );

  it('a manual check still fetches repairs with automatic updates off', async () => {
    let enabled = false;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () => new Response(JSON.stringify(payload({ 'turn.user': ['.repaired'] }))),
      );
    const saved: HostCatalogCacheEntry[] = [];
    const refresher = new HostCatalogRefresher({
      enabled: true,
      extensionVersion: VERSION,
      fetchImpl,
      loadSettings: async () => ({ onlineUpdatesEnabled: enabled, checkInterval: '6h' }),
      loadEntry: async () => null,
      saveEntry: async (next) => {
        saved.push(next);
      },
      isHostEligible: defaultIsHostEligible,
    });
    expect((await refresher.refresh(HOST)).status).toBe('skipped');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await refresher.refresh(HOST, { force: true })).status).toBe('updated');
    enabled = true;
    expect((await refresher.refresh(HOST)).status).toBe('updated');
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringMatching(/\/catalog\/hosts\/gemini\.google\.com\.json$/),
      expect.objectContaining({ credentials: 'omit' }),
    );
    expect(saved[0].site?.locators?.['turn.user']).toEqual(['.repaired']);
  });
});
