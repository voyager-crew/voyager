import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { requireBundledSiteAdapter } from '@/features/plugins/catalog/sites';
import { validateHostCatalogFile } from '@/features/plugins/remote/hostCatalogFile';
import { resolveSiteAdapterForUrl } from '@/features/plugins/remote/siteOverride';
import { SiteRegistry } from '@/features/plugins/sites/registry';

import { DEFAULT_CATALOG_DIR, writeHostCatalogs } from '../build-plugin-catalog';
import {
  GENERATED_AT,
  SOURCE_REVISION,
  EXPECTED_SITES,
  makeTempDir,
  build,
  readHostFile,
  PACKAGED_HOSTS,
  makePackagedFixtureCatalog,
  removeTempDirs,
} from './buildPluginCatalogFixtures';

afterEach(removeTempDirs);

describe('build-plugin-catalog', () => {
  it('publishes one file per concrete host in the bundled catalog', async () => {
    const outDir = makeTempDir();
    await build(outDir);

    const names = readdirSync(join(outDir, 'hosts')).sort();
    expect(names).toEqual(
      [
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
    for (const host of PACKAGED_HOSTS) expect(names).not.toContain(`${host}.json`);
  });

  it('checks native plugins and publishes the Gemini host without shipping native plugins', async () => {
    const outDir = makeTempDir();
    const catalogDir = makePackagedFixtureCatalog();

    const written = await build(outDir, catalogDir);

    expect(written.map((entry) => entry.host)).toEqual(['demo.example', 'gemini.google.com']);
    expect(readHostFile(outDir, 'gemini.google.com')).toMatchObject({
      plugins: [],
      site: { id: 'gemini' },
    });
    expect(readdirSync(join(outDir, 'hosts')).sort()).toEqual([
      'demo.example.json',
      'gemini.google.com.json',
    ]);
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

  it('removes host files for the native hosts outside the catalog', async () => {
    const outDir = makeTempDir();
    const hostsDir = join(outDir, 'hosts');
    mkdirSync(hostsDir, { recursive: true });
    for (const host of PACKAGED_HOSTS) {
      writeFileSync(join(hostsDir, `${host}.json`), `{"format":1,"host":"${host}","plugins":[]}\n`);
    }

    await build(outDir, makePackagedFixtureCatalog());

    expect(readdirSync(hostsDir).sort()).toEqual(['demo.example.json', 'gemini.google.com.json']);
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
