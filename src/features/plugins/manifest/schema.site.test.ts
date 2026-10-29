/**
 * `docs/public/site.schema.json`, with the section files it names, against
 * `validateSiteAdapterData`: see `schema.test.ts` for why the two are pinned.
 */
import { describe, expect, it } from 'vitest';

import { requireBundledSiteAdapter } from '../catalog/sites';
import {
  readSiteAdapterData,
  siteAdapterToData,
  validateSiteAdapterData,
} from '../sites/siteAdapterData';
import { check, listBundledSites, siteSchema } from './__tests__/jsonSchemaCheck';

describe('site.schema.json', () => {
  const sites = listBundledSites();

  it('finds the bundled sites', () => {
    expect(sites.length).toBeGreaterThan(0);
  });

  it.each(sites.map((site) => [site.label, site.raw] as const))(
    'accepts %s, and so does validateSiteAdapterData',
    (_label, raw) => {
      expect(check(raw, siteSchema)).toEqual([]);
      const result = validateSiteAdapterData(raw);
      expect(result.success ? [] : result.error).toEqual([]);
      if (!result.success) return;
      // `capabilities` is a Set on the adapter; the published/serializable form
      // is what a site.json actually looks like.
      expect(check(siteAdapterToData(result.data), siteSchema, { strictProperties: true })).toEqual(
        [],
      );
    },
  );

  it('rejects site documents the validator also rejects', () => {
    const base = listBundledSites()[0].raw;

    const noId = { ...base } as Record<string, unknown>;
    delete noId.id;
    expect(check(noId, siteSchema)).toContain('$: missing required "id"');

    const badKey = { ...base, selectors: { ...(base.selectors as object), notAKey: 'div' } };
    expect(check(badKey, siteSchema).join('\n')).toMatch(/notAKey/);

    const badCapability = { ...base, capabilities: ['chat', 'teleport'] };
    expect(check(badCapability, siteSchema).join('\n')).toMatch(/capabilities\[1\]/);

    const badTheme = { ...base, theme: { hostSelector: 'html' } };
    expect(check(badTheme, siteSchema).join('\n')).toMatch(/lightSelector/);

    const negativeRevision = { ...base, catalogRevision: -1 };
    expect(check(negativeRevision, siteSchema).join('\n')).toMatch(/catalogRevision.*minimum/);
    const hugeRevision = { ...base, catalogRevision: Number.MAX_SAFE_INTEGER + 2 };
    expect(check(hugeRevision, siteSchema).join('\n')).toMatch(/catalogRevision.*maximum/);
    expect(check({ ...base, catalogRevision: 7 }, siteSchema)).toEqual([]);

    const badPattern = { ...base, conversationIdPattern: '^/chat/(' };
    expect(check(badPattern, siteSchema).join('\n')).toMatch(/conversationIdPattern.*regular/);

    for (const broken of [noId, badKey, badCapability, badTheme, negativeRevision]) {
      expect(validateSiteAdapterData(broken).success).toBe(false);
    }
  });

  it('rejects folder appearance outside the bounded token contract', () => {
    const adapter = requireBundledSiteAdapter('deepseek');
    const base = siteAdapterToData(adapter);
    const skin = adapter.folderSkin!;
    const invalid = [
      { ...skin, storageKey: 'other-folders' },
      { ...skin, light: { ...skin.light, text: undefined } },
      { ...skin, light: { ...skin.light, text: 'url(https://example.com/pixel)' } },
      { ...skin, dark: { text: '#fff;display:none' } },
      { ...skin, dark: { arbitrary: '#fff' } },
      { ...skin, rowHeight: '65px' },
      { ...skin, rowRadius: 'var(--radius, 33px)' },
      { ...skin, header: { height: 15, paddingInlineEnd: 28 } },
      { ...skin, header: { height: 36, paddingInlineEnd: 129 } },
      { ...skin, light: { ...skin.light, sidebar: undefined } },
    ];
    for (const folderSkin of invalid) {
      const raw = { ...base, folderSkin };
      expect(check(raw, siteSchema), JSON.stringify(folderSkin)).not.toEqual([]);
      const read = readSiteAdapterData(raw);
      expect(read.result.success).toBe(true);
      expect(read.sectionIssues.some((issue) => issue.path.startsWith('folderSkin'))).toBe(true);
      if (read.result.success) expect(read.result.data.folderSkin).toBeUndefined();
    }
  });
});
