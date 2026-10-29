import type { ContentExtractor } from '@/features/export/services/DOMContentExtractor';
import type { CanvasDoc } from '@/features/export/types/export';

import type { CanvasContentReader } from '../canvasContent';
import type { ChatTurn } from '../conversationCollector';
import { findAssistantForTurn } from '../conversationDom';
import type { ConversationTurnDom } from '../conversationTurnOperation';
import { resolveUniqueExportTurnIds } from '../selectionIds';
import type { ConversationCollectorPolicy } from './collectorPolicy';

const CANVAS_EXPORT_SECTION_CLASS = 'gv-canvas-export-section';

export interface InPlaceConversationRead {
  readonly root: HTMLElement;
  readonly users: readonly HTMLElement[];
  collect(starredIds: ReadonlySet<string>): {
    pairs: ChatTurn[];
    createExtractor(): ContentExtractor;
  };
}

/** Both pairing and its extractor are derived from the same accepted page read. */
export type InPlaceReadOperation = <T>(
  read: (conversation: InPlaceConversationRead) => T,
  isUsable: (value: T) => boolean,
) => T;

export type ResponseOwner =
  | { readonly kind: 'trigger' }
  | { readonly kind: 'response'; readonly element: HTMLElement };

export function normalizeCollectedText(text: string | null): string {
  try {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

/** Document order, turn ids and pairing do not depend on the content dialect. */
export function readPairedConversation(
  {
    users,
    assistants,
    userSelector,
    assistantSelector,
  }: Pick<ConversationTurnDom, 'users' | 'assistants' | 'userSelector' | 'assistantSelector'>,
  decode: (user: HTMLElement, assistant: HTMLElement | null, turnId: string) => ChatTurn | null,
): ChatTurn[] {
  const ids = resolveUniqueExportTurnIds(users);
  const pairs: ChatTurn[] = [];
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const assistant = findAssistantForTurn(
      user,
      users[i + 1],
      assistants,
      userSelector,
      assistantSelector,
    );
    const pair = decode(user, assistant, ids[i]);
    if (pair) pairs.push(pair);
  }
  return pairs;
}

/** Remove content appended to live responses while an export was being read. */
export function removeCanvasExportSections(): void {
  document.querySelectorAll(`.${CANVAS_EXPORT_SECTION_CLASS}`).forEach((el) => el.remove());
}

function appendCanvasDocSections(target: Element, canvasDocs: readonly CanvasDoc[]): void {
  for (const doc of canvasDocs) {
    const section = document.createElement('div');
    section.className = CANVAS_EXPORT_SECTION_CLASS;
    const heading = document.createElement('h3');
    heading.textContent = `📄 Canvas Document: ${doc.title}`;
    const content = document.createElement('div');
    content.className = 'gv-canvas-content';
    content.textContent = doc.content;
    section.appendChild(heading);
    section.appendChild(content);
    target.appendChild(section);
  }
}

/** Shared mounted-page mechanics; each packaged policy supplies one complete read operation. */
export function createInPlaceCollection(options: {
  read: InPlaceReadOperation;
  canvas: CanvasContentReader;
  markdownSelector: string;
  responseOwner(trigger: HTMLElement): ResponseOwner | null;
}): ConversationCollectorPolicy {
  const { read, canvas } = options;
  let cachedCanvasDocs: CanvasDoc[] | null = null;

  const collect = (starredIds: ReadonlySet<string>) => {
    const result = read(
      (conversation) => conversation.collect(starredIds),
      ({ pairs }) => pairs.length > 0,
    );
    // Only an accepted read may append content to the live response.
    for (const { assistantHostElement: host, assistantElement: target } of result.pairs) {
      if (
        !host ||
        !target ||
        !canvas.assistantHasCanvasDoc(host) ||
        !(canvas.isAnyCanvasOpen() || (cachedCanvasDocs && cachedCanvasDocs.length > 0)) ||
        target.querySelector(`.${CANVAS_EXPORT_SECTION_CLASS}`)
      )
        continue;
      const docs = cachedCanvasDocs?.length ? cachedCanvasDocs : canvas.extractAllCanvasDocs();
      if (docs.length > 0) {
        appendCanvasDocSections(target.querySelector(options.markdownSelector) || target, docs);
      }
    }
    return { pairs: result.pairs, extractor: result.createExtractor() };
  };

  return {
    collect,
    conversationRoot: () =>
      read(
        (conversation) => conversation,
        ({ users }) => users.length > 0,
      ).root,
    topUserElement: () =>
      read(
        ({ users }) => users[0] ?? null,
        (user) => user !== null,
      ),
    assistantMessageIdFor: (trigger) => {
      if (!trigger) return null;
      const owner = options.responseOwner(trigger);
      if (!owner) return null;
      const target = collect(new Set()).pairs.find(({ assistantHostElement: host }) => {
        if (!host) return false;
        if (owner.kind === 'trigger') return host.contains(trigger);
        return (
          host === owner.element ||
          host.contains(owner.element) ||
          owner.element.contains(host) ||
          host.contains(trigger)
        );
      });
      return target ? `${target.turnId}:a` : null;
    },
    snapshotOpenCanvasDocs: () => {
      if (canvas.isAnyCanvasOpen()) cachedCanvasDocs = canvas.extractAllCanvasDocs();
    },
    releaseCanvasDocs: () => {
      cachedCanvasDocs = null;
      removeCanvasExportSections();
    },
  };
}
