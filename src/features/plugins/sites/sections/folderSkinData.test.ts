import { describe, expect, it } from 'vitest';

import { listBundledSiteEntries, requireBundledSiteAdapter } from '../../catalog/sites';
import { loadBundledSiteAdapters } from '../../catalog/sites/loadBundledSites';
import {
  normalizeHostCatalogCacheEntry,
  siteAdapterFromEntry,
} from '../../remote/hostCatalogCache';
import { validateHostCatalogFile } from '../../remote/hostCatalogFile';
import { protectSiteAdapterIdentity } from '../../remote/siteIdentity';
import {
  isSameSiteAdapter,
  resolveSiteAdapterForUrl,
  resolveSiteOverride,
} from '../../remote/siteOverride';
import type { SiteAdapter } from '../../types';
import { SiteRegistry } from '../registry';
import { readSiteAdapterData, siteAdapterToData } from '../siteAdapterData';
import type { FolderSkin } from './folderSkinData';

const SITES = [
  ['claude', 'claude.ai'],
  ['deepseek', 'chat.deepseek.com'],
] as const;

function skinOf(adapter: SiteAdapter): FolderSkin {
  if (!adapter.folderSkin) throw new Error(`No folder skin for ${adapter.id}`);
  return adapter.folderSkin;
}

function published(id: string, skin: unknown) {
  const bundled = requireBundledSiteAdapter(id);
  return {
    ...siteAdapterToData(bundled),
    catalogRevision: 11,
    selectors: { ...bundled.selectors, userTurn: '.repaired-user-turn' },
    folderSkin: skin,
  };
}

function registryFor(bundled: SiteAdapter): SiteRegistry {
  const registry = new SiteRegistry();
  registry.register({ ...bundled, catalogRevision: 10 });
  return registry;
}

function cached(host: string, site: unknown): SiteAdapter | null {
  const raw: unknown = JSON.parse(
    JSON.stringify({
      host,
      status: 'ok',
      manifests: [],
      fetchedAt: 1,
      lastAttemptAt: 1,
      failureCount: 0,
      extensionVersion: 'test',
      site,
    }),
  );
  return siteAdapterFromEntry(normalizeHostCatalogCacheEntry(raw, host), 'test');
}

describe('folder appearance data boundaries', () => {
  it.each(SITES)('loads %s tokens from the shipped JSON without losing theme values', (id) => {
    const entry = listBundledSiteEntries().find((site) => site.siteDir === id);
    if (!entry) throw new Error(`Missing bundled ${id}`);
    const raw: unknown = JSON.parse(entry.siteJson);
    const read = readSiteAdapterData(raw);
    expect(read.sectionIssues).toEqual([]);
    if (!read.result.success) throw new Error('Bundled adapter was rejected');
    const loaded = loadBundledSiteAdapters([entry], {
      catalogRevision: 10,
      onInvalid: () => {},
    });
    expect(loaded).toHaveLength(1);
    expect(skinOf(loaded[0])).toEqual(skinOf(read.result.data));
    const roundTrip = readSiteAdapterData(JSON.parse(JSON.stringify(siteAdapterToData(loaded[0]))));
    if (!roundTrip.result.success) throw new Error('Serialized skin was rejected');
    expect(roundTrip.sectionIssues).toEqual([]);
    expect(skinOf(roundTrip.result.data)).toEqual(skinOf(loaded[0]));
  });

  const base = skinOf(requireBundledSiteAdapter('claude'));
  const color = (text: unknown) => ({ ...base, light: { ...base.light, text } });
  const invalid: { label: string; skin: unknown; path: string }[] = [
    { label: 'a non-object', skin: null, path: 'folderSkin' },
    { label: 'an array', skin: [], path: 'folderSkin' },
    {
      label: 'an unknown token',
      skin: { ...base, fontFamily: 'serif' },
      path: 'folderSkin.fontFamily',
    },
    {
      label: 'an unknown light colour',
      skin: { ...base, light: { ...base.light, arbitrary: '#fff' } },
      path: 'folderSkin.light.arbitrary',
    },
    {
      label: 'an unknown dark colour',
      skin: { ...base, dark: { arbitrary: '#fff' } },
      path: 'folderSkin.dark.arbitrary',
    },
    { label: 'a missing required colour', skin: color(undefined), path: 'folderSkin.light.text' },
    { label: 'a non-string colour', skin: color(123), path: 'folderSkin.light.text' },
    {
      label: 'a declaration escape',
      skin: color('#fff; color: red'),
      path: 'folderSkin.light.text',
    },
    {
      label: 'a rule escape',
      skin: color('#fff} body{display:none'),
      path: 'folderSkin.light.text',
    },
    {
      label: 'a remote resource',
      skin: color('url(https://example.com/pixel)'),
      path: 'folderSkin.light.text',
    },
    {
      label: 'an image function',
      skin: color('image-set("https://example.com/pixel" 1x)'),
      path: 'folderSkin.light.text',
    },
    {
      label: 'a resource in a fallback',
      skin: color('var(--host-text, url(https://example.com/pixel))'),
      path: 'folderSkin.light.text',
    },
    {
      label: 'an unbounded variable',
      skin: color('var(--host-text)'),
      path: 'folderSkin.light.text',
    },
    {
      label: 'an invalid RGB channel',
      skin: color('rgba(256, 0, 0, 0.5)'),
      path: 'folderSkin.light.text',
    },
    { label: 'an invalid alpha', skin: color('rgba(0, 0, 0, 2)'), path: 'folderSkin.light.text' },
    {
      label: 'an invalid mix percentage',
      skin: color('color-mix(in oklab, #fff 101%, transparent)'),
      path: 'folderSkin.light.text',
    },
    {
      label: 'an oversized colour',
      skin: color(`var(--${'x'.repeat(256)}, #fff)`),
      path: 'folderSkin.light.text',
    },
    { label: 'a short row', skin: { ...base, rowHeight: '15px' }, path: 'folderSkin.rowHeight' },
    { label: 'a tall row', skin: { ...base, rowHeight: '65px' }, path: 'folderSkin.rowHeight' },
    {
      label: 'an unbounded row metric',
      skin: { ...base, rowHeight: '100vh' },
      path: 'folderSkin.rowHeight',
    },
    {
      label: 'an oversized metric fallback',
      skin: { ...base, rowHeight: 'var(--row-height, 1000px)' },
      path: 'folderSkin.rowHeight',
    },
    {
      label: 'a metric escape',
      skin: { ...base, rowHeight: '32px;display:none' },
      path: 'folderSkin.rowHeight',
    },
    {
      label: 'a negative radius',
      skin: { ...base, rowRadius: '-1px' },
      path: 'folderSkin.rowRadius',
    },
    { label: 'a large radius', skin: { ...base, rowRadius: '33px' }, path: 'folderSkin.rowRadius' },
    {
      label: 'a dark palette of the wrong shape',
      skin: { ...base, dark: '#fff' },
      path: 'folderSkin.dark',
    },
    {
      label: 'a header without its opaque sidebar',
      skin: { ...base, header: { height: 36, paddingInlineEnd: 28 } },
      path: 'folderSkin.light.sidebar',
    },
  ];

  it.each(invalid)('drops $label without discarding online selector repairs', ({ skin, path }) => {
    const raw = published('claude', skin);
    const host = 'claude.ai';
    const file = validateHostCatalogFile({ format: 1, host, plugins: [], site: raw }, host);
    if (!file?.site) throw new Error('Bad appearance discarded the usable adapter');
    expect(file.issues).toEqual([]);
    expect(file.siteIssues.map((issue) => issue.path)).toContain(`site.${path}`);
    expect(file.site.folderSkin).toBeUndefined();
    expect(file.site.selectors.userTurn).toBe('.repaired-user-turn');

    const bundled = requireBundledSiteAdapter('claude');
    for (const accepted of [
      protectSiteAdapterIdentity(bundled, file.site),
      resolveSiteAdapterForUrl(`https://${host}/new`, registryFor(bundled), file.site),
      cached(host, raw),
    ]) {
      if (!accepted) throw new Error('Rejected appearance lost the bundled fallback');
      expect(skinOf(accepted)).toEqual(skinOf(bundled));
      expect(accepted.selectors.userTurn).toBe('.repaired-user-turn');
    }
  });

  it.each([
    { height: 15, paddingInlineEnd: 28 },
    { height: 65, paddingInlineEnd: 28 },
    { height: 36.5, paddingInlineEnd: 28 },
    { height: '36px', paddingInlineEnd: 28 },
    { height: 36, paddingInlineEnd: -1 },
    { height: 36, paddingInlineEnd: 129 },
    { height: 36, paddingInlineEnd: 28.5 },
    { height: 36, paddingInlineEnd: '28px' },
    { height: 36, paddingInlineEnd: 28, position: 'fixed' },
  ])('refuses header geometry outside its bounded numeric contract: %j', (header) => {
    const skin = { ...skinOf(requireBundledSiteAdapter('deepseek')), header };
    const host = 'chat.deepseek.com';
    const file = validateHostCatalogFile(
      { format: 1, host, plugins: [], site: published('deepseek', skin) },
      host,
    );
    expect(file?.site?.folderSkin).toBeUndefined();
    expect(file?.siteIssues.some((issue) => issue.path.startsWith('site.folderSkin.header'))).toBe(
      true,
    );
  });

  it.each(SITES)(
    'keeps valid online %s changes through JSON and catalog cache round trips',
    (id, host) => {
      const bundled = requireBundledSiteAdapter(id);
      const changed = {
        ...skinOf(bundled),
        rowHeight: 'var(--host-row-height, 48px)',
        rowRadius: '0px',
        light: { ...skinOf(bundled).light, text: 'rgb(1, 2, 3)' },
        dark: { text: '#f8f8f8' },
      };
      const file = validateHostCatalogFile(
        { format: 1, host, plugins: [], site: published(id, changed) },
        host,
      );
      if (!file?.site) throw new Error('Valid online skin was rejected');
      expect(file.siteIssues).toEqual([]);
      const serialized: unknown = JSON.parse(JSON.stringify(siteAdapterToData(file.site)));
      for (const accepted of [
        resolveSiteAdapterForUrl(`https://${host}/`, registryFor(bundled), file.site),
        cached(host, serialized),
      ]) {
        if (!accepted) throw new Error('Valid online skin was lost');
        expect(skinOf(accepted)).toEqual(changed);
        expect(accepted.folders).toEqual(bundled.folders);
      }
      expect(isSameSiteAdapter(bundled, { ...bundled, folderSkin: changed })).toBe(false);
    },
  );

  it.each(SITES)(
    'uses bundled %s appearance when the online value is absent or the source fails',
    async (id, host) => {
      const bundled = requireBundledSiteAdapter(id);
      const file = validateHostCatalogFile(
        { format: 1, host, plugins: [], site: published(id, undefined) },
        host,
      );
      if (!file?.site) throw new Error('Missing optional skin discarded the adapter');
      expect(skinOf(protectSiteAdapterIdentity(bundled, file.site))).toEqual(skinOf(bundled));

      const unavailable = await resolveSiteOverride(
        [
          {
            id: 'offline-catalog',
            list: async () => [],
            siteOverride: async () => {
              throw new Error('offline');
            },
          },
        ],
        { host },
      );
      const accepted = resolveSiteAdapterForUrl(
        `https://${host}/`,
        registryFor(bundled),
        unavailable,
      );
      if (!accepted) throw new Error('Online failure lost the bundled adapter');
      expect(skinOf(accepted)).toEqual(skinOf(bundled));
    },
  );
});
