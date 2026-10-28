import {
  STORAGE_QUOTA_CRITICAL_RATIO,
  STORAGE_QUOTA_WARNING_RATIO,
  getStorageQuotaEffectiveUsageRatio,
  storageQuotaService,
} from '@/core/services/StorageQuotaService';
import { StorageKeys } from '@/core/types/common';
import { packagedSiteForUrl } from '@/features/plugins/sites/hostPolicy';

export type StorageQuotaWarningLevel = 'normal' | 'warning' | 'critical';

export interface StorageQuotaWarningPayload {
  level: Exclude<StorageQuotaWarningLevel, 'normal'>;
  percent: number;
}

interface StorageQuotaWarningDependencies {
  getUsageRatio?: () => Promise<number | null>;
  readLevel?: () => Promise<StorageQuotaWarningLevel>;
  writeLevel?: (level: StorageQuotaWarningLevel) => Promise<void>;
  deliverWarning?: (
    payload: StorageQuotaWarningPayload,
    preferredTabId?: number,
  ) => Promise<boolean>;
  now?: () => number;
}

interface StorageQuotaWarningTransition {
  nextLevel: StorageQuotaWarningLevel;
  notify: Exclude<StorageQuotaWarningLevel, 'normal'> | null;
}

const WARNING_RESET_RATIO = 0.75;
const CRITICAL_RESET_RATIO = 0.9;
const STORAGE_CHANGE_DEBOUNCE_MS = 1_000;
const MIN_CHECK_INTERVAL_MS = 30_000;

function isWarningLevel(value: unknown): value is StorageQuotaWarningLevel {
  return value === 'normal' || value === 'warning' || value === 'critical';
}

function isSupportedWarningTarget(url: string | undefined): boolean {
  if (!url) return false;
  return packagedSiteForUrl(url) !== null;
}

export function resolveStorageQuotaWarningTransition(
  storedLevel: StorageQuotaWarningLevel,
  usageRatio: number,
): StorageQuotaWarningTransition {
  let level = storedLevel;

  // Hysteresis prevents small writes and cleanups around a boundary from
  // repeatedly re-arming the same toast.
  if (level === 'critical' && usageRatio < CRITICAL_RESET_RATIO) {
    level = usageRatio >= WARNING_RESET_RATIO ? 'warning' : 'normal';
  }
  if (level === 'warning' && usageRatio < WARNING_RESET_RATIO) {
    level = 'normal';
  }

  if (usageRatio >= STORAGE_QUOTA_CRITICAL_RATIO && level !== 'critical') {
    return { nextLevel: 'critical', notify: 'critical' };
  }
  if (usageRatio >= STORAGE_QUOTA_WARNING_RATIO && level === 'normal') {
    return { nextLevel: 'warning', notify: 'warning' };
  }
  return { nextLevel: level, notify: null };
}

async function getUsageRatio(): Promise<number | null> {
  return getStorageQuotaEffectiveUsageRatio(await storageQuotaService.getSnapshot());
}

async function readLevel(): Promise<StorageQuotaWarningLevel> {
  try {
    const result = await chrome.storage.local.get({
      [StorageKeys.STORAGE_QUOTA_WARNING_LEVEL]: 'normal',
    });
    const value = result[StorageKeys.STORAGE_QUOTA_WARNING_LEVEL];
    return isWarningLevel(value) ? value : 'normal';
  } catch {
    return 'normal';
  }
}

async function writeLevel(level: StorageQuotaWarningLevel): Promise<void> {
  try {
    await chrome.storage.local.set({ [StorageKeys.STORAGE_QUOTA_WARNING_LEVEL]: level });
  } catch {
    // Warning state must never interfere with normal extension storage writes.
  }
}

async function sendToTab(tabId: number, payload: StorageQuotaWarningPayload): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'gv.storageQuota.warning',
      payload,
    });
    return true;
  } catch {
    return false;
  }
}

async function deliverWarning(
  payload: StorageQuotaWarningPayload,
  preferredTabId?: number,
): Promise<boolean> {
  if (typeof preferredTabId === 'number' && (await sendToTab(preferredTabId, payload))) {
    return true;
  }

  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    for (const tab of tabs) {
      if (
        typeof tab.id === 'number' &&
        tab.id !== preferredTabId &&
        isSupportedWarningTarget(tab.url) &&
        (await sendToTab(tab.id, payload))
      ) {
        return true;
      }
    }
  } catch {
    // A visible content script will request another check when it becomes active.
  }
  return false;
}

export class StorageQuotaWarningBackgroundService {
  private readonly getUsageRatio: () => Promise<number | null>;
  private readonly readLevel: () => Promise<StorageQuotaWarningLevel>;
  private readonly writeLevel: (level: StorageQuotaWarningLevel) => Promise<void>;
  private readonly deliverWarning: (
    payload: StorageQuotaWarningPayload,
    preferredTabId?: number,
  ) => Promise<boolean>;
  private readonly now: () => number;
  private checkPromise: Promise<void> | null = null;
  private checkTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCheckedAt = 0;
  private pendingPreferredTabId: number | undefined;
  private started = false;

  constructor(dependencies: StorageQuotaWarningDependencies = {}) {
    this.getUsageRatio = dependencies.getUsageRatio ?? getUsageRatio;
    this.readLevel = dependencies.readLevel ?? readLevel;
    this.writeLevel = dependencies.writeLevel ?? writeLevel;
    this.deliverWarning = dependencies.deliverWarning ?? deliverWarning;
    this.now = dependencies.now ?? (() => Date.now());
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    chrome.storage?.onChanged?.addListener?.((changes, areaName) => {
      if (areaName !== 'local' && areaName !== 'sync') return;
      const changedKeys = Object.keys(changes);
      if (changedKeys.length === 1 && changedKeys[0] === StorageKeys.STORAGE_QUOTA_WARNING_LEVEL) {
        return;
      }
      this.scheduleCheck();
    });

    chrome.runtime?.onMessage?.addListener?.((message, sender, sendResponse) => {
      if ((message as { type?: unknown } | null)?.type !== 'gv.storageQuota.ready') return;
      const preferredTabId = sender.tab?.id;
      if (this.lastCheckedAt === 0 || this.now() - this.lastCheckedAt >= MIN_CHECK_INTERVAL_MS) {
        void this.checkNow(preferredTabId);
      } else {
        this.scheduleCheck(preferredTabId);
      }
      sendResponse({ ok: true });
    });

    void this.checkNow();
  }

  scheduleCheck(preferredTabId?: number): void {
    if (typeof preferredTabId === 'number') this.pendingPreferredTabId = preferredTabId;
    if (this.checkTimer) clearTimeout(this.checkTimer);
    const elapsed = this.now() - this.lastCheckedAt;
    const delay = Math.max(STORAGE_CHANGE_DEBOUNCE_MS, MIN_CHECK_INTERVAL_MS - elapsed);
    this.checkTimer = setTimeout(() => {
      this.checkTimer = null;
      void this.checkNow();
    }, delay);
  }

  async checkNow(preferredTabId?: number): Promise<void> {
    if (typeof preferredTabId === 'number') this.pendingPreferredTabId = preferredTabId;
    if (this.checkPromise) return await this.checkPromise;
    const targetTabId = this.pendingPreferredTabId;
    this.pendingPreferredTabId = undefined;
    this.checkPromise = this.performCheck(targetTabId).finally(() => {
      this.lastCheckedAt = this.now();
      this.checkPromise = null;
      const queuedTabId = this.pendingPreferredTabId;
      if (typeof queuedTabId === 'number') void this.checkNow(queuedTabId);
    });
    await this.checkPromise;
  }

  private async performCheck(preferredTabId?: number): Promise<void> {
    try {
      const usageRatio = await this.getUsageRatio();
      if (usageRatio === null || !Number.isFinite(usageRatio)) return;

      const storedLevel = await this.readLevel();
      const transition = resolveStorageQuotaWarningTransition(storedLevel, usageRatio);
      if (!transition.notify) {
        if (transition.nextLevel !== storedLevel) await this.writeLevel(transition.nextLevel);
        return;
      }

      const delivered = await this.deliverWarning(
        {
          level: transition.notify,
          percent: Math.max(0, Math.round(usageRatio * 100)),
        },
        preferredTabId,
      );
      // Do not consume the one-time warning until a page actually received it.
      if (delivered) await this.writeLevel(transition.nextLevel);
    } catch (error) {
      console.warn('[StorageQuota] Background warning check failed:', error);
    }
  }
}

export function startStorageQuotaWarningBackgroundService(): StorageQuotaWarningBackgroundService {
  const service = new StorageQuotaWarningBackgroundService();
  service.start();
  return service;
}
