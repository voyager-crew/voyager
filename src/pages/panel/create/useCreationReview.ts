import { useEffect, useMemo, useRef } from 'react';

import type { PanelContext } from '@/features/panel/protocol';
import { authoringSites } from '@/features/plugins/local/authoringSites';
import {
  CREATE_MODE_MESSAGES,
  parseCreatePendingReply,
} from '@/features/plugins/local/creation/messages';
import { previewPlugin } from '@/features/plugins/local/pluginPreview';
import { checkPluginReply } from '@/features/plugins/local/pluginReply';
import { startMachine } from '@/features/plugins/runtime/stateMachine';
import type { TabRequester } from '@/pages/popup/hooks/currentTab';

import { useMachine } from '../sync/useMachine';
import { installReviewed, turnOnInstalled } from './installReviewed';
import {
  REVIEW_IDLE,
  type ReviewEvent,
  type ReviewState,
  reviewEffects,
  reviewTransition,
} from './reviewMachine';

/**
 * The review of a reply the user picked on the page. Each bump of
 * `context.creationRequest` (the shell's authenticated context, never a window
 * message) fetches the pick once and checks it again; `onReview` brings the
 * Create tab forward.
 */
export function useCreationReview({
  context,
  requestTab,
  onReview,
}: {
  context: PanelContext;
  requestTab: TabRequester | null;
  onReview: () => void;
}) {
  const page = useRef({ context, requestTab });
  const review = useRef(onReview);
  useEffect(() => {
    page.current = { context, requestTab };
    review.current = onReview;
  });
  const [state, send] = useMachine<ReviewState, ReviewEvent>(
    () =>
      startMachine<ReviewState, ReviewEvent>(
        {
          id: 'panelCreationReview',
          transition: reviewTransition,
          effects: reviewEffects({
            fetchPending: async () => {
              const ask = page.current.requestTab;
              const candidate = ask
                ? parseCreatePendingReply(await ask({ type: CREATE_MODE_MESSAGES.pending }))
                : null;
              if (candidate) review.current();
              return candidate;
            },
            check: (text) => checkPluginReply(text),
            install: (checked) => installReviewed(checked, page.current.context.pageUrl),
            turnOn: (manifest) => turnOnInstalled(manifest, page.current.context.pageUrl),
          }),
        },
        REVIEW_IDLE,
      ),
    REVIEW_IDLE,
  );

  const { creationRequest } = context;
  useEffect(() => {
    if (creationRequest) send({ type: 'request' });
  }, [creationRequest, send]);

  const site = authoringSites().find((candidate) => candidate.id === context.siteId) ?? null;
  const preview = useMemo(
    () =>
      state.status === 'reviewing'
        ? previewPlugin(state.checked.manifest, {
            previousVersion: state.checked.previousVersion,
            targetSite: site,
          })
        : null,
    [site, state],
  );

  return { state, send, preview };
}

export type CreationReview = ReturnType<typeof useCreationReview>;
