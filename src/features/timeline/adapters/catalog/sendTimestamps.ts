/**
 * Send-time timestamps for a catalog timeline. A virtualized host mounts old
 * turns whenever the user scrolls, so first-seen stamping would date history
 * "now"; only a send `trackUserSends` reports is stamped, under the host's own
 * key for the turn it produced. Times live in the store Gemini's timeline uses
 * (`TimestampService`, `gvMessageTimestamps`), under `<site>:conv:<id>`, so no
 * Gemini conversation is touched. Recording and display follow the same
 * "message timestamps" setting as Gemini; the time shows in the dot's tooltip.
 */
import { StorageFactory } from '@/core/services/StorageService';
import { StorageKeys, type TurnId } from '@/core/types/common';
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

/** Page-lifetime send times for one catalog site; each route's engine reads them through `ownerFor`. */
export class CatalogSendTimestamps {
  private enabled = false;
  /** The latest read of the store; replaced by every record, which reads it afresh. */
  private times = new TimestampService();
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
      const [setting] = await Promise.all([
        StorageFactory.create('sync').get<boolean>(StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS),
        this.times.initialize(),
      ]);
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
    // Read afresh: another tab may have written since this page loaded.
    const times = new TimestampService();
    await times.initialize();
    if (this.scope.isDisposed || !this.enabled) return;
    if (times.getTimestamp(conversationKey, turnKey as TurnId) !== null) return;
    const write = times.recordTimestamp(conversationKey, turnKey as TurnId, at);
    // Shown at once; persisting finishes on its own.
    this.times = times;
    await write.catch(() => {});
  }

  /** The tooltip times for the conversation at `url`. */
  ownerFor(url: string): TimelineTimestampOwner {
    const conversationKey = sendConversationKey(this.site, url);
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
        const time = this.times.getTimestamp(conversationKey, key as TurnId);
        return time === null ? null : this.times.formatAbsoluteTime(time);
      },
      destroy: () => keyByMarker.clear(),
    };
  }
}
