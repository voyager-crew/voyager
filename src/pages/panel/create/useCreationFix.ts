import { useCallback } from 'react';

import {
  CREATION_CHECK_MESSAGES,
  type CreationProblem,
} from '@/features/plugins/local/creation/creationChecks';
import { parseCreateStartReply } from '@/features/plugins/local/creation/messages';
import type { TabRequester } from '@/pages/popup/hooks/currentTab';
import type { UndoOffer, WithdrawUndoOffer } from '@/pages/popup/hooks/useUndoToast';
import type { TranslationKey } from '@/utils/translations';

export type AskFix = (id: string, problem: CreationProblem) => void;

/**
 * My creations' "Ask it to fix": the page opens a new chat and fills it with
 * what it showed and the plugin as installed, the same way "Create on this
 * page" does, and the panel closes so the user reads it. Null where there is
 * no page to ask.
 */
export function useCreationFix({
  requestTab,
  structure,
  close,
  toast,
  t,
}: {
  requestTab: TabRequester | null;
  /** The Create tab's page-structure switch. */
  structure: boolean;
  close: () => void;
  toast: (offer: UndoOffer) => WithdrawUndoOffer;
  t: (key: TranslationKey) => string;
}): AskFix | null {
  const ask = useCallback<AskFix>(
    (id, problem) => {
      if (!requestTab) return;
      void requestTab({ type: CREATION_CHECK_MESSAGES.fix, id, problem, structure })
        .then(parseCreateStartReply, () => null)
        .then((reply) => {
          if (reply?.ok) close();
          else
            toast({
              message: t(
                reply?.reason === 'busy' ? 'createModeComposerBusy' : 'panelCreateUnavailable',
              ),
              tone: 'error',
            });
        });
    },
    [close, requestTab, structure, t, toast],
  );
  return requestTab ? ask : null;
}
