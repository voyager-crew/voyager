import { useCallback, useEffect, useMemo, useState } from 'react';

import browser from 'webextension-polyfill';

import {
  NATIVE_HEALTH_GRACE_MS,
  NATIVE_HEALTH_STATUS_MESSAGE,
  type NativeHealthEntry,
  nativeHealthDismissKey,
  parseNativeHealthEntries,
} from '@/core/gemini/nativeHealth';
import { StorageKeys } from '@/core/types/common';

import type { CurrentTab } from './currentTab';

/**
 * A miss the page saw just before the popup opened becomes an entry only after the grace period,
 * so ask once more after a full grace period has passed.
 */
export const NATIVE_HEALTH_REPOLL_MS = NATIVE_HEALTH_GRACE_MS + 500;

function isGeminiTab(url: string): boolean {
  try {
    return new URL(url).hostname === 'gemini.google.com';
  } catch {
    return false;
  }
}

function readDismissed(value: unknown): Record<string, true> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, flag]) => flag === true),
  ) as Record<string, true>;
}

/**
 * Health entries of the active Gemini tab, read from its content script. The page owns the state,
 * so there is nothing stored to go stale; only dismissals persist, per extension version.
 */
export function useNativeHealth({
  activeUrl,
  requestTab,
}: Pick<CurrentTab, 'activeUrl' | 'requestTab'>) {
  const [entries, setEntries] = useState<NativeHealthEntry[]>([]);
  const [dismissed, setDismissed] = useState<Record<string, true> | null>(null);
  const onGemini = isGeminiTab(activeUrl);

  const refresh = useCallback(async () => {
    if (requestTab === null || !onGemini) {
      setEntries([]);
      return;
    }
    try {
      const response = (await requestTab({ type: NATIVE_HEALTH_STATUS_MESSAGE })) as
        | { ok?: boolean; entries?: unknown }
        | undefined;
      if (response?.ok) setEntries(parseNativeHealthEntries(response.entries));
    } catch {
      // No content script in this tab yet (still loading, or the extension was just reloaded).
    }
  }, [requestTab, onGemini]);

  useEffect(() => {
    void refresh();
    const later = setTimeout(() => void refresh(), NATIVE_HEALTH_REPOLL_MS);
    return () => clearTimeout(later);
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    browser.storage.local
      .get({ [StorageKeys.NATIVE_HEALTH_DISMISSED]: {} })
      .then((stored) => {
        if (!cancelled) setDismissed(readDismissed(stored[StorageKeys.NATIVE_HEALTH_DISMISSED]));
      })
      .catch(() => {
        if (!cancelled) setDismissed({});
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleEntries = useMemo(
    () =>
      dismissed === null
        ? []
        : entries.filter((entry) => dismissed[nativeHealthDismissKey(entry)] !== true),
    [dismissed, entries],
  );

  const dismiss = useCallback(() => {
    // Keep only this version's dismissals, so the map cannot grow across updates.
    const versions = new Set(visibleEntries.map((entry) => `@${entry.extensionVersion}`));
    const next: Record<string, true> = Object.fromEntries(
      Object.keys(dismissed ?? {})
        .filter((key) => Array.from(versions).some((version) => key.endsWith(version)))
        .map((key) => [key, true as const]),
    );
    for (const entry of visibleEntries) next[nativeHealthDismissKey(entry)] = true;
    setDismissed(next);
    void browser.storage.local.set({ [StorageKeys.NATIVE_HEALTH_DISMISSED]: next }).catch(() => {});
  }, [dismissed, visibleEntries]);

  return { entries, visibleEntries, dismiss };
}
