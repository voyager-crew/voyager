import type { ContentExtractor } from '@/features/export/services/DOMContentExtractor';

import type { ExportPlatformAdapter } from '../adapter/platformAdapters';
import type { ChatTurn, ConversationCollector } from '../conversationCollector';
import { createCompatibilityCollectorPolicy } from './compatibilityCollectorPolicy';
import { createGeminiCollectorPolicy } from './geminiCollectorPolicy';

export interface CollectedConversation {
  readonly pairs: ChatTurn[];
  readonly extractor: ContentExtractor;
}

/** A complete page read and the lifetime of the content it appends. */
export interface ConversationCollectorPolicy extends Pick<
  ConversationCollector,
  | 'conversationRoot'
  | 'topUserElement'
  | 'assistantMessageIdFor'
  | 'snapshotOpenCanvasDocs'
  | 'releaseCanvasDocs'
> {
  collect(starredIds: ReadonlySet<string>): CollectedConversation;
}

const COLLECTOR_POLICIES: Record<
  string,
  (adapter: ExportPlatformAdapter) => ConversationCollectorPolicy
> = {
  gemini: createGeminiCollectorPolicy,
};

export function createCollectorPolicy(adapter: ExportPlatformAdapter): ConversationCollectorPolicy {
  const create = Object.hasOwn(COLLECTOR_POLICIES, adapter.site.id)
    ? COLLECTOR_POLICIES[adapter.site.id]
    : createCompatibilityCollectorPolicy;
  return create(adapter);
}
