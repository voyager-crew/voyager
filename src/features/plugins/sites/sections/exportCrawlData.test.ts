import { describe, expect, it } from 'vitest';

import chatgpt from '../../catalog/sites/chatgpt/site.json';
import { validateHostCatalogFile } from '../../remote/hostCatalogFile';
import { isSameSiteAdapter, resolveSiteAdapterForUrl } from '../../remote/siteOverride';
import { SiteRegistry } from '../registry';
import { readSiteAdapterData, siteAdapterToData } from '../siteAdapterData';

function read(sections: Record<string, unknown>) {
  const { result, sectionIssues } = readSiteAdapterData({ ...chatgpt, ...sections });
  if (!result.success) throw new Error(JSON.stringify(result.error));
  return { adapter: result.data, sectionIssues };
}

describe('ChatGPT export switches in site data', () => {
  it('applies a newer host file’s switches to the ChatGPT page and keeps them through the cache', () => {
    const sections = {
      exportThread: { format: 1, order: ['api'] },
      exportCrawl: { format: 1, extent: 'directChild', upwardScroll: 'plain', pollMs: 80 },
    };
    const file = validateHostCatalogFile(
      {
        format: 1,
        host: 'chatgpt.com',
        plugins: [],
        site: { ...chatgpt, catalogRevision: 10, ...sections },
      },
      'chatgpt.com',
    );
    expect(file?.siteIssues).toEqual([]);
    // The cache stores the published form and reads it back.
    const cached = readSiteAdapterData(JSON.parse(JSON.stringify(siteAdapterToData(file!.site!))));
    if (!cached.result.success) throw new Error('cached site did not read back');

    const page = resolveSiteAdapterForUrl(
      'https://chatgpt.com/c/abc',
      SiteRegistry.createDefault(),
      cached.result.data,
    );

    expect(page?.exportThread).toEqual(sections.exportThread);
    expect(page?.exportCrawl).toEqual(sections.exportCrawl);
    // A switch change remounts the export, as any other site-data change does.
    const bundled = SiteRegistry.createDefault().resolveByUrl('https://chatgpt.com/c/abc');
    expect(isSameSiteAdapter(page, bundled)).toBe(false);
  });

  it.each([
    ['an order outside the allowed three', { format: 1, order: ['api', 'crawl'] }],
    ['an unknown source', { format: 1, order: ['dom'] }],
    ['an unknown format', { format: 2, order: ['api'] }],
    ['a non-object', ['api']],
  ])('reads exportThread with %s as the default order, keeping the adapter', (_label, section) => {
    const { adapter, sectionIssues } = read({ exportThread: section });

    expect(adapter.exportThread).toBeUndefined();
    expect(adapter.selectors).toEqual(read({}).adapter.selectors);
    expect(sectionIssues.some((issue) => issue.path.startsWith('exportThread'))).toBe(true);
  });

  it('drops each bad exportCrawl field alone and ignores unknown keys', () => {
    const { adapter, sectionIssues } = read({
      exportCrawl: {
        format: 1,
        extent: 'firstChild',
        upwardScroll: 'plain',
        direction: 1,
        pollMs: 5,
        settleMs: '150',
        mountTimeoutMs: 1500.5,
        historyIdleMs: 2000,
        historyStallMs: 600_000,
        steps: [{ click: 'button' }],
      },
    });

    expect(adapter.exportCrawl).toEqual({ format: 1, upwardScroll: 'plain', historyIdleMs: 2000 });
    expect(sectionIssues.map((issue) => issue.path).sort()).toEqual(
      [
        'exportCrawl.direction',
        'exportCrawl.extent',
        'exportCrawl.historyStallMs',
        'exportCrawl.mountTimeoutMs',
        'exportCrawl.pollMs',
        'exportCrawl.settleMs',
        'exportCrawl.steps',
      ].sort(),
    );
  });

  it('reads an exportCrawl of an unknown format as absent', () => {
    const { adapter } = read({ exportCrawl: { format: 2, extent: 'directChild' } });

    expect(adapter.exportCrawl).toBeUndefined();
  });
});
