/** Builders shared by the Grok conversation reader tests. */
import type { JSDOM } from 'jsdom';

import grokData from '@/features/plugins/catalog/sites/grok/site.json';
import { validateSiteAdapterData } from '@/features/plugins/sites/siteAdapterData';
import type { SiteAdapter } from '@/features/plugins/types';

import { buildCatalogExportAdapter } from '../adapter/platform/catalog';
import type { ExportSelectionOptions } from '../adapter/type';
import type { CatalogReadResult, CatalogSnapshot } from './catalogReader';
import { type GrokReadDeps, readCatalogOrGrokConversation } from './grokConversation';

declare const jsdom: JSDOM;

export const ORIGINAL_URL = location.href;
export const CONV = '01234567-89ab-cdef-0123-456789abcdef';
export const USER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
export const KEPT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
export const DROPPED = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
export const CONTROL = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

export function grokSite(): SiteAdapter {
  const validated = validateSiteAdapterData(grokData);
  if (!validated.success) throw new Error(JSON.stringify(validated.error));
  return validated.data;
}

export function node(id: string, parent?: string): Record<string, unknown> {
  return parent ? { responseId: id, parentResponseId: parent } : { responseId: id };
}

export function response(
  id: string,
  sender: string,
  message: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { responseId: id, sender, message, ...extra };
}

export function branched() {
  return {
    nodes: { responseNodes: [node(USER), node(KEPT, USER), node(DROPPED, USER)] },
    responses: [
      response(USER, 'human', 'Prompt', { createTime: '2026-01-01T00:00:00.000Z' }),
      response(KEPT, 'assistant', 'First answer', {
        parentResponseId: USER,
        createTime: '2026-01-01T00:00:01.000Z',
      }),
      response(DROPPED, 'ASSISTANT', 'Regenerated', {
        parentResponseId: USER,
        createTime: '2026-01-01T00:00:02.000Z',
      }),
    ],
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function endpointFetch(
  nodes: unknown,
  responses: readonly Record<string, unknown>[],
): typeof fetch {
  const byId = new Map(responses.map((entry) => [entry.responseId, entry]));
  return async (input, init) => {
    const url = String(input);
    if (url.includes('/response-node')) return jsonResponse(nodes);
    const requested = JSON.parse(String(init?.body)) as { responseIds?: string[] };
    const page = (requested.responseIds ?? []).flatMap((id) => {
      const entry = byId.get(id);
      return entry ? [entry] : [];
    });
    return jsonResponse({ responses: page });
  };
}

export function domResult(text: string): CatalogReadResult {
  const element = document.createElement('div');
  element.textContent = text;
  const snapshot: CatalogSnapshot = {
    id: 'dom-1',
    role: 'user',
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
    element,
    host: new WeakRef(element),
    fingerprint: 'dom',
  };
  return { snapshots: [snapshot], completeness: 'unknown' };
}

export function openConversation(rid?: string): void {
  jsdom.reconfigure({ url: `https://grok.com/c/${CONV}${rid ? `?rid=${rid}` : ''}` });
}

export function readOptions(): ExportSelectionOptions {
  return { expectedUrl: location.href };
}

export async function readGrok(
  fetchImpl: typeof fetch,
  deps: GrokReadDeps = {},
): Promise<CatalogReadResult> {
  return readCatalogOrGrokConversation(
    grokSite(),
    buildCatalogExportAdapter(grokSite()),
    readOptions(),
    { fetch: fetchImpl, ...deps },
  );
}
