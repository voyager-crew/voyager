import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildHostCatalogs } from '../../../../scripts/lib/buildPluginCatalog';
import { check, siteSchema } from '../manifest/__tests__/jsonSchemaCheck';
import { readSiteAdapterData, siteAdapterToData, validateSiteAdapterData } from './siteAdapterData';

const SITE = {
  id: 'example',
  label: 'Example',
  matches: ['https://example.com/*'],
  theme: { hostSelector: 'html', lightSelector: 'html.light', darkSelector: 'html.dark' },
};

const MALFORMED_ROUTES = [
  ['routeWords', 'new_chat'],
  ['routeWords', ['New_chat']],
  ['routeWords', ['new/chat']],
  ['routeWords', ['']],
  ['routeWords', ['a'.repeat(65)]],
  ['routeWords', Array(65).fill('app')],
  ['accountSlots', 'true'],
  ['accountSlots', 1],
  ['accountSlots', null],
  ['conversationRoutes', '/app/:id'],
  ['conversationRoutes', [null]],
  ['conversationRoutes', ['/']],
  ['conversationRoutes', ['app/:id']],
  ['conversationRoutes', ['/App/:id']],
  ['conversationRoutes', ['/app/:account']],
  ['conversationRoutes', ['/app/*']],
  ['conversationRoutes', ['/app/:id?secret']],
  ['conversationRoutes', ['/app/:id#secret']],
  ['conversationRoutes', [`/${'a'.repeat(65)}`]],
  ['conversationRoutes', [`/${Array(9).fill(':id').join('/')}`]],
  ['conversationRoutes', Array(17).fill('/app/:id')],
] as const;

describe('packaged route and prompt site data', () => {
  it('keeps every override, including explicit false values, through JSON serialization', () => {
    const raw = {
      ...SITE,
      routeWords: ['new_chat', 'app'],
      accountSlots: false,
      conversationRoutes: ['/app/:id', '/gem/:id/:id'],
      prompt: {
        slash: false,
        expandCollapsedComposer: false,
        triggerSpot: 'fab',
        scheme: 'page',
        highlightScope: 'aistudio',
      },
    };
    const parsed = validateSiteAdapterData(raw);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error));
    const serialized: unknown = JSON.parse(JSON.stringify(siteAdapterToData(parsed.data)));
    expect(check(serialized, siteSchema, { strictProperties: true })).toEqual([]);
    expect(serialized).toMatchObject(raw);
    expect(validateSiteAdapterData(serialized)).toEqual(parsed);
  });

  it('accepts the bounded route limits and an empty set of optional overrides', () => {
    for (const overrides of [
      { routeWords: [], conversationRoutes: [], prompt: {} },
      {
        routeWords: Array.from({ length: 64 }, () => 'a'.repeat(64)),
        conversationRoutes: Array.from(
          { length: 16 },
          () => `/${Array(8).fill('a'.repeat(64)).join('/')}`,
        ),
        accountSlots: true,
        prompt: { slash: true, expandCollapsedComposer: true },
      },
    ]) {
      const raw = { ...SITE, ...overrides };
      expect(validateSiteAdapterData(raw).success).toBe(true);
      expect(check(raw, siteSchema)).toEqual([]);
    }
  });

  it.each(MALFORMED_ROUTES)('rejects malformed %s: %j at both data boundaries', (field, value) => {
    const raw = { ...SITE, [field]: value };
    const parsed = validateSiteAdapterData(raw);
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error('Malformed site data was accepted');
    expect(parsed.error.some((issue) => issue.path.startsWith(field))).toBe(true);
    expect(check(raw, siteSchema).length).toBeGreaterThan(0);
    if (field === 'routeWords') expect(readSiteAdapterData(raw).result).toEqual(parsed);
  });

  it.each(MALFORMED_ROUTES.filter(([field]) => field !== 'routeWords'))(
    'keeps the runtime adapter when %s is unreadable: %j',
    (field, value) => {
      const read = readSiteAdapterData({ ...SITE, [field]: value });
      expect(read.result.success).toBe(true);
      if (!read.result.success) throw new Error('Route metadata discarded the adapter');
      expect(read.result.data[field]).toBeUndefined();
      expect(read.sectionIssues.map((issue) => issue.path)).toEqual([field]);
    },
  );

  it.each([
    null,
    [],
    'gemini',
    { slash: 1 },
    { slash: null },
    { expandCollapsedComposer: 'true' },
    { triggerSpot: 'corner' },
    { scheme: 'site' },
    { highlightScope: 'claude' },
    { insert: 'script' },
  ])(
    'drops unreadable prompt %j without failing the adapter, while authoring stays strict',
    (prompt) => {
      const raw = { ...SITE, prompt };
      const read = readSiteAdapterData(raw);
      if (!read.result.success) throw new Error('Optional prompt discarded the adapter');
      expect(read.result.data.prompt).toBeUndefined();
      expect(read.sectionIssues.some((issue) => issue.path.startsWith('prompt'))).toBe(true);
      expect(check(raw, siteSchema).length).toBeGreaterThan(0);
    },
  );

  it.each([
    ['routeWords', 'new_chat'],
    ['accountSlots', 'true'],
    ['conversationRoutes', ['/app/:account']],
    ['prompt', { futureBehavior: true }],
  ] as const)(
    'refuses to publish a bundled site.json with malformed %s: %j',
    async (field, value) => {
      const catalogDir = mkdtempSync(join(tmpdir(), 'voyager-prompt-publishing-'));
      try {
        const siteDir = join(catalogDir, 'sites', 'example');
        mkdirSync(siteDir, { recursive: true });
        writeFileSync(join(siteDir, 'site.json'), JSON.stringify({ ...SITE, [field]: value }));
        await expect(
          buildHostCatalogs({
            catalogDir,
            generatedAt: '2026-10-28T00:00:00.000Z',
            catalogRevision: 1,
          }),
        ).rejects.toThrow(
          field === 'prompt' ? /invalid site.json section[\s\S]*prompt.futureBehavior/ : field,
        );
      } finally {
        rmSync(catalogDir, { recursive: true, force: true });
      }
    },
  );
});
