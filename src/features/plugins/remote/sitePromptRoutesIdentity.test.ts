import { describe, expect, it } from 'vitest';

import { requireBundledSiteAdapter } from '../catalog/sites';
import { SiteRegistry } from '../sites/registry';
import { siteAdapterToData } from '../sites/siteAdapterData';
import type { SiteAdapter } from '../types';
import { normalizeHostCatalogCacheEntry, siteAdapterFromEntry } from './hostCatalogCache';
import { validateHostCatalogFile } from './hostCatalogFile';
import { protectSiteAdapterIdentity } from './siteIdentity';
import { resolveSiteAdapterForUrl } from './siteOverride';

function cached(host: string, site: unknown): SiteAdapter | null {
  const entry = normalizeHostCatalogCacheEntry(
    {
      host,
      status: 'ok',
      manifests: [],
      fetchedAt: 1,
      lastAttemptAt: 1,
      failureCount: 0,
      extensionVersion: 'test',
      site,
    },
    host,
  );
  return siteAdapterFromEntry(entry, 'test');
}

describe('route and prompt identity at remote boundaries', () => {
  it.each([
    ['gemini', 'gemini.google.com'],
    ['aistudio', 'aistudio.google.com'],
    ['chatgpt', 'chatgpt.com'],
  ])('%s on %s keeps online repairs and bundled facts with unreadable metadata', (id, host) => {
    const bundle = requireBundledSiteAdapter(id);
    const unreadable = [
      ['prompt', { ...bundle.prompt, futureBehavior: true }],
      ['prompt', 'future-format'],
      ['accountSlots', 'future-format'],
      ['conversationRoutes', ['/c/:conversationId']],
    ] as const;
    for (const [field, value] of unreadable) {
      const raw = {
        ...siteAdapterToData(bundle),
        catalogRevision: (bundle.catalogRevision ?? 0) + 1,
        selectors: { ...bundle.selectors, sidebar: '#repaired-sidebar' },
        locators: { 'input.fab': ['#repaired-fab'] },
        [field]: value,
      };
      const published = validateHostCatalogFile({ format: 1, host, plugins: [], site: raw }, host);
      if (!published?.site) throw new Error(`Unreadable ${field} discarded online repairs`);
      expect(published.issues).toEqual([]);
      expect(published.siteIssues.some((issue) => issue.path.startsWith(`site.${field}`))).toBe(
        true,
      );
      expect(published.site[field]).toBeUndefined();
      expect(published.site.selectors.sidebar).toBe('#repaired-sidebar');
      expect(published.site.locators?.['input.fab']).toEqual(['#repaired-fab']);

      for (const accepted of [
        cached(host, raw),
        resolveSiteAdapterForUrl(`https://${host}/`, SiteRegistry.createDefault(), published.site),
      ]) {
        if (!accepted) throw new Error(`Unreadable ${field} discarded the usable adapter`);
        expect(accepted[field]).toEqual(bundle[field]);
        expect(accepted.locators?.['input.fab']).toEqual(['#repaired-fab']);
        if (id === 'chatgpt') {
          expect(accepted.selectors.sidebar).toBe('#repaired-sidebar');
        }
      }
    }
  });

  it.each([
    ['gemini', 'gemini.google.com'],
    ['gemini', 'business.gemini.google'],
    ['aistudio', 'aistudio.google.com'],
    ['aistudio', 'aistudio.google.cn'],
    ['chatgpt', 'chatgpt.com'],
    ['chatgpt', 'chat.openai.com'],
    ['claude', 'claude.ai'],
    ['deepseek', 'chat.deepseek.com'],
    ['kimi', 'www.kimi.com'],
  ])('%s on %s cannot acquire or lose packaged facts from a newer catalog', (id, host) => {
    const bundle = requireBundledSiteAdapter(id);
    for (const fields of [
      {
        routeWords: ['private_id'],
        accountSlots: !bundle.accountSlots,
        conversationRoutes: ['/wrong/:id'],
        prompt: {
          slash: !bundle.prompt?.slash,
          expandCollapsedComposer: !bundle.prompt?.expandCollapsedComposer,
          triggerSpot: 'fab',
          scheme: 'page',
          highlightScope: 'aistudio',
        },
      } satisfies Partial<SiteAdapter>,
      {
        routeWords: undefined,
        accountSlots: undefined,
        conversationRoutes: undefined,
        prompt: undefined,
      },
    ]) {
      const remote: SiteAdapter = {
        ...bundle,
        ...fields,
        catalogRevision: (bundle.catalogRevision ?? 0) + 1,
      };
      for (const accepted of [
        protectSiteAdapterIdentity(bundle, remote),
        cached(host, siteAdapterToData(remote)),
        resolveSiteAdapterForUrl(`https://${host}/`, SiteRegistry.createDefault(), remote),
      ]) {
        expect(accepted).not.toBeNull();
        if (!accepted) throw new Error('Expected a usable catalog adapter');
        // These values are a packaged data invariant, including absence on catalog sites.
        expect({
          routeWords: accepted.routeWords,
          accountSlots: accepted.accountSlots,
          conversationRoutes: accepted.conversationRoutes,
          prompt: accepted.prompt,
        }).toEqual({
          routeWords: bundle.routeWords,
          accountSlots: bundle.accountSlots,
          conversationRoutes: bundle.conversationRoutes,
          prompt: bundle.prompt,
        });
      }
    }
  });
});
