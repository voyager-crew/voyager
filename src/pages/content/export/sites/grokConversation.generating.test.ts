import type { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import grokData from '@/features/plugins/catalog/sites/grok/site.json';
import { validateSiteAdapterData } from '@/features/plugins/sites/siteAdapterData';
import type { SiteAdapter } from '@/features/plugins/types';

import { buildCatalogExportAdapter } from '../adapter/platform/catalog';
import { readCatalogOrGrokConversation } from './grokConversation';

declare const jsdom: JSDOM;

const ORIGINAL_URL = location.href;
const CONV = '01234567-89ab-cdef-0123-456789abcdef';
const USER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const KEPT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function grokSite(): SiteAdapter {
  const validated = validateSiteAdapterData(grokData);
  if (!validated.success) throw new Error(JSON.stringify(validated.error));
  return validated.data;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.useRealTimers();
  jsdom.reconfigure({ url: ORIGINAL_URL });
  document.body.replaceChildren();
});

describe('Grok generating selector', () => {
  it('stops a page read while the composer stop control is present', async () => {
    vi.useFakeTimers();
    jsdom.reconfigure({ url: `https://grok.com/c/${CONV}` });
    document.body.innerHTML =
      '<div data-testid="chat-transcript-scroller">' +
      `<div data-plane-row="gateway:${USER}"><div data-testid="user-message">Page prompt</div></div>` +
      `<div data-plane-row="gateway:${KEPT}"><div data-testid="assistant-message"><p>Page answer</p></div></div>` +
      '</div>' +
      '<button type="button" aria-label="Stop" data-testid="composer-stop" data-icon-button></button>' +
      '<button type="submit" aria-label="Send" data-composer-action="send" data-testid="chat-submit"></button>';
    const scroller = document.querySelector<HTMLElement>(
      '[data-testid="chat-transcript-scroller"]',
    )!;
    let top = 40;
    Object.defineProperties(scroller, {
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value: number) => {
          top = value;
        },
      },
      scrollHeight: { configurable: true, get: () => 2000 },
      clientHeight: { configurable: true, get: () => 800 },
    });
    const site = grokSite();
    const pending = readCatalogOrGrokConversation(
      site,
      buildCatalogExportAdapter(site),
      { expectedUrl: location.href },
      { fetch: async () => jsonResponse('no', 500) },
    );
    await vi.advanceTimersByTimeAsync(150_000);
    const result = await pending;
    expect(result.completeness).toBe('partial');
    expect(result.reason).toBe('generating');
    expect(result.snapshots).toEqual([]);
    expect(scroller.scrollTop).toBe(40);
  });
});
