import { useCallback, useRef, useState } from 'react';

import type { TranslationKey } from '@/utils/translations';

import type { CurrentTab } from '../hooks/currentTab';

export type ContextSyncStatus =
  | { readonly kind: 'info' | 'ok'; readonly key: TranslationKey }
  | { readonly kind: 'err'; readonly message: string };

/** One Sync to IDE request and what it last reported. */
export interface ContextSyncRequest {
  readonly syncing: boolean;
  readonly status: ContextSyncStatus | null;
  readonly sync: () => void;
  /** Clear `shown` once it has been read, unless a newer status replaced it. */
  readonly dismiss: (shown: ContextSyncStatus) => void;
}

/** The page's answer: `success`, or why it could not send its context. */
function syncFailure(response: unknown): string | null {
  if (typeof response !== 'object' || response === null) return 'Unknown error';
  const { status, message } = response as { status?: unknown; message?: unknown };
  if (status === 'success') return null;
  return typeof message === 'string' && message ? message : 'Unknown error';
}

/**
 * The Context Sync request, owned by the Popup itself: a search that hides its
 * row or its whole card keeps a slow sync pending with its result, so its
 * button cannot start a second request meanwhile. A result
 * stays until the panel has shown it (the panel times its dismissal).
 */
export function useContextSyncRequest({
  requestTab,
}: Pick<CurrentTab, 'requestTab'>): ContextSyncRequest {
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<ContextSyncStatus | null>(null);
  const inFlight = useRef(false);

  const sync = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSyncing(true);
    setStatus({ kind: 'info', key: 'capturing' });
    void (async () => {
      try {
        if (!requestTab) throw new Error('No active tab found');
        const failure = syncFailure(await requestTab({ action: 'sync_to_ide' }));
        if (failure) throw new Error(failure);
        setStatus({ kind: 'ok', key: 'syncedSuccess' });
      } catch (error) {
        setStatus({ kind: 'err', message: (error as Error).message });
      } finally {
        inFlight.current = false;
        setSyncing(false);
      }
    })();
  }, [requestTab]);

  const dismiss = useCallback(
    (shown: ContextSyncStatus) => setStatus((current) => (current === shown ? null : current)),
    [],
  );

  return { syncing, status, sync, dismiss };
}
