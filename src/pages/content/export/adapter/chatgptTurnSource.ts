import { logger } from '@/core/services/LoggerService';
import { createContentExtractor } from '@/features/export/services/DOMContentExtractor';
import { showExportProgress } from '@/features/export/ui/exportToasts';
import { startMachine } from '@/features/plugins/runtime/stateMachine';
import { loadChatGptStarHashes } from '@/features/savedLibrary/exportStars';
import { getTranslationSync as t } from '@/utils/i18n';

import { isAbortError } from '../exportCancellation';
import type { ExportTurnReader, ExportTurnSession, ExportTurnSource } from '../exportSite';
import {
  buildChatGptTurnsForSelection,
  chatgptCollectTurnContainers,
  resolveChatGptSelectionRoles,
} from './chatgpt';
import { type ChatGptCrawlOptions, crawlChatGptThread } from './chatgptCrawl';
import { createChatGptLoggedOutReader } from './chatgptLoggedOut';
import { type ChatGptThreadKind, readChatGptThreadKind } from './chatgptLoggedOutDom';
import { assertActive, normalizedConversationUrl } from './chatgptShared';
import {
  type ChatGptThreadMessage,
  findAssistantReply,
  findUserBubble,
  hasRenderedThread,
  mountedTurnItems,
  readTurnKey,
  resolveVisibleConversationRoot,
  userSelectionHost,
} from './chatgptThread';
import { turnsFromMessages } from './chatgptThreadExport';
import { watchThreadVersions } from './chatgptThreadWatch';
import type { ExportPlatformAdapter } from './platformAdapters';

type ThreadState =
  | { status: 'reading' }
  | { status: 'ready'; messages: readonly ChatGptThreadMessage[] }
  | { status: 'invalid'; code: string }
  | { status: 'failed' }
  | { status: 'released' };
type ThreadEvent =
  | { type: 'read'; messages: readonly ChatGptThreadMessage[] }
  | { type: 'invalidate'; code: string }
  | { type: 'fail' }
  | { type: 'release' };

function transition(state: ThreadState, event: ThreadEvent): ThreadState {
  if (state.status === 'released') return state;
  switch (event.type) {
    case 'read':
      return { status: 'ready', messages: event.messages };
    case 'invalidate':
      return { status: 'invalid', code: event.code };
    case 'fail':
      return { status: 'failed' };
    case 'release':
      return { status: 'released' };
  }
}

type ReadOptions = Omit<ChatGptCrawlOptions, 'extractor'>;
type Reader = ExportTurnReader & Required<Pick<ExportTurnReader, 'roles'>>;

/** The crawl is a site policy implementing the shared prepare/read/release contract directly. */
export function createChatGptTurnSource(adapter: ExportPlatformAdapter) {
  const extractor = createContentExtractor(adapter);
  const loggedOut = createChatGptLoggedOutReader(adapter);
  let latest: ExportTurnSession | null = null;
  let prepared: { route: string; kind: ChatGptThreadKind | null } | null = null;

  async function prepare(
    options: ReadOptions,
    showReading = true,
  ): Promise<ExportTurnSession | null> {
    latest?.release();
    latest = null;
    const route = normalizedConversationUrl(options.expectedUrl);
    const kind = readChatGptThreadKind();
    prepared = { route, kind };
    if (kind === 'loggedOut') {
      return {
        messages: () => (normalizedConversationUrl() === route ? loggedOut.messages() : []),
        build: (ids, readOptions) => loggedOut.build(ids, { ...readOptions, expectedUrl: route }),
        roles: (ids, readOptions) => loggedOut.roles(ids, { ...readOptions, expectedUrl: route }),
        release() {},
      };
    }
    // Retained containers still use the runner's scroll-to-top preparation.
    if (!hasRenderedThread()) return null;
    // One watch spans reading and selection, including branch changes while items unmount.
    const watch = watchThreadVersions();
    const lastHosts = new Map<string, HTMLElement>();
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const reading = new Promise<void>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    const machine = startMachine<ThreadState, ThreadEvent>(
      {
        id: 'export-thread',
        transition,
        effects: {
          reading(stay) {
            const crawl = new AbortController();
            const cancel = () => crawl.abort();
            stay.scope.on(stay.signal, 'abort', cancel, { once: true });
            if (options.signal) stay.scope.on(options.signal, 'abort', cancel, { once: true });
            if (options.signal?.aborted) cancel();
            const detail = (count: number) =>
              t('export_reading_conversation_turns').replace('{count}', String(count));
            const progress = showReading
              ? showExportProgress({
                  message: t('export_reading_conversation_title'),
                  detail: detail(0),
                  action: { label: t('pm_cancel'), run: cancel },
                })
              : null;
            stay.scope.effect(() => () => progress?.hide());
            void crawlChatGptThread({
              ...options,
              extractor,
              signal: crawl.signal,
              expectedUrl: route,
              onProgress: (count) => {
                if (stay.signal.aborted) return;
                progress?.update({ detail: detail(count) });
                options.onProgress?.(count);
              },
            }).then(
              (messages) => {
                if (!stay.signal.aborted) {
                  watch.adopt(messages);
                  stay.send({ type: 'read', messages });
                }
                resolve();
              },
              (error: unknown) => {
                if (isAbortError(error)) {
                  // Superseded sessions stay empty; cancellation still rejects after scroll restoration.
                  if (machine.state.status === 'released' && !options.signal?.aborted) resolve();
                  else {
                    stay.send({ type: 'release' });
                    reject(error);
                  }
                } else {
                  stay.send({ type: 'fail' });
                  logger.warn('ChatGPT export could not read the whole conversation', {
                    error: String(error),
                  });
                  resolve();
                }
              },
            );
          },
          failed: () => watch.stop(),
          invalid: () => watch.stop(),
          released: () => {
            watch.stop();
            lastHosts.clear();
          },
        },
      },
      { status: 'reading' },
    );

    function messages(): readonly ChatGptThreadMessage[] {
      if (machine.state.status === 'ready' && watch.changed()) {
        machine.send({ type: 'invalidate', code: 'chatgpt_export_thread_changed' });
      }
      return machine.state.status === 'ready' ? machine.state.messages : [];
    }
    function selected(ids: ReadonlySet<string>): readonly ChatGptThreadMessage[] {
      if (machine.state.status !== 'released' && normalizedConversationUrl() !== route) {
        throw new Error('chatgpt_export_conversation_changed');
      }
      const current = messages();
      if (machine.state.status !== 'ready') {
        throw new Error(
          machine.state.status === 'invalid'
            ? machine.state.code
            : 'chatgpt_export_thread_incomplete',
        );
      }
      const known = new Set(current.map((message) => message.id));
      const missing = Array.from(ids).filter((id) => !known.has(id));
      if (missing.length) throw new Error(`chatgpt_export_messages_missing:${missing.join(',')}`);
      return current.filter((message) => ids.has(message.id));
    }
    const session: ExportTurnSession = {
      get failure() {
        return machine.state.status === 'failed' ? 'history' : undefined;
      },
      messages() {
        if (normalizedConversationUrl() !== route) return [];
        const hosts = liveHosts();
        return messages().map((message) => {
          const host = hosts.get(message.id) ?? lastHosts.get(message.id) ?? message.host;
          lastHosts.set(message.id, host);
          return {
            messageId: message.id,
            role: message.role,
            hostElement: host,
            exportElement: host,
            text: '',
            starred: false,
          };
        });
      },
      async build(ids, readOptions) {
        assertActive(readOptions);
        selected(ids);
        const hashes = await loadChatGptStarHashes(route);
        assertActive(readOptions);
        // A branch switch or release during the Library read invalidates its result too.
        return turnsFromMessages(selected(ids), hashes);
      },
      async roles(ids, readOptions) {
        assertActive(readOptions);
        return new Map(selected(ids).map((message) => [message.id, message.role]));
      },
      release: () => machine.send({ type: 'release' }),
    };
    latest = session;
    await reading;
    return session;
  }

  const desktop: Reader = {
    messages: () =>
      hasRenderedThread()
        ? []
        : chatgptCollectTurnContainers().map((turn) => ({
            messageId: turn.id,
            role: turn.role,
            hostElement: turn.container,
            exportElement: turn.container,
            text: '',
            starred: false,
          })),
    build: async (ids, options) => {
      // Direct consumers also crawl; they have no selection preparation.
      const session = await prepare(options, false);
      if (!session) return buildChatGptTurnsForSelection(ids, { ...options, extractor });
      try {
        return await session.build(ids, options);
      } finally {
        session.release();
      }
    },
    roles: resolveChatGptSelectionRoles,
  };
  const reader = (): Reader => {
    const route = normalizedConversationUrl();
    let kind = prepared?.route === route ? prepared.kind : null;
    // An initially empty wrapper may reveal its DOM kind only after preparation.
    if (!kind) {
      kind = readChatGptThreadKind();
      if (prepared?.route === route) prepared = { route, kind };
    }
    return kind === 'loggedOut' ? loggedOut : desktop;
  };
  return {
    scrollsWhileBuilding: true,
    prepare: (options: ReadOptions) => prepare(options),
    messages: () => reader().messages(),
    build: (ids, options) => reader().build(ids, options),
    roles: (ids, options) => reader().roles(ids, options),
  } satisfies ExportTurnSource;
}

/** Reanchor checkboxes to live bodies while keeping unmounted message hosts stable. */
function liveHosts(): Map<string, HTMLElement> {
  const hosts = new Map<string, HTMLElement>();
  for (const item of mountedTurnItems(resolveVisibleConversationRoot(document))) {
    const key = readTurnKey(item);
    const bubble = findUserBubble(item);
    const reply = findAssistantReply(item);
    if (bubble) hosts.set(`${key}:u`, userSelectionHost(item, bubble));
    if (reply) hosts.set(`${key}:a`, reply);
  }
  return hosts;
}
