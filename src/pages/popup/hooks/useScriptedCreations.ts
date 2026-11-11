import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { StorageKeys } from '@/core/types/common';
import {
  createScriptedClient,
  extensionDetailsAddress,
  openExtensionDetails,
} from '@/features/plugins/scripted/client';
import type { ScriptedStatus } from '@/features/plugins/scripted/messages';
import { disableScripted, setScriptedStopped } from '@/features/plugins/scripted/state';
import type { ScriptedRunState } from '@/features/plugins/scripted/types';

export interface ScriptedCreationsOptions {
  /** Reload the page the popup or panel works on; omitted where there is none. */
  readonly reloadPage?: () => void;
  /**
   * A context created now, for a page that may predate the user's toggle
   * flip (the panel's hidden frame). Undefined when it could not answer.
   */
  readonly freshProbe?: () => Promise<ScriptedStatus | undefined>;
}

const WATCHED = [StorageKeys.PLUGIN_LOCAL_MANIFESTS, StorageKeys.PLUGIN_SCRIPTED_STATE];

/**
 * Scripted creations as the popup and the panel show them: availability, the
 * kill switch and each creation's run state, kept fresh from storage. The
 * setup card, the stop-all control and each row read this.
 */
export function useScriptedCreations({ reloadPage, freshProbe }: ScriptedCreationsOptions = {}) {
  const client = useMemo(() => createScriptedClient(), []);
  const [status, setStatus] = useState<ScriptedStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [stillOff, setStillOff] = useState(false);
  const [detailsAddress, setDetailsAddress] = useState<string | null>(null);
  const [stoppedHere, setStoppedHere] = useState(false);
  const run = useRef(0);

  const refresh = useCallback(
    async (kind: 'status' | 'recheck'): Promise<ScriptedStatus | null> => {
      const mine = (run.current += 1);
      const next = await client.refresh(kind).catch(() => null);
      if (mine === run.current && next) setStatus(next);
      return mine === run.current ? next : null;
    },
    [client],
  );

  useEffect(() => {
    void refresh('status');
    const onChanged = (changes: Record<string, unknown>, area: string): void => {
      if (area === 'local' && WATCHED.some((key) => Object.hasOwn(changes, key))) {
        void refresh('status');
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      run.current += 1;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, [refresh]);

  const recheck = useCallback(async (): Promise<void> => {
    setChecking(true);
    setStillOff(false);
    let next = await refresh('recheck');
    if (next?.availability.kind === 'toggle-off' && freshProbe) {
      const fresh = await freshProbe();
      if (fresh) {
        run.current += 1;
        setStatus(fresh);
        next = fresh;
      }
    }
    setStillOff(next?.availability.kind === 'toggle-off');
    setChecking(false);
  }, [freshProbe, refresh]);

  const openDetails = useCallback(async (): Promise<void> => {
    setDetailsAddress((await openExtensionDetails()) ? null : extensionDetailsAddress());
  }, []);

  const setStopped = useCallback(async (stopped: boolean): Promise<void> => {
    if (await setScriptedStopped(stopped)) setStoppedHere(stopped);
  }, []);

  const runStates = useMemo(
    () => new Map(status?.plugins.map((plugin) => [plugin.id, plugin.runState])),
    [status],
  );

  return {
    status,
    runState: (id: string): ScriptedRunState | undefined => runStates.get(id),
    checking,
    stillOff,
    detailsAddress,
    /** Stopped from this popup or panel, so the pages already open may still run them. */
    stoppedHere,
    recheck,
    openDetails,
    stopAll: () => setStopped(true),
    resume: () => setStopped(false),
    turnOff: (id: string) => disableScripted(id),
    reloadPage,
  };
}

export type ScriptedCreations = ReturnType<typeof useScriptedCreations>;
