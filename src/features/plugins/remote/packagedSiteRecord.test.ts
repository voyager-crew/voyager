import { afterEach, describe, expect, it, vi } from 'vitest';

import * as contracts from '@/core/selectors/contracts';

import { requireBundledSiteAdapter } from '../catalog/sites';
import { SiteRegistry } from '../sites/registry';
import { siteAdapterToData } from '../sites/siteAdapterData';
import { normalizeHostCatalogCacheEntry, siteAdapterFromEntry } from './hostCatalogCache';
import { validateHostCatalogFile } from './hostCatalogFile';
import { packagedSiteRecordToData } from './packagedSiteRecord';
import { resolveSiteAdapterForUrl } from './siteOverride';

const VERSION = 'test';
const CASES = [
  { host: 'gemini.google.com', id: 'gemini', locator: 'turn.user' },
  { host: 'aistudio.google.com', id: 'aistudio', locator: 'input.candidates' },
] as const;

afterEach(() => vi.restoreAllMocks());

function resolveRecord(host: string, site: unknown) {
  const wire: unknown = JSON.parse(JSON.stringify({ format: 1, host, plugins: [], site }));
  const validation = validateHostCatalogFile(wire, host);
  expect(validation?.issues).toEqual([]);
  expect(validation?.siteIssues).toEqual([]);
  if (!validation?.site) throw new Error('Published site was rejected');
  const entry = normalizeHostCatalogCacheEntry(
    {
      host,
      site: siteAdapterToData(validation.site),
      status: 'ok',
      manifests: [],
      extensionVersion: VERSION,
      fetchedAt: 1,
      lastAttemptAt: 1,
      failureCount: 0,
    },
    host,
  );
  const override = siteAdapterFromEntry(entry, VERSION);
  expect(override).not.toBeNull();
  return resolveSiteAdapterForUrl(`https://${host}/`, SiteRegistry.createDefault(), override);
}

describe('packaged site publishing', () => {
  it.each(CASES)('retains parser requirements while omitting optional sections for $id', (site) => {
    const bundled = requireBundledSiteAdapter(site.id);
    const published = packagedSiteRecordToData(bundled);
    expect(published.label).toBe(bundled.label);
    expect(published.theme).toEqual(bundled.theme);
    expect(published.selectors).toEqual(bundled.selectors);
    for (const key of ['capabilities', 'folders', 'prompt'] as const) {
      expect(bundled[key]).toBeDefined();
      expect(published).not.toHaveProperty(key);
    }
    const wire: unknown = JSON.parse(
      JSON.stringify({ format: 1, host: site.host, plugins: [], site: published }),
    );
    expect(validateHostCatalogFile(wire, site.host)).toMatchObject({
      issues: [],
      siteIssues: [],
      site: { id: site.id, label: bundled.label, theme: bundled.theme },
    });
  });

  it.each(CASES)(
    'delivers admitted repairs while keeping a non-contract selector bundled for $id',
    (site) => {
      const bundled = requireBundledSiteAdapter(site.id);
      // Admit sidebar and exclude composer in this contract fixture.
      const lookup = contracts.getSiteSelectorContract;
      const contract = lookup(site.id)!;
      vi.spyOn(contracts, 'getSiteSelectorContract').mockImplementation((id) =>
        id === site.id
          ? {
              ...contract,
              keys: [
                ...contract.keys.filter((key) => key !== 'composer' && key !== 'sidebar'),
                'sidebar',
              ],
              groups: [...contract.groups, ['sidebar']],
            }
          : lookup(id),
      );
      const published = packagedSiteRecordToData({
        ...bundled,
        catalogRevision: (bundled.catalogRevision ?? 0) + 1,
        selectors: {
          ...bundled.selectors,
          sidebar: '.repaired-sidebar',
          composer: '.unadmitted-composer',
        },
        locators: { [site.locator]: ['.repaired-locator'] },
      });
      expect(published.selectors.composer).toBe('.unadmitted-composer');
      const resolved = resolveRecord(site.host, published);
      expect(resolved?.selectors.sidebar).toBe('.repaired-sidebar');
      expect(resolved?.locators?.[site.locator]).toEqual(['.repaired-locator']);
      expect(resolved?.selectors.composer).toBe(bundled.selectors.composer);
    },
  );
});
