import {
  HISTORY_TEST_TIME,
  type HistoryPayloadFixture,
  historyEnvelope,
} from './strictHistoryPayloads';

const accountHash = 'historyacct';

function star(id: string, catalog = false) {
  return {
    conversationId: catalog ? 'kimi:conv:12345678-1234-1234-1234-123456789abc' : 'conversation',
    turnId: `turn-${id}`,
    content: `${id} preview`,
    text: `${id} complete text`,
    conversationUrl: catalog
      ? 'https://www.kimi.com/chat/12345678-1234-1234-1234-123456789abc'
      : 'https://gemini.google.com/u/0/app/123456789abc',
    conversationTitle: id,
    starredAt: 1,
    // Legacy stars deliberately preserve opaque metadata from older exports.
    legacyMetadata: { source: id },
  };
}

export function strictLegacyStarredPayload(id: string) {
  return historyEnvelope('gemini-voyager.starred.v1', {
    messages: { conversation: [star(id)] },
  });
}

export function corruptLegacyStarredPayload(id: string) {
  return {
    ...historyEnvelope('gemini-voyager.starred.v1', {
      messages: { c: 'corrupt-bucket' },
    }),
    exportedAt: id === 'newer-one' ? '2026-10-29T11:59:01.000Z' : HISTORY_TEST_TIME,
  };
}

function starsPayload(id: string, catalog = false) {
  return {
    format: 'gemini-voyager.stars.v2',
    exportedAt: HISTORY_TEST_TIME,
    version: '2.2.1',
    ...(catalog ? {} : { accountScope: { accountHash } }),
    items: [star(id, catalog)],
    tombstones: [
      {
        conversationId: catalog ? 'kimi:conv:deleted' : 'deleted-conversation',
        turnId: 'deleted-turn',
        conversationUrl: catalog
          ? 'https://www.kimi.com/chat/12345678-1234-1234-1234-123456789abc'
          : 'https://gemini.google.com/u/0/app/123456789abc',
        starredAt: Date.parse(HISTORY_TEST_TIME) - 2000,
        deletedAt: Date.parse(HISTORY_TEST_TIME) - 1000,
      },
    ],
  };
}

function duplicateStarsPayload(id: string, catalog = false) {
  const payload = starsPayload(id, catalog);
  return {
    ...payload,
    items: [...payload.items, { ...payload.items[0], content: `${id} conflicting record` }],
  };
}

function highlightPayload(id: string) {
  return {
    format: 'gemini-voyager.annotations.v1',
    exportedAt: HISTORY_TEST_TIME,
    version: '2.2.1',
    accountScope: { platform: 'gemini', accountHash },
    items: [
      {
        id: `highlight-${id}`,
        schemaVersion: 1,
        platform: 'gemini',
        accountHash,
        conversationId: 'highlight-conversation',
        conversationUrl: 'https://gemini.google.com/u/0/app/123456789abc',
        conversationTitle: id,
        turnId: `turn-${id}`,
        role: 'assistant',
        anchor: {
          quote: { exact: `${id} exact quotation`, prefix: 'before ', suffix: ' after' },
          position: { start: 10, end: 30 },
          sourceTextHash: `source-${id}`,
        },
        note: `${id} note`,
        color: 'yellow',
        createdAt: 1,
        updatedAt: 2,
        revision: { counter: 1, deviceId: 'history-test-device' },
      },
    ],
  };
}

function duplicateHighlightPayload(id: string) {
  const payload = highlightPayload(id);
  return {
    ...payload,
    items: [...payload.items, { ...payload.items[0], note: `${id} conflicting note` }],
  };
}

function inheritedHighlightPayload(id: string, recordId: string) {
  const payload = highlightPayload(id);
  return { ...payload, items: [{ ...payload.items[0], id: recordId }] };
}

function catalogTimelinePayload(id: string) {
  return {
    ...historyEnvelope('gemini-voyager.catalog-timeline-hierarchy.v1', {
      'gvCatalogTimelineHierarchy:chatgpt': {
        conversations: {
          [id]: {
            conversationUrl: 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc',
            levels: { [`turn-${id}`]: 1 },
            collapsed: [`turn-${id}`],
            updatedAt: 1,
          },
        },
        deleted: { 'deleted-conversation': Date.parse(HISTORY_TEST_TIME) - 1000 },
      },
    }),
    site: 'chatgpt',
  };
}

function corruptCatalogTimelinePayload(id: string) {
  const payload = catalogTimelinePayload(id);
  const bucket = payload.data['gvCatalogTimelineHierarchy:chatgpt'];
  return {
    ...payload,
    data: {
      'gvCatalogTimelineHierarchy:chatgpt': {
        ...bucket,
        conversations: {
          [id]: { ...bucket.conversations[id], levels: { [`turn-${id}`]: 1, lost: 7 } },
        },
      },
    },
  };
}

export const strictExtraHistoryFixtures = [
  {
    label: 'legacy v1 starred with a corrupt bucket',
    source: 'gemini-voyager-starred.json',
    valid: strictLegacyStarredPayload,
    corrupt: corruptLegacyStarredPayload,
  },
  {
    label: 'v2 stars with conflicting item identities',
    source: `gemini-voyager-stars.acct-${accountHash}.json`,
    valid: (id) => starsPayload(id),
    corrupt: (id) => duplicateStarsPayload(id),
  },
  {
    label: 'catalog v2 stars with conflicting item identities',
    source: 'gemini-voyager-stars.site-kimi.json',
    valid: (id) => starsPayload(id, true),
    corrupt: (id) => duplicateStarsPayload(id, true),
  },
  {
    label: 'highlights with conflicting ids in one conversation',
    source: `gemini-voyager-highlights.acct-${accountHash}.json`,
    valid: highlightPayload,
    corrupt: duplicateHighlightPayload,
  },
  ...['__proto__', 'constructor', 'toString'].map((recordId) => ({
    label: `highlights with inherited ${recordId} id`,
    source: `gemini-voyager-highlights.acct-${accountHash}.json`,
    valid: highlightPayload,
    corrupt: (id: string) => inheritedHighlightPayload(id, recordId),
  })),
  {
    label: 'catalog timeline hierarchy with a dropped level',
    source: 'gemini-voyager-timeline-hierarchy.site-chatgpt.json',
    valid: catalogTimelinePayload,
    corrupt: corruptCatalogTimelinePayload,
  },
] satisfies HistoryPayloadFixture[];
