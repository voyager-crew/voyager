import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildCatalogExportAdapter } from '../adapter/platform/catalog';
import { createCatalogExportSite } from './catalogSite';
import { grokConversationId, grokDisplayedLeafId, selectGrokBranch } from './grokBranch';
import { readCatalogOrGrokConversation } from './grokConversation';
import {
  CONTROL,
  CONV,
  DROPPED,
  KEPT,
  ORIGINAL_URL,
  USER,
  branched,
  domResult,
  endpointFetch,
  grokSite,
  jsonResponse,
  node,
  openConversation,
  readGrok,
  readOptions,
  response,
} from './grokConversation.fixtures';

declare const jsdom: import('jsdom').JSDOM;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function headerRecord(init: RequestInit | undefined): Record<string, string> {
  const headers = init?.headers;
  if (!headers || headers instanceof Headers || Array.isArray(headers)) {
    throw new Error('expected a header record');
  }
  return headers;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  jsdom.reconfigure({ url: ORIGINAL_URL });
  document.body.replaceChildren();
});

describe('Grok conversation parsing', () => {
  const site = grokSite();

  it('reads the conversation id from /c/<uuid> and the displayed leaf from rid', () => {
    const pattern = site.conversationIdPattern ?? '';
    expect(grokConversationId(`https://grok.com/c/${CONV}`, pattern)).toBe(CONV);
    expect(grokConversationId(`https://grok.com/c/${CONV}/`, pattern)).toBe(CONV);
    expect(grokConversationId('https://grok.com/c/not-a-uuid', pattern)).toBeNull();
    expect(grokConversationId('https://grok.com/c/../../etc/passwd', '(.*)')).toBeNull();
    expect(grokDisplayedLeafId(`https://grok.com/c/${CONV}?rid=${KEPT}`)).toBe(KEPT);
    expect(grokDisplayedLeafId(`https://grok.com/c/${CONV}?rid=latest`)).toBeNull();
    expect(grokDisplayedLeafId(`https://grok.com/c/${CONV}`)).toBeNull();
  });

  it('keeps the displayed branch and otherwise the newest leaf', () => {
    const { nodes, responses } = branched();
    expect(
      selectGrokBranch(nodes, responses, KEPT)?.messages.map((message) => message.text),
    ).toEqual(['Prompt', 'First answer']);
    const newest = selectGrokBranch(nodes, responses, null);
    expect(newest?.messages.map((message) => message.text)).toEqual(['Prompt', 'Regenerated']);
    expect(newest?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(newest?.partial).toBe(false);
    expect(
      selectGrokBranch(nodes, responses, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')?.messages.at(-1)
        ?.id,
    ).toBe(DROPPED);
  });

  it('uses a parent link from either payload and skips control, system and citation markup', () => {
    const nodes = {
      responseNodes: [node(USER), node(CONTROL, USER), node(KEPT, CONTROL)],
    };
    const responses = [
      response(USER, 'human', '', { query: 'From query', parentResponseId: null }),
      response(CONTROL, 'assistant', 'tool card', { isControl: true, parentResponseId: USER }),
      response(
        KEPT,
        'assistant',
        'Hello  <grok:render card_id="05a0cb" card_type="citation_card"><argument name="citation_id">48</argument></grok:render> world',
        { parentResponseId: CONTROL, partial: true },
      ),
    ];
    // The node list has the parents. Drop them from the bodies and the chain still holds.
    const withoutBodyParents = responses.map((entry) => {
      const { parentResponseId: _parent, ...rest } = entry;
      return rest;
    });
    expect(selectGrokBranch(nodes, withoutBodyParents, KEPT)).toEqual({
      messages: [
        { id: USER, role: 'user', text: 'From query' },
        { id: KEPT, role: 'assistant', text: 'Hello world' },
      ],
      partial: true,
    });

    const nodesWithoutParents = { responseNodes: [node(USER), node(CONTROL), node(KEPT)] };
    expect(
      selectGrokBranch(nodesWithoutParents, responses, null)?.messages.map(
        (message) => message.text,
      ),
    ).toEqual(['From query', 'Hello world']);
  });

  it('rejects a cyclic tree, a missing body and a payload that is not the node list', () => {
    expect(
      selectGrokBranch(
        { responseNodes: [node(USER, KEPT), node(KEPT, USER)] },
        [
          response(USER, 'human', 'Prompt', { parentResponseId: KEPT }),
          response(KEPT, 'assistant', 'Answer', { parentResponseId: USER }),
        ],
        null,
      ),
    ).toBeNull();
    expect(
      selectGrokBranch(
        { responseNodes: [node(USER), node(KEPT, USER)] },
        [response(KEPT, 'assistant', 'Answer', { parentResponseId: USER })],
        KEPT,
      ),
    ).toBeNull();
    expect(selectGrokBranch({ responseNodes: 'nope' }, [], null)).toBeNull();
    expect(selectGrokBranch({ ok: true }, [], null)).toBeNull();
    expect(selectGrokBranch({ responseNodes: [] }, [], null)).toBeNull();
  });
});

describe('Grok conversation read', () => {
  it('requests the open conversation and ignores the other branch', async () => {
    openConversation(KEPT);
    const { nodes, responses } = branched();
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return endpointFetch(nodes, responses)(input, init);
    };
    const readDom = vi.fn(async () => domResult('from the page'));
    const result = await readGrok(fetchImpl, { readDom });

    expect(result.snapshots.map((snapshot) => snapshot.text)).toEqual(['Prompt', 'First answer']);
    expect(result.snapshots.map((snapshot) => snapshot.nativeId)).toEqual([
      `data-plane-row:gateway:${USER}`,
      `data-plane-row:gateway:${KEPT}`,
    ]);
    expect(result.completeness).toBe('complete');
    expect(readDom).not.toHaveBeenCalled();
    expect(calls.map((call) => call.url)).toEqual([
      `/rest/app-chat/conversations/${CONV}/response-node?includeThreads=true`,
      `/rest/app-chat/conversations/${CONV}/load-responses`,
    ]);
    expect(calls[0]?.init).toMatchObject({
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
    expect(calls[1]?.init).toMatchObject({
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
    });
    const getHeaders = headerRecord(calls[0]?.init);
    const postHeaders = headerRecord(calls[1]?.init);
    expect(Object.keys(getHeaders).sort()).toEqual(['Accept', 'x-xai-request-id']);
    expect(Object.keys(postHeaders).sort()).toEqual(['Accept', 'Content-Type', 'x-xai-request-id']);
    expect(getHeaders['x-xai-request-id']).toMatch(UUID);
    expect(postHeaders['x-xai-request-id']).toMatch(UUID);
    expect(getHeaders['x-xai-request-id']).not.toBe(postHeaders['x-xai-request-id']);
    expect(postHeaders['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      responseIds: [USER, KEPT, DROPPED],
    });
  });

  it('marks a partial reply unknown and still exports it', async () => {
    openConversation(KEPT);
    const fetchImpl = endpointFetch({ responseNodes: [node(USER), node(KEPT, USER)] }, [
      response(USER, 'human', 'Prompt'),
      response(KEPT, 'assistant', 'Still writing', { parentResponseId: USER, partial: true }),
    ]);
    const result = await readGrok(fetchImpl, { readDom: vi.fn(async () => domResult('page')) });
    expect(result.snapshots.map((snapshot) => snapshot.text)).toEqual(['Prompt', 'Still writing']);
    expect(result.completeness).toBe('unknown');
  });

  it('posts load-responses in batches of 50 ids', async () => {
    openConversation();
    const ids = Array.from(
      { length: 51 },
      (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    );
    const nodes = {
      responseNodes: ids.map((id, index) => (index === 0 ? node(id) : node(id, ids[index - 1]))),
    };
    const responses = ids.map((id, index) =>
      response(id, index % 2 === 0 ? 'human' : 'assistant', `Message ${index}`, {
        ...(index === 0 ? {} : { parentResponseId: ids[index - 1] }),
        createTime: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      }),
    );
    const batches: string[][] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      if (String(input).includes('/response-node')) return jsonResponse(nodes);
      const body = JSON.parse(String(init?.body)) as { responseIds: string[] };
      batches.push(body.responseIds);
      return jsonResponse({
        responses: body.responseIds.map((id) => responses[ids.indexOf(id)]),
      });
    };
    const result = await readGrok(fetchImpl, {
      readDom: vi.fn(async () => domResult('fell back')),
    });
    expect(batches.map((batch) => batch.length)).toEqual([50, 1]);
    expect(result.snapshots).toHaveLength(51);
    expect(result.snapshots[0]?.text).toBe('Message 0');
    expect(result.snapshots[50]?.text).toBe('Message 50');
  });

  it('falls back to the page when the endpoint fails, is the wrong shape, or does not finish', async () => {
    openConversation();
    const readDom = vi.fn(async () => domResult('from the page'));
    const cases: Array<{ name: string; fetch: typeof fetch }> = [
      {
        name: 'http',
        fetch: async () => jsonResponse('no', 500),
      },
      {
        name: 'shape',
        fetch: async (input) =>
          String(input).includes('/response-node')
            ? jsonResponse({ ok: true })
            : jsonResponse({ responses: [] }),
      },
      {
        name: 'truncated',
        fetch: async (input) =>
          String(input).includes('/response-node')
            ? jsonResponse({ responseNodes: [node(USER)] })
            : jsonResponse({ responses: [response(USER, 'human', 'Prompt')], hasMore: true }),
      },
    ];
    for (const item of cases) {
      readDom.mockClear();
      const result = await readGrok(item.fetch, { readDom });
      expect(
        result.snapshots.map((snapshot) => snapshot.text),
        item.name,
      ).toEqual(['from the page']);
      expect(readDom, item.name).toHaveBeenCalledOnce();
    }
  });

  it('stops paging a cursor that never ends and then reads the page', async () => {
    openConversation();
    let posts = 0;
    const fetchImpl: typeof fetch = async (input) => {
      if (String(input).includes('/response-node')) {
        return jsonResponse({ responseNodes: [node(USER)] });
      }
      posts += 1;
      if (posts > 20) throw new Error('paged without a cap');
      return jsonResponse({
        responses: [
          response(`10000000-0000-4000-8000-${String(posts).padStart(12, '0')}`, 'human', 'x'),
        ],
        hasMore: true,
        nextCursor: `page-${posts}`,
      });
    };
    const readDom = vi.fn(async () => domResult('from the page'));
    const result = await readGrok(fetchImpl, { readDom });
    expect(posts).toBe(8);
    expect(result.snapshots.map((snapshot) => snapshot.text)).toEqual(['from the page']);
  });

  it('reads the mounted transcript when the endpoint answers 500', async () => {
    vi.useFakeTimers();
    openConversation();
    document.body.innerHTML =
      '<div data-testid="chat-transcript-scroller">' +
      `<div data-plane-row="gateway:${USER}"><div data-testid="user-message">Page prompt</div></div>` +
      `<div data-plane-row="gateway:${KEPT}"><div data-testid="assistant-message"><p>Page answer</p></div></div>` +
      '</div>';
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
    const pending = readGrok(async () => jsonResponse('no', 500));
    await vi.advanceTimersByTimeAsync(150_000);
    const result = await pending;
    expect(
      result.snapshots.map((snapshot) => [snapshot.role, snapshot.text, snapshot.nativeId]),
    ).toEqual([
      ['user', 'Page prompt', `data-plane-row:gateway:${USER}`],
      ['assistant', 'Page answer', `data-plane-row:gateway:${KEPT}`],
    ]);
    // The stop control is absent, so a finished crawl can report itself complete.
    expect(result.completeness).toBe('complete');
    expect(scroller.scrollTop).toBe(40);
  });

  it('falls back when the endpoint does not answer in time', async () => {
    vi.useFakeTimers();
    openConversation();
    const readDom = vi.fn(async () => domResult('from the page'));
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    const pending = readGrok(fetchImpl, { readDom, timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(30);
    await expect(pending).resolves.toMatchObject({
      snapshots: [expect.objectContaining({ text: 'from the page' })],
    });
    expect(readDom).toHaveBeenCalledOnce();
  });

  it('does not read the page when export is cancelled', async () => {
    openConversation();
    const controller = new AbortController();
    const readDom = vi.fn(async () => domResult('from the page'));
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    const pending = readCatalogOrGrokConversation(
      grokSite(),
      buildCatalogExportAdapter(grokSite()),
      { signal: controller.signal, expectedUrl: location.href },
      { fetch: fetchImpl, readDom },
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(readDom).not.toHaveBeenCalled();
  });

  it('does not call the endpoint off a grok conversation or after the route changes', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ ok: true }));
    const readDom = vi.fn(async () => domResult('from the page'));
    const site = grokSite();
    const adapter = buildCatalogExportAdapter(site);

    jsdom.reconfigure({ url: `https://evil.example/c/${CONV}` });
    await readCatalogOrGrokConversation(site, adapter, readOptions(), {
      fetch: fetchImpl,
      readDom,
    });
    jsdom.reconfigure({ url: `https://www.grok.com/c/${CONV}` });
    await readCatalogOrGrokConversation(site, adapter, readOptions(), {
      fetch: fetchImpl,
      readDom,
    });
    openConversation(KEPT);
    await readCatalogOrGrokConversation({ ...site, id: 'kimi' }, adapter, readOptions(), {
      fetch: fetchImpl,
      readDom,
    });
    await readCatalogOrGrokConversation(
      site,
      adapter,
      { expectedUrl: `https://grok.com/c/${CONV}?rid=${DROPPED}` },
      { fetch: fetchImpl, readDom },
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readDom).toHaveBeenCalledTimes(4);
  });

  it('uses the endpoint from the catalog export site', async () => {
    openConversation(KEPT);
    const { nodes, responses } = branched();
    vi.stubGlobal('fetch', endpointFetch(nodes, responses));
    document.body.innerHTML =
      '<div data-testid="chat-transcript-scroller"><div data-testid="user-message">Page prompt</div></div>';
    const site = createCatalogExportSite(grokSite());
    const session = await site.turns.prepare?.({ expectedUrl: location.href });
    try {
      expect(session?.completeness).toBe('complete');
      expect(session?.messages().map((message) => message.text)).toEqual([
        'Prompt',
        'First answer',
      ]);
      expect(document.body.textContent).toContain('Page prompt');
    } finally {
      session?.release();
    }
  });
});
