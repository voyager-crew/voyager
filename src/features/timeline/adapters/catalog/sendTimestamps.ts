/**
 * Send-time timestamps for a catalog timeline. A virtualized host mounts old
 * turns whenever the user scrolls, so first-seen stamping would date history
 * "now"; only a send `trackUserSends` reports is stamped, under the host's own
 * key for the turn it produced. Times live in per-conversation keys
 * (`sendTimesStore`), never in Gemini's store. Recording and display follow
 * the same "message timestamps" setting as Gemini; the time shows in the
 * dot's tooltip.
 */
import { StorageFactory } from '@/core/services/StorageService';
import { StorageKeys } from '@/core/types/common';
import type { PluginScope } from '@/features/plugins/runtime/pluginScope';
import {
  type SendSite,
  type UserSend,
  readTurnKey,
  sendConversationKey,
  trackUserSends,
} from '@/features/plugins/sends/trackUserSends';
import { TimestampService } from '@/pages/content/timestamp/TimestampService';

import type { TimelineTimestampOwner } from '../../TimelineAdapter';
import type { ExtGlobal, SyncSettingsListener } from '../../types';
import {
  type TurnTimes,
  catalogSendConversationCap,
  pruneSite,
  readConversationTimes,
  readLegacySendTimes,
  recordSendTime,
  sendTimeOf,
} from './sendTimesStore';

/** Page-lifetime send times for one catalog site; each route's engine reads them through `ownerFor`. */
export class CatalogSendTimestamps {
  private enabled = false;
  /** Conversations read so far, as last read or written by this page. */
  private readonly times = new Map<string, TurnTimes>();
  /** This site's times an earlier build kept in Gemini's store, by unhashed turn key: shown, never rewritten. */
  private legacy = new Map<string, Map<string, number>>();
  private pruned = false;
  private readonly formatter = new TimestampService();
  private readonly ready: Promise<void>;
  /** One record at a time, so each reads the one before it and none is overwritten. */
  private recording: Promise<void> = Promise.resolve();

  constructor(
    private readonly scope: PluginScope,
    private readonly site: SendSite,
  ) {
    let settingChanged = false;
    scope.effect(() => {
      const g = globalThis as ExtGlobal;
      const onChanged = g.chrome?.storage?.onChanged ?? g.browser?.storage?.onChanged;
      if (!onChanged) return () => {};
      const listener: SyncSettingsListener = (changes, area) => {
        const change = changes[StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS];
        if (!change || (area !== 'sync' && area !== 'local')) return;
        settingChanged = true;
        this.enabled = change.newValue === true;
      };
      onChanged.addListener(listener);
      return () => onChanged.removeListener?.(listener);
    }, 'catalog-timeline:timestamp-setting');
    this.ready = (async () => {
      const [setting, legacy] = await Promise.all([
        StorageFactory.create('sync').get<boolean>(StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS),
        readLegacySendTimes(site.siteId),
      ]);
      this.legacy = legacy;
      // A live change can arrive while the first read is pending.
      if (!settingChanged) this.enabled = setting.success && setting.data === true;
    })().catch(() => {});
    trackUserSends(scope, site, (send) => {
      this.recording = this.recording.then(() => this.record(send)).catch(() => {});
    });
  }

  private async record({ conversationKey, turnKey, at }: UserSend): Promise<void> {
    await this.ready;
    if (this.scope.isDisposed || !this.enabled) return;
    if (this.legacy.get(conversationKey)?.has(turnKey)) return;
    const times = await recordSendTime(
      this.site.siteId,
      conversationKey,
      turnKey,
      at,
      () => !this.scope.isDisposed && this.enabled,
    );
    if (!times) return;
    this.times.set(conversationKey, times);
    if (this.pruned) return;
    // Once per page: pruning reads every listed conversation.
    this.pruned = true;
    await pruneSite(this.site.siteId, catalogSendConversationCap());
  }

  private load(conversationKey: string): void {
    if (this.times.has(conversationKey)) return;
    void readConversationTimes(conversationKey).then((times) => {
      // A send recorded meanwhile already holds the fresher read.
      if (!this.times.has(conversationKey)) this.times.set(conversationKey, times);
    });
  }

  /** The tooltip times for the conversation at `url`. */
  ownerFor(url: string): TimelineTimestampOwner {
    const conversationKey = sendConversationKey(this.site, url);
    if (conversationKey) this.load(conversationKey);
    const keyByMarker = new Map<string, string>();
    return {
      // The rail never waits for stored times; a tooltip shows whatever has loaded.
      init: () => Promise.resolve(),
      update: (_previous, next) => {
        // A marker keeps its element after the host unmounts it; read keys while it is in the page.
        for (const marker of next) {
          if (!marker.element.isConnected) continue;
          const key = readTurnKey(marker.element, this.site.turnKeyAttributes);
          if (key === null) keyByMarker.delete(marker.id);
          else keyByMarker.set(marker.id, key);
        }
      },
      formatTooltipTimestamp: (id) => {
        const key = keyByMarker.get(id);
        if (!this.enabled || !conversationKey || key === undefined) return null;
        const stored = this.times.get(conversationKey);
        const time =
          (stored ? sendTimeOf(stored, key) : null) ?? this.legacy.get(conversationKey)?.get(key);
        return time == null ? null : this.formatter.formatAbsoluteTime(time);
      },
      destroy: () => keyByMarker.clear(),
    };
  }
}
