/**
 * Which entry points admit a scripted plugin: only the local gate, and only
 * when its caller asks. Every declarative verdict is the same with or without
 * the request.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { checkPluginDir } from '../../../../../packages/create-voyager-plugin/src/check';
import { CORPUS } from '../../../../../packages/create-voyager-plugin/test/corpus';
import type { BundledPluginEntry } from '../../catalog/sites';
import { readLocalPluginFiles } from '../../local/localPluginFiles';
import { validateLocalManifest } from '../../local/validateLocalManifest';
import { MAX_SCRIPT_SOURCE_CHARS } from '../../manifest/scriptedChecks';
import { validateManifest } from '../../manifest/validate';
import { validateHostCatalogFile } from '../../remote/hostCatalogFile';
import { BundledCatalogPluginSource } from '../../sources/BundledCatalogPluginSource';
import { declarative, scripted } from './fixtures';

const bundled = vi.hoisted(() => ({ entries: [] as BundledPluginEntry[] }));
vi.mock('../../catalog/sites', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../catalog/sites')>()),
  listBundledPluginEntries: () => bundled.entries,
}));

const work = mkdtempSync(join(tmpdir(), 'gv-scripted-gate-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

type EntryPoint = (manifest: Record<string, unknown>) => Promise<boolean>;

const ENTRY_POINTS: Record<string, EntryPoint> = {
  'local gate, scripted allowed': async (manifest) =>
    validateLocalManifest(manifest, undefined, { allowScripted: true }).success,
  'local gate, default': async (manifest) => validateLocalManifest(manifest).success,
  'remote catalog': async (manifest) =>
    validateHostCatalogFile({ format: 1, host: 'chatgpt.com', plugins: [manifest] }, 'chatgpt.com')!
      .manifests.length === 1,
  'bundled catalog': async (manifest) => {
    bundled.entries = [
      {
        siteDir: 'chatgpt',
        pluginDir: 'case',
        path: 'sites/chatgpt/plugins/case/plugin.json',
        manifestJson: JSON.stringify(manifest),
        styles: {},
      },
    ];
    return (await new BundledCatalogPluginSource().list()).length === 1;
  },
  'create-voyager-plugin check': async (manifest) => {
    const dir = mkdtempSync(join(work, 'case-'));
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify(manifest));
    return (await checkPluginDir(dir)).accepted !== undefined;
  },
};

const ADMITS_SCRIPTED: Record<string, boolean> = {
  'local gate, scripted allowed': true,
  'local gate, default': false,
  'remote catalog': false,
  'bundled catalog': false,
  'create-voyager-plugin check': false,
};

describe('the scripted gate matrix', () => {
  it.each(Object.keys(ENTRY_POINTS))('%s accepts a declarative plugin', async (name) => {
    expect(await ENTRY_POINTS[name](declarative())).toBe(true);
  });

  it.each(Object.keys(ENTRY_POINTS))('%s decides on a scripted plugin', async (name) => {
    expect(await ENTRY_POINTS[name](scripted())).toBe(ADMITS_SCRIPTED[name]);
  });

  it.each(Object.keys(ENTRY_POINTS))(
    '%s refuses a declarative plugin that carries a script',
    async (name) => {
      const smuggled = declarative({
        contributes: { styles: [{ css: '.gv-wide{max-width:none}' }], script: { source: 'x()' } },
      });
      expect(await ENTRY_POINTS[name](smuggled)).toBe(false);
    },
  );
});

describe('the local gate with scripted allowed', () => {
  const allowed = (manifest: Record<string, unknown>) =>
    validateLocalManifest(manifest, undefined, { allowScripted: true });
  const paths = (manifest: Record<string, unknown>) => {
    const result = allowed(manifest);
    return result.success ? [] : result.error.map((issue) => issue.path);
  };

  it('keeps the script and the tier on the accepted manifest', () => {
    const result = allowed(scripted());
    expect(result.success && result.data.manifest).toMatchObject({
      id: 'local.me.send-counter',
      tier: 'scripted',
      contributes: { script: { source: 'document.title = "sent: 0";' } },
    });
  });

  it('refuses a scripted plugin that also contributes styles, page changes or settings', () => {
    const script = { source: 'x()' };
    expect(paths(scripted({ contributes: { script, styles: [{ css: 'a{}' }] } }))).toContain(
      'contributes.styles',
    );
    expect(
      paths(scripted({ contributes: { script, domOps: [{ op: 'hide', target: 'aside' }] } })),
    ).toContain('contributes.domOps');
    expect(
      paths(
        scripted({
          contributes: {
            script,
            settings: { on: { type: 'boolean', label: 'On', default: true } },
          },
        }),
      ),
    ).toContain('contributes.settings');
    expect(paths(scripted({ theme: { brand: '#d97757' } }))).toContain('theme');
  });

  it('refuses a scripted plugin without a source or with one past the cap', () => {
    expect(paths(scripted({ contributes: {} }))).toEqual(['contributes.script.source']);
    expect(paths(scripted({ contributes: { script: { source: '' } } }))).toEqual([
      'contributes.script.source',
    ]);
    const atCap = 'x'.repeat(MAX_SCRIPT_SOURCE_CHARS);
    expect(paths(scripted({ contributes: { script: { source: atCap } } }))).toEqual([]);
    expect(paths(scripted({ contributes: { script: { source: `${atCap}x` } } }))).toEqual([
      'contributes.script.source',
    ]);
  });

  it('keeps a scripted plugin inside the sites plugins can target', () => {
    expect(paths(scripted({ matches: ['https://example.com/*'] }))).toEqual(['matches[0]']);
    expect(paths(scripted({ matches: ['<all_urls>'] }))).toEqual(['matches[0]']);
  });
});

describe('declarative verdicts', () => {
  const declarativeCases = CORPUS.filter(
    (entry) => !entry.files['plugin.json'].includes('"scripted"'),
  );

  it.each(declarativeCases.map((entry) => [entry.name, entry] as const))(
    'are identical with and without allowScripted for %s',
    async (_name, entry) => {
      const files = Object.entries(entry.files).map(([name, text]) => ({ name, text }));
      const read = await readLocalPluginFiles(files);
      if (!read.success) return;
      expect(validateLocalManifest(read.data, undefined, { allowScripted: true })).toEqual(
        validateLocalManifest(read.data),
      );
      expect(validateManifest(read.data, { allowScripted: true })).toEqual(
        validateManifest(read.data),
      );
    },
  );

  it('still list every other problem when the default gate refuses a scripted plugin', () => {
    const result = validateLocalManifest(scripted({ matches: ['https://example.com/*'] }));
    expect(result.success ? [] : result.error.map((issue) => issue.path)).toEqual([
      'tier',
      'matches[0]',
    ]);
  });
});
