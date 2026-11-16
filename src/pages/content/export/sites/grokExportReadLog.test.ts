import type { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { logger } from '@/core/services/LoggerService';
import grokData from '@/features/plugins/catalog/sites/grok/site.json';
import { validateSiteAdapterData } from '@/features/plugins/sites/siteAdapterData';
import type { SiteAdapter } from '@/features/plugins/types';

import { buildCatalogExportAdapter } from '../adapter/platform/catalog';
import type { CatalogReadResult } from './catalogReader';
import { readCatalogOrGrokConversation } from './grokConversation';

declare const jsdom: JSDOM;

const USER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORIGINAL_URL = location.href;

function grokSite(): SiteAdapter {
  const validated = validateSiteAdapterData(grokData);
  if (!validated.success) throw new Error('grok site');
  return validated.data;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function page(count: number): CatalogReadResult {
  const snapshots = Array.from({ length: count }, (_, index) => {
    const text = `turn ${index}`;
    return {
      id: `dom-${index}`,
      role: 'assistant' as const,
      content: {
        text,
        html: '',
        attachments: [],
        hasImages: false,
        hasFormulas: false,
        hasTables: false,
        hasCode: false,
      },
      text,
      element: document.createElement('div'),
      host: new WeakRef(document.createElement('div')),
      fingerprint: `dom-${index}`,
    };
  });
  return { snapshots, completeness: 'unknown' };
}

afterEach(() => {
  jsdom.reconfigure({ url: ORIGINAL_URL });
  vi.restoreAllMocks();
});

describe('Grok export read log', () => {
  it('names the endpoint and the message count in a dev build', async () => {
    jsdom.reconfigure({ url: `https://grok.com/c/01234567-89ab-cdef-0123-456789abcdef` });
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/response-node')) return json({ responseNodes: [{ responseId: USER }] });
      const requested = JSON.parse(String(init?.body)) as { responseIds?: string[] };
      return json({
        responses: (requested.responseIds ?? []).map((id) => ({
          responseId: id,
          sender: 'human',
          message: 'Hi',
        })),
      });
    };
    await readCatalogOrGrokConversation(
      grokSite(),
      buildCatalogExportAdapter(grokSite()),
      { expectedUrl: location.href },
      { fetch: fetchImpl },
    );
    expect(info).toHaveBeenCalledWith('Grok export read via endpoint', {
      source: 'endpoint',
      count: 1,
    });
  });

  it('names the virtual DOM fallback and stays quiet for another site or a cancel', async () => {
    jsdom.reconfigure({ url: `https://grok.com/c/01234567-89ab-cdef-0123-456789abcdef` });
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const site = grokSite();
    await readCatalogOrGrokConversation(
      site,
      buildCatalogExportAdapter(site),
      { expectedUrl: location.href },
      {
        fetch: async () => json('no', 500),
        readDom: async () => page(2),
      },
    );
    expect(info).toHaveBeenCalledWith('Grok export read via virtual DOM', {
      source: 'virtual-dom',
      count: 2,
    });

    info.mockClear();
    await readCatalogOrGrokConversation(
      { ...site, id: 'kimi' },
      buildCatalogExportAdapter(site),
      {},
      { readDom: async () => page(4) },
    );
    expect(info).not.toHaveBeenCalled();

    const controller = new AbortController();
    controller.abort();
    await expect(
      readCatalogOrGrokConversation(
        site,
        buildCatalogExportAdapter(site),
        { expectedUrl: location.href, signal: controller.signal },
        { fetch: async () => json({ responseNodes: [] }) },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(info).not.toHaveBeenCalled();
  });
});
