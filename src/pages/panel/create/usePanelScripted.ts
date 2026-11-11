import { useMemo } from 'react';

import { SCRIPTED_RELOAD_PAGE_REQUEST } from '@/features/plugins/scripted/messages';
import type { TabRequester } from '@/pages/popup/hooks/currentTab';
import { useScriptedCreations } from '@/pages/popup/hooks/useScriptedCreations';

import { probeInFreshFrame } from './scriptedProbe';

/** Scripted creations in the panel: its page reloads through the tab relay, never `tabs`. */
export function usePanelScripted(requestTab: TabRequester | null) {
  const reloadPage = useMemo(
    () =>
      requestTab
        ? () => void requestTab({ type: SCRIPTED_RELOAD_PAGE_REQUEST }).catch(() => {})
        : undefined,
    [requestTab],
  );
  return useScriptedCreations({ reloadPage, freshProbe: probeInFreshFrame });
}
