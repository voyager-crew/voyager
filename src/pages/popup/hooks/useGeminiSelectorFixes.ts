import { useCallback, useEffect, useRef, useState } from 'react';

import browser from 'webextension-polyfill';

import { GEMINI_SELECTOR_HOSTS } from '@/core/gemini/selectors/types';
import { StorageKeys } from '@/core/types/common';
import { readGeminiSelectorResponse } from '@/features/geminiSelectorFixes/messages';
import { geminiSelectorHostFromUrl } from '@/features/geminiSelectorFixes/policy';
import { type Machine, startMachine } from '@/features/plugins/runtime/stateMachine';

import {
  type FixesEvent,
  type FixesRequest,
  type FixesState,
  INITIAL_FIXES_STATE,
  createGeminiSelectorFixesEffects,
  geminiSelectorFixesTransition,
} from './geminiSelectorFixesMachine';

interface SourceTab {
  activeTabContextLoaded: boolean;
  activeTabContextResolved: boolean;
  activeUrl: string;
  activeTabId: number | null;
}

interface SelectorFixesView {
  target: string;
  state: FixesState;
  /** Away from Gemini the card appears only while ON; it stays after the user turns it off. */
  seenOn: boolean;
}

/** Away from a Gemini tab the popup can still read consent and turn it off, nothing else. */
const ELSEWHERE = 'elsewhere';

const OPERATIONS = {
  loading: 'loading',
  saving: 'saving',
  checking: 'checking',
  idle: null,
} as const;

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
  const [view, setView] = useState<SelectorFixesView | null>(null);
  const machine = useRef<Machine<FixesState, FixesEvent> | null>(null);

  const request = useCallback<FixesRequest>(
    async (type, extra = {}) => {
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
    [host, onGemini, tabId],
  );

  useEffect(() => {
    if (!target) return;
    // One machine per source tab: a new target drops every reply the old one still awaits.
    const fixes = startMachine<FixesState, FixesEvent>(
      {
        id: 'geminiSelectorFixesPopup',
        transition: geminiSelectorFixesTransition(onGemini),
        effects: createGeminiSelectorFixesEffects(request),
      },
      INITIAL_FIXES_STATE,
    );
    let seenOn = false;
    const publish = (state: FixesState) => {
      seenOn ||= state.channel?.enabled === true;
      setView({ target, state, seenOn });
    };
    publish(fixes.state);
    fixes.subscribe(publish);
    machine.current = fixes;
    const onChanged = (changes: Record<string, browser.Storage.StorageChange>, area: string) => {
      if (area !== 'local' || !Object.hasOwn(changes, StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES))
        return;
      const enabled = changes[StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES].newValue === true;
      fixes.send({ type: 'consentChanged', enabled });
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => {
      if (machine.current === fixes) machine.current = null;
      browser.storage.onChanged.removeListener(onChanged);
      void fixes.stop();
    };
  }, [onGemini, request, target]);

  const setEnabled = useCallback(async (enabled: boolean) => {
    machine.current?.send({ type: 'setEnabled', enabled });
  }, []);

  const checkNow = useCallback(async () => {
    machine.current?.send({ type: 'checkNow' });
  }, []);

  const current = view?.target === target ? view : null;
  return {
    visible: onGemini || (target !== '' && current?.seenOn === true),
    /** Turning on and checking need the Gemini tab the request will be checked against. */
    canTurnOn: onGemini,
    channel: current?.state.channel ?? null,
    // A completed operation is null; only an absent view is still loading.
    operation: current ? OPERATIONS[current.state.status] : target ? 'loading' : null,
    error: current?.state.error ?? null,
    setEnabled,
    checkNow,
  };
}

export type GeminiSelectorFixesControl = ReturnType<typeof useGeminiSelectorFixes>;
