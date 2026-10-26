import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { validateHostCatalogFile } from '@/features/plugins/remote/hostCatalogFile';
import { mergePluginRecords } from '@/features/plugins/sources/defaultSources';

import {
  build,
  makeFixtureCatalog,
  makePackagedFixtureCatalog,
  makeTempDir,
  PACKAGED_SITES,
  readHostFile,
  removeTempDirs,
  writeJson,
} from './buildPluginCatalogFixtures';

afterEach(removeTempDirs);

function revoke(catalogDir: string, entries: unknown): void {
  writeJson(join(catalogDir, 'sites/demo/revoked.json'), entries);
}

describe('catalog revocations', () => {
  it('writes revoked ids to every site host without publishing reasons or revoked plugins', async () => {
    const catalogDir = makeFixtureCatalog({
      site: { matches: ['https://demo.example/*', 'https://other.demo.example/*'] },
    });
    revoke(catalogDir, [
      { id: 'voyager.demo-retired', reason: 'Replaced by the host.' },
      { id: 'voyager.demo-obsolete', reason: 'No longer useful.' },
    ]);
    const outDir = makeTempDir();
    await build(outDir, catalogDir);
    for (const host of ['demo.example', 'other.demo.example']) {
      const file = readHostFile(outDir, host);
      expect(file.format).toBe(1);
      expect(file.revoked).toEqual([
        ...(host === 'demo.example' ? [] : ['demo.widen']),
        'voyager.demo-obsolete',
        'voyager.demo-retired',
      ]);
      expect((file.plugins as { id: string }[]).map((plugin) => plugin.id)).toEqual(
        host === 'demo.example' ? ['demo.widen'] : [],
      );
    }
  });

  it('stops a plugin on a host its matches no longer cover', async () => {
    const hosts = ['demo.example', 'other.demo.example'];
    const matches = hosts.map((host) => `https://${host}/*`);
    const catalogDir = makeFixtureCatalog({ site: { matches } });
    const outDir = makeTempDir();
    await build(outDir, catalogDir);
    const current = validateHostCatalogFile(readHostFile(outDir, hosts[0]), hosts[0])!;
    const bundled = { manifest: { ...current.manifests[0], matches }, sourceId: 'bundled' };

    for (const host of hosts) {
      const catalog = validateHostCatalogFile(readHostFile(outDir, host), host)!;
      expect(catalog.issues).toEqual([]);
      expect(catalog.revoked ?? []).toEqual(host === hosts[0] ? [] : ['demo.widen']);
      const merged = mergePluginRecords({
        builtin: [],
        snapshot: [bundled],
        remote: catalog.manifests.map((manifest) => ({ manifest, sourceId: 'remote' })),
        revoked: catalog.revoked,
        remoteAuthoritative: true,
        scopeUrl: `https://${host}/chat`,
      });
      expect(merged.map(({ manifest }) => manifest.id)).toEqual(
        host === hosts[0] ? ['demo.widen'] : [],
      );
    }
  });

  it('keeps a plugin on its host when its matches name only some paths there', async () => {
    const catalogDir = makeFixtureCatalog({ matches: ['https://demo.example/c/*'] });
    const outDir = makeTempDir();
    await build(outDir, catalogDir);
    expect(readHostFile(outDir, 'demo.example').revoked).toBeUndefined();
  });

  it('refuses to silently omit a plugin directory missing plugin.json', async () => {
    const catalogDir = makeFixtureCatalog();
    mkdirSync(join(catalogDir, 'sites/demo/plugins/unfinished'));
    const outDir = makeTempDir();
    await expect(build(outDir, catalogDir)).rejects.toThrow(
      'sites/demo/plugins/unfinished: missing plugin.json',
    );
    expect(existsSync(join(outDir, 'hosts'))).toBe(false);
  });

  it.each(PACKAGED_SITES)(
    'refuses revocations of $id plugins that retain packaged authority',
    async ({ id }) => {
      const catalogDir = makePackagedFixtureCatalog();
      writeJson(join(catalogDir, `sites/${id}/revoked.json`), [
        { id: `voyager.${id}-retired`, reason: 'Retired.' },
      ]);
      const outDir = makeTempDir();
      await expect(build(outDir, catalogDir)).rejects.toThrow(
        `sites/${id}/revoked.json: no concrete host allows remote catalog publication`,
      );
      expect(existsSync(join(outDir, 'hosts'))).toBe(false);
    },
  );

  it('refuses revocations that cannot reach any concrete host', async () => {
    const matches = ['https://*.demo.example/*'];
    const catalogDir = makeFixtureCatalog({ matches, site: { matches } });
    revoke(catalogDir, [{ id: 'voyager.demo-retired', reason: 'Retired.' }]);
    const outDir = makeTempDir();
    await expect(build(outDir, catalogDir)).rejects.toThrow(
      'sites/demo/revoked.json: no concrete host allows remote catalog publication',
    );
    expect(existsSync(join(outDir, 'hosts'))).toBe(false);
  });

  it('still publishes revocations after the site loses its last live plugin', async () => {
    const catalogDir = makeFixtureCatalog();
    rmSync(join(catalogDir, 'sites/demo/plugins'), { recursive: true });
    revoke(catalogDir, [{ id: 'voyager.demo-widen', reason: 'Retired.' }]);
    const outDir = makeTempDir();
    await build(outDir, catalogDir);
    expect(readHostFile(outDir, 'demo.example')).toMatchObject({
      format: 1,
      plugins: [],
      revoked: ['voyager.demo-widen'],
    });
  });

  it('refuses a revoked id that is still a live plugin', async () => {
    const catalogDir = makeFixtureCatalog({ manifest: { id: 'voyager.demo-widen' } });
    revoke(catalogDir, [{ id: 'voyager.demo-widen', reason: 'Retired.' }]);
    await expect(build(makeTempDir(), catalogDir)).rejects.toThrow(/still a live plugin/);
  });

  it.each([
    { id: 'voyager.claude-retired', reason: 'Wrong site.' },
    { id: 'local.demo-retired', reason: 'User-owned.' },
    { id: 'voyager.demo-', reason: 'Missing segment.' },
    { id: 'voyager.demo-bad id', reason: 'Malformed.' },
    { id: 12, reason: 'Invalid type.' },
    { id: 'voyager.demo-retired', reason: '' },
    { id: 'voyager.demo-retired', reason: 12 },
    null,
  ])('refuses a malformed or foreign revocation: %j', async (entry) => {
    const catalogDir = makeFixtureCatalog();
    revoke(catalogDir, [entry]);
    await expect(build(makeTempDir(), catalogDir)).rejects.toThrow(/revoked\.json\[0\]/);
  });

  it('refuses duplicate revoked ids and a non-array revocation file', async () => {
    const catalogDir = makeFixtureCatalog();
    const entry = { id: 'voyager.demo-retired', reason: 'Retired.' };
    revoke(catalogDir, [entry, entry]);
    await expect(build(makeTempDir(), catalogDir)).rejects.toThrow(/duplicate revoked id/);
    revoke(catalogDir, entry);
    await expect(build(makeTempDir(), catalogDir)).rejects.toThrow(/must be an array/);
  });
});
