import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requireBundledSiteAdapter } from '@/features/plugins/catalog/sites';
import { validateHostCatalogFile } from '@/features/plugins/remote/hostCatalogFile';
import { resolveSiteAdapterForUrl } from '@/features/plugins/remote/siteOverride';
import { SiteRegistry } from '@/features/plugins/sites/registry';
import * as keyPublishing from '@/features/plugins/sites/semanticKeyPublishing';
import { SEMANTIC_KEY_SINCE_VERSION } from '@/features/plugins/sites/semanticKeys';
import { siteAdapterToData } from '@/features/plugins/sites/siteAdapterData';

import { DEFAULT_CATALOG_DIR, writeHostCatalogs } from '../build-plugin-catalog';
import {
  GENERATED_AT,
  SOURCE_REVISION,
  EXPECTED_SITES,
  makeTempDir,
  build,
  readHostFile,
  NATIVE_HOSTS,
  makeFixtureCatalog,
  makePackagedFixtureCatalog,
  removeTempDirs,
  writeJson,
} from './buildPluginCatalogFixtures';

afterEach(() => {
  vi.restoreAllMocks();
  removeTempDirs();
});

describe('build-plugin-catalog', () => {
  it('publishes one file per concrete host in the bundled catalog', async () => {
    const outDir = makeTempDir();
    await build(outDir);

    const names = readdirSync(join(outDir, 'hosts')).sort();
    expect(names).toEqual(
      [
        'aistudio.google.cn',
        'aistudio.google.com',
        'business.gemini.google',
        'chat.deepseek.com',
        'chat.openai.com',
        'chatgpt.com',
        'claude.ai',
        'gemini.google.com',
        'www.kimi.com',
      ].map((host) => `${host}.json`),
    );
    // Wildcard patterns (https://*.frame.claudeusercontent.com/*) have no host
    // a client could derive from location.host, so they publish nothing.
    expect(names.some((name) => name.includes('*'))).toBe(false);
    for (const host of NATIVE_HOSTS)
      expect(readHostFile(outDir, host)).toMatchObject({
        plugins: [],
        site: { id: host.startsWith('aistudio') ? 'aistudio' : 'gemini' },
      });
  });

  it('checks native plugins and publishes every native host with locator-only authority', async () => {
    const outDir = makeTempDir();
    const catalogDir = makePackagedFixtureCatalog();

    const written = await build(outDir, catalogDir);

    expect(written.map((entry) => entry.host)).toEqual([...NATIVE_HOSTS, 'demo.example'].sort());
    expect(readHostFile(outDir, 'gemini.google.com')).toMatchObject({
      plugins: [],
      site: { id: 'gemini' },
    });
    expect(readdirSync(join(outDir, 'hosts')).sort()).toEqual(
      [...NATIVE_HOSTS, 'demo.example'].map((host) => `${host}.json`).sort(),
    );
  });

  it('publishes parser fields and full bundled selectors, keeping the plugin envelope empty', async () => {
    const outDir = makeTempDir();
    await build(outDir);

    for (const host of NATIVE_HOSTS) {
      const file = readHostFile(outDir, host);
      const site = file.site as Record<string, unknown>;
      expect(Object.keys(site).sort()).toEqual([
        'catalogRevision',
        'id',
        'label',
        'locators',
        'matches',
        'selectors',
        'theme',
      ]);
      expect(site.catalogRevision).toBe(SOURCE_REVISION);
      const bundled = requireBundledSiteAdapter(String(site.id));
      expect(site.selectors).toEqual(bundled.selectors);
      expect(Object.keys(site.locators as object).length).toBeGreaterThan(0);
      expect(file.plugins).toEqual([]);
      const validation = validateHostCatalogFile(file, host);
      expect(validation?.issues).toEqual([]);
      expect(validation?.siteIssues).toEqual([]);
      expect(validation?.site?.label).toBe(site.label);
      expect(validation?.site?.theme).toEqual(site.theme);
      expect(validation?.site?.locators).toEqual(site.locators);
    }
  });

  it('fails the build on an invalid Gemini plugin, though it is never published', async () => {
    const outDir = makeTempDir();
    const catalogDir = makePackagedFixtureCatalog({
      engine: '>=1.3.0',
      requires: { handlers: ['teleport'] },
    });

    await expect(build(outDir, catalogDir)).rejects.toThrow(
      /voyager\.gemini-compact.*unknown primitive handler "teleport"/s,
    );
    expect(existsSync(join(outDir, 'hosts', 'demo.example.json'))).toBe(false);
  });

  it('publishes newer packaged semantic keys while protecting strict catalog consumers', async () => {
    // Model a future Gemini-only key using today's valid authoring vocabulary.
    const check = keyPublishing.semanticKeysTooNewToPublish;
    vi.spyOn(keyPublishing, 'semanticKeysTooNewToPublish').mockImplementation((keys) =>
      check(keys, {
        oldestConsumer: '2.0.0',
        tolerantSince: '2.2.1',
        since: { ...SEMANTIC_KEY_SINCE_VERSION, thinkingBlock: '2.3.0' },
      }),
    );
    const catalogDir = makePackagedFixtureCatalog();
    const bundled = requireBundledSiteAdapter('gemini');
    writeJson(join(catalogDir, 'sites/gemini/site.json'), {
      ...siteAdapterToData(bundled),
      selectors: { ...bundled.selectors, thinkingBlock: '.future-thinking' },
    });
    const outDir = makeTempDir();
    await build(outDir, catalogDir);
    const published = readHostFile(outDir, 'gemini.google.com');
    expect(published).toMatchObject({
      site: { id: 'gemini', selectors: { thinkingBlock: '.future-thinking' } },
    });
    const otherCatalog = makeFixtureCatalog({ selectors: { thinkingBlock: '.future-thinking' } });
    await expect(build(makeTempDir(), otherCatalog)).rejects.toThrow(/selectors\.thinkingBlock/);
  });

  it('refuses route words that make Voyager 2.2.1 discard remote site repairs', async () => {
    const outDir = makeTempDir();
    const catalogDir = makeFixtureCatalog({ site: { routeWords: ['new_project'] } });
    await expect(build(outDir, catalogDir)).rejects.toThrow(
      /demo\.example:.*2\.2\.1.*discard the whole remote site record:.*new_project/s,
    );

    const compatibleCatalog = makeFixtureCatalog({ site: { routeWords: ['new-project'] } });
    await build(outDir, compatibleCatalog);
    expect(readHostFile(outDir, 'demo.example')).toMatchObject({
      site: { routeWords: ['new-project'] },
    });
  });

  it('replaces an older native host file with the current validated site data', async () => {
    const outDir = makeTempDir();
    const hostsDir = join(outDir, 'hosts');
    mkdirSync(hostsDir, { recursive: true });
    for (const host of NATIVE_HOSTS) {
      writeFileSync(join(hostsDir, `${host}.json`), `{"format":1,"host":"${host}","plugins":[]}\n`);
    }

    await build(outDir, makePackagedFixtureCatalog());

    expect(readdirSync(hostsDir).sort()).toEqual(
      [...NATIVE_HOSTS, 'demo.example'].map((host) => `${host}.json`).sort(),
    );
    for (const host of NATIVE_HOSTS) expect(readHostFile(outDir, host).site).toBeDefined();
  });

  it('writes files the runtime validator accepts, with the site adapter attached', async () => {
    const outDir = makeTempDir();
    await build(outDir);

    for (const [host, siteId] of Object.entries(EXPECTED_SITES)) {
      const file = readHostFile(outDir, host);
      expect(file.format).toBe(1);
      expect(file.host).toBe(host);
      expect(file.generatedAt).toBe(GENERATED_AT);

      const site = file.site as Record<string, unknown>;
      expect(site.id).toBe(siteId);
      expect(Array.isArray(site.capabilities)).toBe(true);
      expect((site.capabilities as unknown[]).length).toBeGreaterThan(0);
      // site.json owns the conversation-id regex; clients need it to tell one
      // conversation from another without a per-site branch.
      expect(typeof site.conversationIdPattern).toBe('string');
      expect(String(site.conversationIdPattern).length).toBeGreaterThan(0);

      const validation = validateHostCatalogFile(file, host);
      expect(validation, `${host} was rejected outright`).not.toBeNull();
      expect(validation?.issues).toEqual([]);
      expect(validation?.manifests.length).toBe((file.plugins as unknown[]).length);
      expect(validation?.site?.id).toBe(siteId);
    }
  });

  it('publishing the same commit cannot outrank its bundled selectors because of build timing', async () => {
    const outDir = makeTempDir();
    await build(outDir);
    const registry = new SiteRegistry();
    for (const [host, siteId] of Object.entries(EXPECTED_SITES)) {
      const payload = readHostFile(outDir, host);
      const remote = validateHostCatalogFile(payload, host)?.site;
      const bundled = { ...requireBundledSiteAdapter(siteId), catalogRevision: SOURCE_REVISION };
      registry.register(bundled);
      expect(remote?.catalogRevision).toBe(SOURCE_REVISION);
      expect(resolveSiteAdapterForUrl(`https://${host}/`, registry, remote ?? null)).toBe(bundled);
    }
    // Publication time is diagnostic: a later deploy of the same source still ties.
    await writeHostCatalogs({
      catalogDir: DEFAULT_CATALOG_DIR,
      outDir,
      generatedAt: '2099-01-01T00:00:00.000Z',
      catalogRevision: SOURCE_REVISION,
    });
    const remote = validateHostCatalogFile(
      readHostFile(outDir, 'chatgpt.com'),
      'chatgpt.com',
    )?.site;
    expect(resolveSiteAdapterForUrl('https://chatgpt.com/', registry, remote ?? null)).toBe(
      registry.resolveByUrl('https://chatgpt.com/'),
    );
  });

  it('inlines every style file as css', async () => {
    const outDir = makeTempDir();
    await build(outDir);

    for (const host of Object.keys(EXPECTED_SITES)) {
      const plugins = readHostFile(outDir, host).plugins as readonly Record<string, unknown>[];
      expect(plugins.length).toBeGreaterThan(0);
      let styleCount = 0;
      for (const plugin of plugins) {
        const contributes = plugin.contributes as { styles?: Record<string, unknown>[] };
        // A primitive-backed plugin may contribute no CSS at all.
        for (const style of contributes.styles ?? []) {
          styleCount += 1;
          expect(typeof style.css).toBe('string');
          expect(String(style.css).length).toBeGreaterThan(0);
          expect(style).not.toHaveProperty('file');
        }
      }
      expect(styleCount, `${host} published no inlined style at all`).toBeGreaterThan(0);
    }
  });

  it('is byte-identical across runs with the same generatedAt', async () => {
    const outDir = makeTempDir();
    await build(outDir);
    const first = readdirSync(join(outDir, 'hosts')).map((name) => [
      name,
      readFileSync(join(outDir, 'hosts', name), 'utf8'),
    ]);

    await build(outDir);
    const second = readdirSync(join(outDir, 'hosts')).map((name) => [
      name,
      readFileSync(join(outDir, 'hosts', name), 'utf8'),
    ]);

    expect(second).toEqual(first);
  });

  it('removes host files it no longer produces', async () => {
    const outDir = makeTempDir();
    const hostsDir = join(outDir, 'hosts');
    mkdirSync(hostsDir, { recursive: true });
    const stale = join(hostsDir, 'old.example.json');
    writeFileSync(stale, '{"format":1,"host":"old.example","plugins":[]}\n');

    await build(outDir);

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(join(hostsDir, 'claude.ai.json'))).toBe(true);
  });
});
