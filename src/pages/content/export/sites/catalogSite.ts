import type { ChatTurn } from '@/features/export/types/export';
import { showExportProgress } from '@/features/export/ui/exportToasts';
import type { SiteAdapter } from '@/features/plugins/types';
import { getTranslationSync } from '@/utils/i18n';

import { exportSiteSnapshot } from '../adapter/exportSiteSnapshot';
import { buildCatalogExportAdapter } from '../adapter/platform/catalog';
import type { ExportSelectionOptions } from '../adapter/type';
import type { ExportMessage } from '../conversationCollector';
import { throwIfExportCancelled } from '../exportCancellation';
import type { ExportSite, ExportTurnSession } from '../exportSite';
import { siteTurnSelector } from '../toolbarTargets';
import {
  captureCatalogWindow,
  readCatalogConversation,
  type CatalogSnapshot,
} from './catalogReader';

/** Keep consecutive prompts separate; selecting only a reply keeps its original exchange. */
function selectedTurns(
  snapshots: readonly CatalogSnapshot[],
  ids: ReadonlySet<string>,
): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let current: ChatTurn | undefined;
  for (const snapshot of snapshots) {
    if (snapshot.role === 'user' || !current || current.assistantContent) {
      current = { user: '', assistant: '', starred: false, omitEmptySections: true };
      turns.push(current);
    }
    if (!ids.has(snapshot.id)) continue;
    if (snapshot.role === 'user') {
      current.user = snapshot.text;
      current.userContent = snapshot.content;
      current.userElement = snapshot.element;
      current.attachments = snapshot.content.attachments;
    } else {
      current.assistant = snapshot.text;
      current.assistantContent = snapshot.content;
      current.assistantElement = snapshot.element;
    }
  }
  return turns.filter((turn) => turn.userContent || turn.assistantContent);
}

function sameBody(a: CatalogSnapshot, b: CatalogSnapshot): boolean {
  return (
    a.role === b.role && a.content.text === b.content.text && a.content.html === b.content.html
  );
}

/** Only certain window matches get a checkbox; all saved messages remain selectable by role/all. */
function selectionMessages(
  saved: readonly CatalogSnapshot[],
  mounted: CatalogSnapshot[],
): ExportMessage[] {
  const hosts = new Map<string, HTMLElement>();
  const usedHosts = new Set<HTMLElement>();
  const bind = (id: string, host: HTMLElement): void => {
    if (!host.isConnected || hosts.has(id) || usedHosts.has(host)) return;
    hosts.set(id, host);
    usedHosts.add(host);
  };
  const nativeCounts = new Map<string, number>();
  for (const snapshot of mounted) {
    if (snapshot.nativeId)
      nativeCounts.set(snapshot.nativeId, (nativeCounts.get(snapshot.nativeId) ?? 0) + 1);
  }
  for (const snapshot of mounted) {
    const host = snapshot.host.deref();
    if (!host?.isConnected) continue;
    if (snapshot.nativeId && nativeCounts.get(snapshot.nativeId) === 1) {
      const keyed = saved.filter((entry) => entry.nativeId === snapshot.nativeId);
      if (keyed.length === 1) bind(keyed[0].id, host);
      continue;
    }
    const retained = saved.filter(
      (entry) => entry.host.deref() === host && sameBody(entry, snapshot),
    );
    if (retained.length === 1) bind(retained[0].id, host);
  }
  const starts: number[] = [];
  if (mounted.length) {
    for (let start = 0; start <= saved.length - mounted.length; start++) {
      if (mounted.every((snapshot, index) => sameBody(snapshot, saved[start + index])))
        starts.push(start);
    }
  }
  if (starts.length === 1) {
    mounted.forEach((snapshot, index) => {
      // A native key wins even when its edited body now matches another saved message.
      if (snapshot.nativeId) return;
      const host = snapshot.host.deref();
      if (host) bind(saved[starts[0] + index].id, host);
    });
  }
  return saved.map((snapshot) => ({
    messageId: snapshot.id,
    role: snapshot.role,
    hostElement: hosts.get(snapshot.id) ?? snapshot.element,
    exportElement: snapshot.element,
    text: snapshot.text,
    starred: false,
  }));
}

/** Third ExportSite: site data supplies facts, shared owners supply UI and file generation. */
export function createCatalogExportSite(provided: SiteAdapter): ExportSite {
  const site = exportSiteSnapshot(provided);
  const adapter = buildCatalogExportAdapter(site);
  const root = () => adapter.resolveConversationRoot(adapter.getUserSelectors(), document);
  const mounted = () => captureCatalogWindow(site, adapter, root());
  let active: ExportTurnSession | null = null;
  let controller: AbortController | null = null;

  const prepare = async (options: ExportSelectionOptions): Promise<ExportTurnSession> => {
    controller?.abort();
    active?.release();
    const owner = new AbortController();
    controller = owner;
    const cancel = () => owner.abort();
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) owner.abort();
    const progress = showExportProgress({
      message: getTranslationSync('export_reading_conversation_title'),
      action: { label: getTranslationSync('pm_cancel'), run: cancel },
    });
    try {
      const result = await readCatalogConversation(site, adapter, {
        ...options,
        signal: owner.signal,
      });
      throwIfExportCancelled(owner.signal);
      let snapshots = result.snapshots;
      let released = false;
      const assertCurrent = (readOptions: ExportSelectionOptions) => {
        throwIfExportCancelled(readOptions.signal);
        throwIfExportCancelled(owner.signal);
        if (
          readOptions.expectedUrl &&
          new URL(readOptions.expectedUrl).href.split('#')[0] !== location.href.split('#')[0]
        ) {
          throw new Error('export_conversation_changed');
        }
        if (site.export?.generating && document.querySelector(site.export.generating)) {
          throw new Error('export_read_interrupted');
        }
      };
      const session: ExportTurnSession = {
        completeness: result.completeness,
        ...(result.reason === 'generating' || result.reason === 'route'
          ? { interruption: result.reason }
          : {}),
        messages: () => (released ? [] : selectionMessages(snapshots, mounted())),
        build: async (ids, readOptions) => {
          assertCurrent(readOptions);
          return selectedTurns(snapshots, ids);
        },
        release: () => {
          if (released) return;
          released = true;
          owner.abort();
          options.signal?.removeEventListener('abort', cancel);
          snapshots = [];
          if (active === session) active = null;
          if (controller === owner) controller = null;
        },
      };
      active = session;
      return session;
    } catch (error) {
      options.signal?.removeEventListener('abort', cancel);
      if (controller === owner) controller = null;
      throw error;
    } finally {
      progress.hide();
    }
  };
  return {
    id: site.id,
    label: site.label,
    title: adapter.extractConversationTitle,
    entryPoints: {
      kind: 'toolbar',
      turnSelector: siteTurnSelector(site),
      isConversationPage: (_doc, url) =>
        Boolean(
          site.conversationIdPattern &&
          new RegExp(site.conversationIdPattern).exec(new URL(url).pathname)?.[1],
        ),
    },
    turns: {
      scrollsWhileBuilding: site.export?.read === 'virtual',
      messages: () => active?.messages() ?? [],
      prepare,
      build: async (ids, options) => {
        const session = await prepare(options);
        try {
          if (session.interruption) throw new Error('export_read_interrupted');
          return await session.build(ids, options);
        } finally {
          session.release();
        }
      },
    },
    page: {
      collectChatPairs: () =>
        mounted().map((snapshot) => ({
          turnId: snapshot.id,
          user: snapshot.role === 'user' ? snapshot.text : '',
          assistant: snapshot.role === 'assistant' ? snapshot.text : '',
          starred: false,
        })),
      topUserElement: () =>
        site.selectors.userTurn ? root().querySelector(site.selectors.userTurn) : null,
      conversationRoot: root,
      snapshotOpenCanvasDocs: () => {},
      releaseCanvasDocs: () => {},
    },
  };
}
