import { createContentExtractor } from '@/features/export/services/DOMContentExtractor';
import { getExportReadProfiles } from '@/features/export/services/exportSiteData';

import type { ExportPlatformAdapter } from '../adapter/platformAdapters';
import { resolveConversationTurnOperation } from '../conversationTurnOperation';
import type { ConversationCollectorPolicy } from './collectorPolicy';
import { geminiShapedCanvasReader, readGeminiShapedPairs } from './geminiCollectorPolicy';
import { createInPlaceCollection, type InPlaceReadOperation } from './inPlaceCollection';

/** Retain the old mounted reader for page anchors and unknown-host compatibility. */
export function createCompatibilityCollectorPolicy(
  adapter: ExportPlatformAdapter,
): ConversationCollectorPolicy {
  const profiles = getExportReadProfiles(adapter.site.id);
  const extractor = createContentExtractor(adapter);
  const read: InPlaceReadOperation = (operation, isUsable) =>
    resolveConversationTurnOperation(
      adapter,
      (turns) =>
        operation({
          root: turns.root,
          users: turns.users,
          collect: (starredIds) => ({
            pairs: readGeminiShapedPairs(adapter, turns, starredIds),
            createExtractor: () => extractor,
          }),
        }),
      isUsable,
    );
  return createInPlaceCollection({
    read,
    canvas: geminiShapedCanvasReader(adapter),
    markdownSelector: profiles['export.walkMarkdown'],
    responseOwner: (trigger) => {
      const element = trigger.closest<HTMLElement>(profiles['export.menuResponseOwner']);
      return element ? { kind: 'response', element } : null;
    },
  });
}
