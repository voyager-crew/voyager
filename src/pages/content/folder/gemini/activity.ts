/**
 * When each filed Gemini chat last had a turn: the server timestamps Gemini's
 * history reports, the stored message timestamps, and a send in the composer
 * of a filed chat. It runs only while the folders are on; `knownLastTurnAt`
 * answers what is already known at any time, so a newly filed chat starts with
 * its last turn.
 */
import { buildConversationIdFromUrl } from '@/core/utils/conversationIdentity';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';
import { applyFolderOp } from '@/features/folder/owner/applyFolderOp';
import { FOLDER_SITE_POLICIES } from '@/features/folder/owner/folderOwnerPolicy';

import { TimestampService } from '../../timestamp/TimestampService';
import { whenHistoryTimestampsReady } from '../../timestamp/historyTimestampPageService';
import { historyTimestampStore } from '../../timestamp/historyTimestamps';
import { folderDebugWarn } from '../FolderRepository';
import { normalizeConversationId, resolveConversationRouteId } from '../folderConversationIdentity';
import { getCurrentConversationId } from '../nativeConversationIds';
import type { FolderData } from '../types';
import { deferActivitySend, startActivityLifetime } from './activityLifetime';
import { resolveActivitySendIntent } from './activitySelectors';

export interface ConversationActivityEntry {
  conversationId: string;
  lastTurnAt: number;
}

export interface ConversationActivityHost {
  /** The folders the activity reads; resolved on every call. */
  data(): FolderData;
  /** Not destroyed, and the folders are on. */
  isActive(): boolean;
  isConversationInFolders(conversationId: string): boolean;
  /** Raise the entries' last turns in the folders and save. */
  apply(entries: ConversationActivityEntry[]): void;
}

/**
 * The folders with `lastTurnAt` raised on every record each entry's id or
 * saved route names, as the op does; `null` when nothing would change.
 */
export function raiseConversationActivity(
  data: FolderData,
  entries: ConversationActivityEntry[],
): FolderData | null {
  const known = entries.filter((entry) => entry.conversationId && entry.lastTurnAt > 0);
  if (known.length === 0) return null;
  const result = applyFolderOp(
    data,
    { kind: 'setConversationActivity', entries: known },
    FOLDER_SITE_POLICIES.gemini,
    Date.now(),
  );
  return result.outcome.kind === 'saved' ? result.data : null;
}

export class GeminiConversationActivity {
  private timestampService: TimestampService | null = null;
  private lifetime: ReturnType<typeof startActivityLifetime> | null = null;

  constructor(private readonly host: ConversationActivityHost) {}

  /** Starts tracking once; a call while it starts or runs returns the same start. */
  start(): Promise<void> {
    if (this.lifetime?.isRunning()) return this.lifetime.ready;
    this.lifetime = startActivityLifetime({
      initialize: async (signal) => {
        try {
          if (!this.timestampService) {
            const service = new TimestampService();
            await service.initialize();
            if (signal.aborted) return false;
            // Keep a completed read if the later history wait is cancelled, as the bundled path did.
            this.timestampService = service;
          }
          // Wait for the page-owned store; this feature must not revive it after teardown.
          return (await whenHistoryTimestampsReady(signal)) && this.host.isActive();
        } catch (error) {
          if (!isExtensionContextInvalidatedError(error)) {
            folderDebugWarn('Failed to initialize conversation activity tracking:', error);
          }
          return false;
        }
      },
      onCancelled: () => {
        if (this.host.isActive()) void this.start();
      },
      activate: () => {
        this.backfill();
        const unsubscribe = historyTimestampStore.subscribe((cids) => {
          if (this.host.isActive()) this.applyHistory(cids);
        });
        const pending = new Set<ReturnType<typeof deferActivitySend>>();
        const sendIntentHandler = (event: Event) => {
          if (!resolveActivitySendIntent(event).value.accepted) return;
          const conversationId = getCurrentConversationId();
          if (!conversationId || !this.host.isConversationInFolders(conversationId)) return;
          const sentAt = Date.now();
          const work = deferActivitySend(event, () => {
            if (this.host.isActive() && this.host.isConversationInFolders(conversationId)) {
              this.host.apply([{ conversationId, lastTurnAt: sentAt }]);
            }
          });
          pending.add(work);
          work.subscribe((state) => {
            if (state.status === 'complete') pending.delete(work);
          });
        };
        document.addEventListener('click', sendIntentHandler, true);
        document.addEventListener('submit', sendIntentHandler, true);
        return () => {
          document.removeEventListener('click', sendIntentHandler, true);
          document.removeEventListener('submit', sendIntentHandler, true);
          unsubscribe();
          for (const work of pending) void work.stop();
          pending.clear();
        };
      },
    });
    return this.lifetime.ready;
  }

  stop(): void {
    this.lifetime?.stop();
    this.lifetime = null;
  }

  knownLastTurnAt(conversationId: string, url?: string): number | undefined {
    const nativeConversationId = normalizeConversationId(conversationId);
    if (!nativeConversationId) return undefined;

    // An imported record may keep a synthetic id; Gemini's history reports its route id.
    const routeId = resolveConversationRouteId(url, conversationId);
    const serverTimestamp = Math.max(
      ...[nativeConversationId, routeId].map((id) =>
        id ? (historyTimestampStore.getLatestTurnTimestamp(id) ?? 0) : 0,
      ),
    );
    const stableConversationId = buildConversationIdFromUrl(
      url || `https://gemini.google.com/app/${nativeConversationId}`,
    );
    const storedTimestamp =
      this.timestampService?.getLatestTimestampForConversation(stableConversationId) ?? undefined;
    const latest = Math.max(serverTimestamp, storedTimestamp ?? 0);
    return latest > 0 ? latest : undefined;
  }

  /** Raises every filed chat to its last known turn. */
  backfill(): void {
    this.host.apply(
      Object.values(this.host.data().folderContents)
        .flat()
        .map(({ conversationId, url }) => ({
          conversationId,
          lastTurnAt: this.knownLastTurnAt(conversationId, url) ?? 0,
        })),
    );
  }

  applyHistory(cids: string[]): void {
    this.host.apply(
      cids.map((cid) => {
        const conversationId = normalizeConversationId(cid) ?? '';
        const lastTurnAt = historyTimestampStore.getLatestTurnTimestamp(conversationId) ?? 0;
        return { conversationId, lastTurnAt };
      }),
    );
  }
}
