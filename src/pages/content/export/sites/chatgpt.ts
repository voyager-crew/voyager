import { createContentExtractor } from '@/features/export/services/DOMContentExtractor';

import { buildChatGptTurnsForSelection, resolveChatGptSelectionRoles } from '../adapter/chatgpt';
import { createChatGptLoggedOutReader } from '../adapter/chatgptLoggedOut';
import { type ChatGptThreadKind, readChatGptThreadKind } from '../adapter/chatgptLoggedOutDom';
import { normalizedConversationUrl } from '../adapter/chatgptShared';
import {
  type ChatGptThreadSession,
  createChatGptThreadPreparer,
  uncrawledChatGptTurnContainers,
} from '../adapter/chatgptThreadExport';
import { chatgptIsConversationPage } from '../adapter/platform/chatgpt';
import type { ExportPlatformAdapter } from '../adapter/platformAdapters';
import type { ChatGptTurnContainer } from '../adapter/type';
import { prepareChatGptExportWithProgress } from '../chatgptCrawlProgress';
import { createConversationCollector } from '../conversationCollector';
import type { ExportMessage } from '../conversationCollector';
import type { ExportSite, ExportTurnReader, ExportTurnSession } from '../exportSite';
import { siteTurnSelector } from './siteTurnSelector';

function selectionMessages(containers: readonly ChatGptTurnContainer[]): ExportMessage[] {
  return containers.map((turn) => ({
    messageId: turn.id,
    role: turn.role,
    hostElement: turn.container,
    exportElement: turn.container,
    text: '',
    starred: false,
  }));
}

function exportSession(session: ChatGptThreadSession): ExportTurnSession {
  return {
    // A failed crawl offers nothing to select; say why instead of the empty-page warning.
    ...(session.crawlFailure() ? { failure: 'history' as const } : {}),
    messages: () => selectionMessages(session.containers()),
    build: session.build,
    roles: session.roles,
    release: session.release,
  };
}

type TurnReader = ExportTurnReader & Required<Pick<ExportTurnReader, 'roles'>>;

/**
 * The logged-out reader bound to the route it was prepared on, as the desktop
 * crawl's session is: the selection opens a moment after preparation, and a
 * conversation opened meanwhile must not export in its place.
 */
function routeBoundSession(reader: TurnReader, route: string): ExportTurnSession {
  return {
    messages: () => (normalizedConversationUrl() === route ? reader.messages() : []),
    build: (selectedIds, options) => reader.build(selectedIds, { ...options, expectedUrl: route }),
    roles: (selectedIds, options) => reader.roles(selectedIds, { ...options, expectedUrl: route }),
    release() {},
  };
}

/**
 * ChatGPT virtualizes its thread, so the DOM holds only a few turns. On the
 * current DOM the export crawls the thread before selection and reads that
 * crawl; the earlier DOM keeps its retained per-message containers. The
 * logged-out page (`/uc/<id>`, at any width) keeps every message mounted and
 * has its own reader.
 */
export function createChatGptExportSite(adapter: ExportPlatformAdapter): ExportSite {
  const extractor = createContentExtractor(adapter);
  const preparer = createChatGptThreadPreparer();
  const loggedOut = createChatGptLoggedOutReader(adapter);
  const desktop: TurnReader = {
    messages: () => selectionMessages(uncrawledChatGptTurnContainers()),
    build: async (selectedIds, options) => {
      // Direct consumers also need a full crawl; they do not run the selection preparer.
      const session = await createChatGptThreadPreparer().prepare({ ...options, extractor });
      if (!session) {
        return buildChatGptTurnsForSelection(selectedIds, { ...options, extractor });
      }
      try {
        return await session.build(selectedIds, options);
      } finally {
        session.release();
      }
    },
    roles: resolveChatGptSelectionRoles,
  };
  /**
   * The reader the last preparation chose, for its route. An export without a
   * session (the earlier DOM, or a page whose messages had not mounted yet)
   * reads `turns` itself and must not switch readers under the selection. It
   * is fixed only once the DOM shows which thread it is: an empty logged-out
   * wrapper fixed as desktop would then offer none of the messages it mounts.
   */
  let prepared: { route: string; kind: ChatGptThreadKind | null } | null = null;
  const reader = (): TurnReader => {
    const route = normalizedConversationUrl();
    let kind = prepared?.route === route ? prepared.kind : null;
    if (!kind) {
      kind = readChatGptThreadKind();
      if (prepared?.route === route) prepared = { route, kind };
    }
    return kind === 'loggedOut' ? loggedOut : desktop;
  };

  return {
    id: adapter.site.id,
    label: adapter.site.label,
    entryPoints: {
      kind: 'toolbar',
      isConversationPage: chatgptIsConversationPage,
      opensFromPopup: true,
      turnSelector: siteTurnSelector(adapter.site),
    },
    title: adapter.extractConversationTitle,
    turns: {
      scrollsWhileBuilding: true,
      messages: () => reader().messages(),
      build: (selectedIds, options) => reader().build(selectedIds, options),
      roles: (selectedIds, options) => reader().roles(selectedIds, options),
      prepare: async (options) => {
        const route = normalizedConversationUrl(options.expectedUrl);
        const kind = readChatGptThreadKind();
        prepared = { route, kind };
        if (kind === 'loggedOut') return routeBoundSession(loggedOut, route);
        const session = await prepareChatGptExportWithProgress(preparer, { ...options, extractor });
        return session && exportSession(session);
      },
    },
    page: createConversationCollector(adapter),
  };
}
