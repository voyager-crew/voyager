/**
 * Send-time timestamps for a catalog timeline. A virtualized host mounts old
 * turns whenever the user scrolls, so first-seen stamping would date history
 * "now"; only a send `trackUserSends` reports is stamped, under the host's own
 * key for the turn it produced. Times live in per-conversation keys
 * (`sendTimesStore`), never in Gemini's store; the background writes them and
 * this page reads them, refreshing on storage changes. Recording and display follow
 * the same "message timestamps" setting as Gemini; the time shows in the
 * dot's tooltip and above the user's message in the thread (`InlineSendTimes`).
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
import { InlineSendTimes } from './inlineSendTimes';
import { requestSendTimeRecord } from './sendTimesMessages';
import {
  type TurnTimes,
  conversationTimesKey,
  parseConversationTimes,
  readConversationTimes,
  readLegacySendTimes,
  sendTimeOf,
} from './sendTimesStore';

/** Page-lifetime send times for one catalog site; each route's engine reads them through `ownerFor`. */
export class CatalogSendTimestamps {
  private enabled = false;
  /** Conversations read so far: every time this page has read, been sent or seen saved. */
  private readonly times = new Map<string, TurnTimes>();
  /** This site's times an earlier build kept in Gemini's store, by unhashed turn key: shown, never rewritten. */
  private legacy = new Map<string, Map<string, number>>();
  private readonly formatter = new TimestampService();
  private readonly ready: Promise<void>;
  /** The in-thread labels of each live route, redrawn when a time or the setting changes. */
  private readonly inline = new Set<InlineSendTimes>();

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
        // Another tab's send, or a prune, in a conversation this page shows.
        if (area === 'local') {
          for (const conversationKey of this.times.keys()) {
            const shard = changes[conversationTimesKey(conversationKey)];
            if (shard) this.merge(conversationKey, parseConversationTimes(shard.newValue));
          }
        }
        const change = changes[StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS];
        if (!change || (area !== 'sync' && area !== 'local')) return;
        settingChanged = true;
        this.enabled = change.newValue === true;
        this.renderInline();
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
      this.renderInline();
    })().catch(() => {});
    trackUserSends(scope, site, (send) => void this.record(send).catch(() => {}));
  }

  private async record({ conversationKey, turnKey, at }: UserSend): Promise<void> {
    await this.ready;
    if (this.scope.isDisposed || !this.enabled) return;
    if (this.legacy.get(conversationKey)?.has(turnKey)) return;
    const prefix = `${this.site.siteId}:conv:`;
    if (!conversationKey.startsWith(prefix)) return;
    // The background is the only writer: it serializes every tab's sends.
    const times = await requestSendTimeRecord({
      site: this.site.siteId,
      conversationId: conversationKey.slice(prefix.length),
      turnKey,
      sentAt: at,
    });
    if (times && !this.scope.isDisposed) this.merge(conversationKey, times);
  }

  /**
   * Adds `times` to what this page holds for the conversation. A stored turn's
   * time never changes, so a union is never wrong, while replacing would let a
   * reply or read taken before another tab's save hide that tab's time.
   */
  private merge(conversationKey: string, times: TurnTimes): void {
    const held = this.times.get(conversationKey);
    if (!held) this.times.set(conversationKey, new Map(times));
    else for (const [turn, time] of times) if (!held.has(turn)) held.set(turn, time);
    this.renderInline();
  }

  private renderInline(): void {
    for (const labels of this.inline) labels.render();
  }

  /** The formatted send time of `turnKey`, or `null` while the setting is off or none is held. */
  private label(conversationKey: string | null, turnKey: string): string | null {
    if (!this.enabled || !conversationKey) return null;
    const stored = this.times.get(conversationKey);
    const time =
      (stored ? sendTimeOf(stored, turnKey) : null) ??
      this.legacy.get(conversationKey)?.get(turnKey);
    return time == null ? null : this.formatter.formatAbsoluteTime(time);
  }

  private load(conversationKey: string): void {
    if (this.times.has(conversationKey)) return;
    // Held from the start, so a storage change that lands while the read is pending is kept.
    this.times.set(conversationKey, new Map());
    void readConversationTimes(conversationKey).then((times) => this.merge(conversationKey, times));
  }

  /** The tooltip and in-thread times for the conversation at `url`. */
  ownerFor(url: string): TimelineTimestampOwner {
    const conversationKey = sendConversationKey(this.site, url);
    const keyByMarker = new Map<string, string>();
    const inline = new InlineSendTimes(this.site.turnKeyAttributes, (key) =>
      this.label(conversationKey, key),
    );
    this.inline.add(inline);
    if (conversationKey) this.load(conversationKey);
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
        inline.update(next);
      },
      formatTooltipTimestamp: (id) => {
        const key = keyByMarker.get(id);
        return key === undefined ? null : this.label(conversationKey, key);
      },
      // The engine is destroyed when the timeline stops or the route changes.
      destroy: () => {
        keyByMarker.clear();
        this.inline.delete(inline);
        inline.destroy();
      },
    };
  }
}
