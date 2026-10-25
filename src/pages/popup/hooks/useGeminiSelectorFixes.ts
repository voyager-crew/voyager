import { useCallback, useEffect, useRef, useState } from 'react';

import browser from 'webextension-polyfill';

import { GEMINI_SELECTOR_HOSTS } from '@/core/gemini/selectors/types';
import { StorageKeys } from '@/core/types/common';
import {
  GEMINI_SELECTOR_REFRESH_MESSAGE,
  GEMINI_SELECTOR_SET_ENABLED_MESSAGE,
  GEMINI_SELECTOR_STATUS_MESSAGE,
  type GeminiSelectorResponse,
  readGeminiSelectorResponse,
} from '@/features/geminiSelectorFixes/messages';
import { geminiSelectorHostFromUrl } from '@/features/geminiSelectorFixes/policy';

interface SourceTab {
  activeTabContextLoaded: boolean;
  activeTabContextResolved: boolean;
  activeUrl: string;
  activeTabId: number | null;
}

type ChannelStatus = Extract<GeminiSelectorResponse, { ok: true }>;
type Operation = 'loading' | 'saving' | 'checking' | null;

interface SelectorFixesState {
  target: string;
  channel: ChannelStatus | null;
  operation: Operation;
  error: 'check' | 'save' | null;
  /** Away from Gemini the card appears only while ON; it stays after the user turns it off. */
  seenOn?: boolean;
}

/** Away from a Gemini tab the popup can still read consent and turn it off, nothing else. */
const ELSEWHERE = 'elsewhere';

/** The background owns consent and requests; this hook owns only the popup's view. */
export function useGeminiSelectorFixes(tab: SourceTab, sourceTabId?: number) {
  // The tab hook starts with a Gemini platform placeholder. Only its resolved HTTPS URL is proof.
  const sourceMatches = sourceTabId === undefined || tab.activeTabId === sourceTabId;
  const host =
    tab.activeTabContextLoaded && tab.activeTabContextResolved && sourceMatches
      ? geminiSelectorHostFromUrl(tab.activeUrl)
      : undefined;
  const tabId = tab.activeTabId;
  const onGemini = host !== undefined && tabId !== null;
  const target = onGemini ? `${host}:${tabId}` : tab.activeTabContextLoaded ? ELSEWHERE : '';
  const [state, setState] = useState<SelectorFixesState>({
    target: '',
    channel: null,
    operation: null,
    error: null,
  });
  const current = useRef(state);
  const requestVersion = useRef(0);
  const pendingSetting = useRef<{ version: number; enabled: boolean } | null>(null);

  const update = useCallback((next: SelectorFixesState) => {
    const previous = current.current;
    const seenOn =
      (previous.target === next.target && previous.seenOn === true) ||
      next.channel?.enabled === true;
    current.current = { ...next, seenOn };
    setState(current.current);
  }, []);

  const request = useCallback(
    async (type: string, extra: { enabled?: boolean; force?: boolean } = {}) => {
      if (!target) return null;
      // Without a Gemini source tab the background admits only status reads and OFF.
      const message = onGemini
        ? { type, host, tabId, ...extra }
        : { type, host: GEMINI_SELECTOR_HOSTS[0], ...extra };
      try {
        const result: unknown = await browser.runtime.sendMessage(message);
        return readGeminiSelectorResponse(result);
      } catch {
        return null;
      }
    },
    [host, onGemini, tabId, target],
  );

  const refresh = useCallback(
    async (version: number, force: boolean) => {
      const before = current.current;
      if (
        !onGemini ||
        before.target !== target ||
        !before.channel?.enabled ||
        !before.channel.buildEnabled
      )
        return;
      update({ ...before, operation: 'checking', error: null });
      const response = await request(GEMINI_SELECTOR_REFRESH_MESSAGE, { force });
      if (version !== requestVersion.current) return;
      update({
        ...current.current,
        channel: response?.ok ? response : current.current.channel,
        operation: null,
        error: response?.ok ? null : 'check',
      });
    },
    [onGemini, request, target, update],
  );

  const readStatus = useCallback(
    async (checkWhenEnabled: boolean) => {
      const version = ++requestVersion.current;
      const previous = current.current.target === target ? current.current.channel : null;
      update({ target, channel: previous, operation: 'loading', error: null });
      const response = await request(GEMINI_SELECTOR_STATUS_MESSAGE);
      if (version !== requestVersion.current) return;
      update({
        target,
        channel: response?.ok ? response : previous,
        operation: null,
        error: response?.ok ? null : 'check',
      });
      if (response?.ok && checkWhenEnabled) await refresh(version, false);
    },
    [refresh, request, target, update],
  );

  useEffect(() => {
    if (!target) return;
    void readStatus(true);
    const onChanged = (changes: Record<string, browser.Storage.StorageChange>, area: string) => {
      if (area !== 'local' || !Object.hasOwn(changes, StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES))
        return;
      const enabled = changes[StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES].newValue === true;
      const observed = current.current;
      if (observed.target === target && observed.channel) {
        // A failed follow-up read cannot undo consent that storage already confirmed.
        update({
          ...observed,
          channel: {
            ...observed.channel,
            enabled,
            cachedRevision: enabled ? observed.channel.cachedRevision : null,
          },
        });
      }
      // Our writer still has to finish cache deletion; the consent event alone is not its ack.
      if (
        pendingSetting.current?.enabled === enabled &&
        pendingSetting.current.version === requestVersion.current
      )
        return;
      // A second popup can turn the channel off during a check. Supersede that reply immediately.
      void readStatus(enabled);
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => {
      requestVersion.current++;
      pendingSetting.current = null;
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, [readStatus, target, update]);

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      const before = current.current;
      if (
        !target ||
        (enabled && !onGemini) ||
        before.target !== target ||
        !before.channel?.buildEnabled ||
        before.operation === 'saving' ||
        before.operation === 'loading'
      )
        return;
      const version = ++requestVersion.current;
      pendingSetting.current = { version, enabled };
      update({ ...before, operation: 'saving', error: null });
      const response = await request(GEMINI_SELECTOR_SET_ENABLED_MESSAGE, { enabled });
      if (version !== requestVersion.current) {
        if (pendingSetting.current?.version === version) pendingSetting.current = null;
        return;
      }
      // Consent can be durable even if removing the cache failed. Show that state and the error.
      const reconciled = response?.ok ? response : await request(GEMINI_SELECTOR_STATUS_MESSAGE);
      if (pendingSetting.current?.version === version) pendingSetting.current = null;
      if (version !== requestVersion.current) return;
      update({
        ...current.current,
        channel: reconciled?.ok ? reconciled : current.current.channel,
        operation: null,
        error: response?.ok ? null : 'save',
      });
      if (response?.ok && enabled) await refresh(version, false);
    },
    [onGemini, refresh, request, target, update],
  );

  const checkNow = useCallback(async () => {
    const before = current.current;
    if (before.target !== target || before.operation !== null || !before.channel?.enabled) return;
    await refresh(++requestVersion.current, true);
  }, [refresh, target]);

  const view = state.target === target ? state : null;
  return {
    visible: onGemini || (target !== '' && view?.seenOn === true),
    /** Turning on and checking need the Gemini tab the request will be checked against. */
    canTurnOn: onGemini,
    channel: view?.channel ?? null,
    // A completed operation is null; only an absent view is still loading.
    operation: view ? view.operation : target ? 'loading' : null,
    error: view?.error ?? null,
    setEnabled,
    checkNow,
  };
}

export type GeminiSelectorFixesControl = ReturnType<typeof useGeminiSelectorFixes>;
