import { vi } from 'vitest';

import { noDriveHistory } from '@/core/services/__tests__/fixtures/noDriveHistory';
import type { HighlightAccountScope, HighlightRecordV1 } from '@/core/types/highlight';
import type { TimelineHierarchyData } from '@/features/timeline/hierarchyTypes';
import type { HighlightManager } from '@/pages/content/highlight/manager';

import {
  type ExtensionFake,
  type GeminiTurn,
  GeminiPage,
  navigateTo,
  settle,
} from './geminiTimelineHarness';

export const CONVERSATION = 'gemini:conv:acceptance';
export const FIRST_ID = 's-aaaaaaaaaaaaaaaa';
export const SECOND_ID = 's-bbbbbbbbbbbbbbbb';
export const TURNS: GeminiTurn[] = [
  { prompt: 'Voyager 测试 chapter', response: 'Alpha target Omega', serverId: 'aaaaaaaaaaaaaaaa' },
  { prompt: 'Voyager 测试 detail', response: 'Beta other Sigma', serverId: 'bbbbbbbbbbbbbbbb' },
  { prompt: 'Voyager 测试 next chapter', response: 'A conclusion.', serverId: 'cccccccccccccccc' },
];
export const OTHER_TURNS: GeminiTurn[] = [
  { prompt: 'Voyager 测试 other chat', response: 'Other answer.', serverId: 'dddddddddddddddd' },
];

// Values already written by released builds for route:1 and route:2. Keep these fixtures literal:
// the round trip must not silently move a user into a new namespace or rewrite an old record.
export const ACCOUNTS = [
  {
    scope: { platform: 'gemini', accountKey: 'route:1', accountId: 1, routeUserId: '1' },
    hash: '5d750n',
    emailHash: 'voyager-test-1',
    cloudHash: '1c662rp',
    hierarchyKey: 'geminiTimelineHierarchy:acct:5d750n',
    highlightKey: 'gvAnnotation:bucket:v1:acct:5d750n:conv:1hfiwfm',
    indexKey: 'gvAnnotation:index:v1:acct:5d750n',
    level: 2,
    quote: 'target',
  },
  {
    scope: { platform: 'gemini', accountKey: 'route:2', accountId: 2, routeUserId: '2' },
    hash: '5n6qpm',
    emailHash: 'voyager-test-2',
    cloudHash: '1bc79os',
    hierarchyKey: 'geminiTimelineHierarchy:acct:5n6qpm',
    highlightKey: 'gvAnnotation:bucket:v1:acct:5n6qpm:conv:1hfiwfm',
    indexKey: 'gvAnnotation:index:v1:acct:5n6qpm',
    level: 3,
    quote: 'other',
  },
] as const satisfies readonly {
  scope: HighlightAccountScope;
  hash: string;
  /** Released builds bind each route-first account to the email they observed. */
  emailHash: string;
  /** Drive names and cloud payloads derive from the email identity, not the local bucket. */
  cloudHash: string;
  hierarchyKey: string;
  highlightKey: string;
  indexKey: string;
  level: 2 | 3;
  quote: string;
}[];

export const pageUrl = (slot: string, conversation = 'acceptance') =>
  `https://gemini.google.com/u/${slot}/app/${conversation}`;

export function seedAccountData(ext: ExtensionFake): void {
  ext.seed('local', {
    gvAccountProfileMap: {
      version: 1,
      nextId: 3,
      profiles: Object.fromEntries(
        ACCOUNTS.map(({ scope, emailHash }) => [
          scope.accountKey,
          {
            id: scope.accountId,
            createdAt: 1,
            updatedAt: 1,
            routeUserId: scope.routeUserId,
            emailHash,
          },
        ]),
      ),
      routeAliases: Object.fromEntries(
        ACCOUNTS.map(({ scope }) => [scope.routeUserId, scope.accountKey]),
      ),
      emailAliases: Object.fromEntries(
        ACCOUNTS.map(({ scope, emailHash }) => [emailHash, scope.accountKey]),
      ),
    },
  });
  for (const account of ACCOUNTS) {
    const record: HighlightRecordV1 = {
      id: `old-highlight-${account.scope.routeUserId}`,
      schemaVersion: 1,
      platform: 'gemini',
      accountHash: account.hash,
      conversationId: CONVERSATION,
      conversationUrl: pageUrl(account.scope.routeUserId),
      conversationTitle: 'Voyager 测试',
      turnId: account.quote === 'target' ? FIRST_ID : SECOND_ID,
      role: 'assistant',
      anchor: {
        quote: {
          exact: account.quote,
          prefix: account.quote === 'target' ? 'Alpha ' : 'Beta ',
          suffix: account.quote === 'target' ? ' Omega' : ' Sigma',
        },
        position: account.quote === 'target' ? { start: 6, end: 12 } : { start: 5, end: 10 },
        sourceTextHash: account.quote === 'target' ? 'fnv1a:14mb58v' : 'fnv1a:v3yk6a',
      },
      color: account.quote === 'target' ? 'yellow' : 'blue',
      createdAt: 11,
      updatedAt: 12,
      revision: { counter: 3, deviceId: 'released-device' },
    };
    ext.seed('local', {
      [account.hierarchyKey]: {
        conversations: {
          [CONVERSATION]: {
            conversationUrl: pageUrl(account.scope.routeUserId),
            levels: { [SECOND_ID]: account.level },
            collapsed: [],
            updatedAt: 7,
          },
        },
      } satisfies TimelineHierarchyData,
      [account.highlightKey]: {
        schemaVersion: 1,
        platform: 'gemini',
        accountHash: account.hash,
        conversationId: CONVERSATION,
        records: { [record.id]: record },
        updatedAt: 12,
      },
      [account.indexKey]: {
        schemaVersion: 1,
        accountHash: account.hash,
        conversations: {
          '1hfiwfm': {
            platform: 'gemini',
            conversationId: CONVERSATION,
            conversationKey: '1hfiwfm',
            bucketKey: account.highlightKey,
            activeCount: 1,
            totalCount: 1,
            updatedAt: 12,
          },
        },
        updatedAt: 12,
      },
    });
  }
}

export function storedDataBytes(ext: ExtensionFake): string {
  const entries = Array.from(ext.values.local.entries()).filter(
    ([key]) =>
      key.startsWith('geminiTimelineHierarchy') ||
      key.startsWith('gvAnnotation:') ||
      key.startsWith('gvCatalogTimelineHierarchy:'),
  );
  entries.sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify({
    local: entries,
    legacyLevels: localStorage.getItem(`geminiTimelineLevels:${CONVERSATION}`),
    legacyCollapsed: localStorage.getItem(`geminiTimelineCollapsed:${CONVERSATION}`),
  });
}

/** Only extension messaging is replaced; the client, background handler and storage service run. */
export async function startHighlights(): Promise<{
  manager: HighlightManager;
  ready: Promise<void>;
  restoreTransport(): void;
}> {
  const { handleHighlightRuntimeMessage } = await import('@/pages/background/highlightMessages');
  const { HighlightManager } = await import('@/pages/content/highlight/manager');
  const original = chrome.runtime.sendMessage.bind(chrome.runtime);
  const transport = vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(((
    message: unknown,
    callback?: (response: unknown) => void,
  ) => {
    const result = handleHighlightRuntimeMessage(message, {
      id: chrome.runtime.id,
      url: location.href,
    });
    if (!result) return callback ? original(message, callback) : original(message);
    return result.then((response) => {
      callback?.(response);
      return response;
    });
  }) as typeof chrome.runtime.sendMessage);
  const manager = new HighlightManager();
  return { manager, ready: manager.init(), restoreTransport: () => transport.mockRestore() };
}

export async function visit(
  page: GeminiPage,
  path: string,
  turns: GeminiTurn[] = TURNS,
): Promise<void> {
  page.render(turns);
  await navigateTo(path);
}

export function visibleQuotes(): Array<string | null> {
  return Array.from(document.querySelectorAll('.gv-highlight-mark'), (mark) => mark.textContent);
}

export function holdNextLocalRead(key: string): {
  wasRequested(): boolean;
  release(): void;
} {
  const original = chrome.storage.local.get.bind(chrome.storage.local);
  const read = (
    keys: string | string[] | Record<string, unknown> | null,
  ): Promise<Record<string, unknown>> => original(keys);
  let held = false;
  let release = () => {};
  vi.spyOn(chrome.storage.local, 'get').mockImplementation(((
    keys: string | string[] | Record<string, unknown> | null,
    callback?: (items: unknown) => void,
  ) => {
    const targets =
      typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys ?? {});
    if (held || !targets.includes(key)) {
      return read(keys).then((snapshot) => {
        callback?.(snapshot);
        return snapshot;
      });
    }
    held = true;
    return read(keys).then(
      (snapshot) =>
        new Promise<Record<string, unknown>>((resolve) => {
          release = () => {
            callback?.(snapshot);
            resolve(snapshot);
          };
        }),
    );
  }) as typeof chrome.storage.local.get);
  return { wasRequested: () => held, release: () => release() };
}

/** Serialize real account data into the files Drive receives, with the volatile export time fixed. */
export async function drivePayloadBytes(ext: ExtensionFake): Promise<string> {
  const { GoogleDriveSyncPayloads } = await import('@/core/services/GoogleDriveSyncPayloads');
  const { highlightImportExportService } =
    await import('@/features/backup/services/HighlightImportExportService');
  const writes: Array<{ name: string; payload: unknown }> = [];
  const payloads = new GoogleDriveSyncPayloads({
    ...noDriveHistory,
    ensure: async (_token, name) => name,
    find: async () => null,
    upload: async (_token, name, payload) => {
      if (/timeline-hierarchy|highlights/.test(name)) writes.push({ name, payload });
    },
    download: async () => null,
    prepareDownload: async () => {},
  });
  const now = Date.now();
  vi.setSystemTime(new Date('2026-10-01T00:00:00.000Z'));
  try {
    for (const account of ACCOUNTS) {
      await payloads.captureScopes(account.scope);
      const plan = payloads.planUpload({
        folders: { folders: [], folderContents: {} },
        prompts: [],
        starred: null,
        platform: 'gemini',
        forks: null,
        timelineHierarchy: ext.read<TimelineHierarchyData>('local', account.hierarchyKey) ?? null,
        accountScope: account.scope,
        timelineHierarchyAccountScope: account.scope,
        settings: null,
        plugins: null,
      });
      await payloads.uploadPlan('test-token', plan);
      const highlights = await highlightImportExportService.exportToPayload(account.scope);
      if (!highlights.success) throw highlights.error;
      await payloads.uploadHighlights('test-token', highlights.data, account.scope);
    }
    return JSON.stringify(writes);
  } finally {
    vi.setSystemTime(now);
  }
}

export async function finishHighlights(
  session: Awaited<ReturnType<typeof startHighlights>> | null,
): Promise<void> {
  session?.manager.destroy();
  await session?.ready;
  session?.restoreTransport();
  await settle();
}
