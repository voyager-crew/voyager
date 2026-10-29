import { createToaster } from '@/core/ui/toast/toaster';
import type { ToastHandle, ToastTone } from '@/core/ui/toast/types';
import { getTranslationSyncUnsafe } from '@/utils/i18n';

import { getFolderRecoveryNotice } from './folderRecoveryNotice';

const BATCH_DELETE_CHANNEL = 'batch-delete';
const NOTICE_MS = 3000;
/** Warnings and errors about the folder data stay longer than a passing notice. */
export const LEVEL_MS = { info: 3000, warning: 7000, error: 10000 } as const;

const batchDeleteMessage = (current: number, total: number): string =>
  getTranslationSyncUnsafe('batch_delete_in_progress')
    .replace('{current}', String(current))
    .replace('{total}', String(total));

/** Owns the folder notices, the batch delete progress and the title tooltip. */
export class FolderFeedback {
  private tooltipElement: HTMLElement | null = null;
  private tooltipTimeout: number | null = null;
  private readonly toaster = createToaster();
  private batchDeleteProgress: ToastHandle | null = null;
  private readonly timers = new Set<number>();
  /** Bumped by each notice on a channel, so only its latest handle can change it. */
  private readonly channelTurns = new Map<string, number>();

  constructor() {
    this.createTooltip();
  }

  destroy(): void {
    this.hideTooltip();
    this.tooltipElement?.remove();
    this.tooltipElement = null;
    this.toaster.destroy();
    this.batchDeleteProgress = null;
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers.clear();
  }

  private schedule(callback: () => void, delay: number): number {
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, delay);
    this.timers.add(timer);
    return timer;
  }

  showBatchDeleteProgress(current: number, total: number): void {
    this.batchDeleteProgress = this.toaster.show({
      message: batchDeleteMessage(current, total),
      pending: true,
      durationMs: null,
      channel: BATCH_DELETE_CHANNEL,
    });
  }

  updateBatchDeleteProgress(current: number, total: number): void {
    if (this.batchDeleteProgress?.isOpen) {
      this.batchDeleteProgress.update({ message: batchDeleteMessage(current, total) });
    }
  }

  hideBatchDeleteProgress(): void {
    this.batchDeleteProgress?.dismiss();
    this.batchDeleteProgress = null;
  }

  showRecoveryNotification(result: Parameters<typeof getFolderRecoveryNotice>[0]): void {
    const { message, tone } = getFolderRecoveryNotice(result);
    this.showNotificationByLevel(message, tone);
  }

  showNotificationByLevel(message: string, level: 'info' | 'warning' | 'error' = 'error'): void {
    this.toaster.show({ message, tone: level, durationMs: LEVEL_MS[level] });
  }

  /**
   * A notice on an open `channel` replaces it, so a transfer's result takes its
   * progress's place. The handle goes quiet once a later notice takes the channel.
   * Typed `| void` so a stand-in that only shows the message still fits.
   */
  showNotification(
    message: string,
    tone: ToastTone = 'info',
    channel?: string,
  ): ToastHandle | void {
    const handle = this.toaster.show({ message, tone, durationMs: NOTICE_MS, channel });
    if (!channel) return handle;
    const turn = (this.channelTurns.get(channel) ?? 0) + 1;
    this.channelTurns.set(channel, turn);
    const latest = () => this.channelTurns.get(channel) === turn;
    return {
      get isOpen() {
        return latest() && handle.isOpen;
      },
      update: (patch) => {
        if (latest()) handle.update(patch);
      },
      dismiss: () => {
        if (latest()) handle.dismiss();
      },
    };
  }

  private createTooltip(): void {
    this.tooltipElement = document.createElement('div');
    this.tooltipElement.className = 'gv-tooltip';
    document.body.appendChild(this.tooltipElement);
  }

  showTooltip(element: HTMLElement, text: string, showWhenNotTruncated = false): void {
    if (!this.tooltipElement) return;

    // Clear any existing timeout
    if (this.tooltipTimeout) {
      clearTimeout(this.tooltipTimeout);
      this.timers.delete(this.tooltipTimeout);
    }

    // Check if text is truncated
    const isTruncated = element.scrollWidth > element.clientWidth;
    if (!showWhenNotTruncated && !isTruncated) return;

    // Show tooltip after a short delay (200ms)
    this.tooltipTimeout = this.schedule(() => {
      this.tooltipTimeout = null;
      if (!this.tooltipElement) return;

      this.tooltipElement.textContent = text;

      // Position tooltip
      const rect = element.getBoundingClientRect();
      const tooltipRect = this.tooltipElement.getBoundingClientRect();

      let left = rect.left;
      let top = rect.bottom + 8;

      // Adjust if tooltip goes off screen
      if (left + tooltipRect.width > window.innerWidth) {
        left = window.innerWidth - tooltipRect.width - 10;
      }
      if (top + tooltipRect.height > window.innerHeight) {
        top = rect.top - tooltipRect.height - 8;
      }

      this.tooltipElement.style.left = `${left}px`;
      this.tooltipElement.style.top = `${top}px`;

      // Trigger reflow for animation
      // oxlint-disable-next-line no-unused-expressions -- reading offsetHeight flushes layout; the value is intentionally discarded
      this.tooltipElement.offsetHeight;
      this.tooltipElement.classList.add('show');
    }, 200);
  }

  hideTooltip(): void {
    if (this.tooltipTimeout) {
      clearTimeout(this.tooltipTimeout);
      this.timers.delete(this.tooltipTimeout);
      this.tooltipTimeout = null;
    }
    if (this.tooltipElement) {
      this.tooltipElement.classList.remove('show');
    }
  }
}
