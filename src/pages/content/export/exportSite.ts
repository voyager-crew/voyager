/**
 * What the conversation export needs from one host: its name, which pages hold
 * a conversation, and where the selectable messages and their turns come from.
 * Factories live in `sites/`.
 */
import type { ChatTurn } from '@/features/export/types/export';

import type { ExportSelectionOptions } from './adapter/type';
import type {
  ConversationCollector,
  ExportMessage,
  ExportMessageRole,
} from './conversationCollector';

/** Selectable messages and the export turns built from a selection of them. */
export interface ExportTurnReader {
  /** Catalog readers prove both boundaries and identity before claiming completeness. */
  readonly completeness?: 'complete' | 'partial' | 'unknown';
  readonly interruption?: 'generating' | 'route';
  /** The preparation could not read the whole conversation history, so there is nothing to offer. */
  readonly failure?: 'history';
  /** Selectable messages, in reading order. */
  readonly messages: () => ExportMessage[];
  /** Export turns for the selected messages, content already read from the page. */
  readonly build: (
    selectedIds: ReadonlySet<string>,
    options: ExportSelectionOptions,
  ) => Promise<ChatTurn[]>;
  /** Roles of selected messages the page does not show (a virtualized thread). */
  readonly roles?: (
    selectedIds: ReadonlySet<string>,
    options: ExportSelectionOptions,
  ) => Promise<ReadonlyMap<string, ExportMessageRole>>;
}

/** What a preparation read for one export. It stands in for its source until released. */
export interface ExportTurnSession extends ExportTurnReader {
  readonly release: () => void;
}

export interface ExportTurnSource extends ExportTurnReader {
  /** Reading a selection scrolls the page, so the export shows its collecting banner meanwhile. */
  readonly scrollsWhileBuilding: boolean;
  /**
   * Read the conversation before selection mode opens, for a host whose DOM
   * cannot be walked in place. Null: nothing was read, and the export scrolls
   * the conversation to the top instead.
   */
  readonly prepare?: (options: ExportSelectionOptions) => Promise<ExportTurnSession | null>;
}

/**
 * The conversation as rendered, for overlay anchors, the empty-conversation
 * check and Canvas snapshots. Message ids come only from `ExportSite.turns`
 * and Gemini's entry points: the page's own pairing does not produce the ids
 * every turn source reads (ChatGPT).
 */
export type ConversationPage = Pick<
  ConversationCollector,
  | 'collectChatPairs'
  | 'topUserElement'
  | 'conversationRoot'
  | 'snapshotOpenCanvasDocs'
  | 'releaseCanvasDocs'
>;

/** Where the user starts an export on this host. */
export type ExportEntryPoints =
  /**
   * Gemini's conversation, sidebar and response menus, the logo button (or a
   * fallback toolbar) and copy-as-image. Opening a sidebar conversation waits
   * for `userSelectors` to render.
   */
  | {
      readonly kind: 'gemini';
      readonly userSelectors: () => string[];
      /** The `turns` message id of the response a response-menu trigger belongs to. */
      readonly assistantMessageIdFor: (trigger: HTMLElement | null) => string | null;
    }
  /**
   * A persistent toolbar alone. Hosts whose chat UI shares the origin with
   * unrelated pages (ChatGPT: Codex, settings) pass `isConversationPage`, and
   * the toolbar stays unmounted until the SPA reaches a conversation. Omitted:
   * every page on the host is eligible.
   */
  | {
      readonly kind: 'toolbar';
      readonly isConversationPage?: (doc: Document, url: string) => boolean;
      /** The popup's export card opens this toolbar's dialog through a runtime message (ChatGPT). */
      readonly opensFromPopup?: boolean;
      /** The host's conversation turns, whose per-message controls the toolbar never avoids. */
      readonly turnSelector?: string;
    };

export interface ExportSite {
  readonly id: string;
  /** The host's name as exports print it (`ConversationMetadata.platform`). */
  readonly label: string;
  readonly entryPoints: ExportEntryPoints;
  title(): string;
  readonly turns: ExportTurnSource;
  readonly page: ConversationPage;
  /**
   * Present on a host that lazy-loads history: an export clicks the topmost
   * prompt until the conversation stops growing, and resumes after a reload.
   */
  readonly history?: {
    userSelectors(): string[];
    assistantSelectors(): string[];
  };
}
