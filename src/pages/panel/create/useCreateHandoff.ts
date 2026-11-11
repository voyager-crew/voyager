import { useState } from 'react';

import type { PanelContext } from '@/features/panel/protocol';
import { authoringSites } from '@/features/plugins/local/authoringSites';
import {
  CREATE_MODE_MESSAGES,
  type CreateStartRefusal,
  parseCreateStartReply,
} from '@/features/plugins/local/creation/messages';
import { buildAgentHandoff } from '@/features/plugins/local/creationMessage';
import type { TabRequester } from '@/pages/popup/hooks/currentTab';
import type { TranslationKey } from '@/utils/translations';

/** The last exit taken: refused by the page (or no answer), or a copy for a local agent. */
export type CreateHandoffOutcome =
  | { readonly kind: 'refused'; readonly reason: CreateStartRefusal | 'unavailable' }
  | { readonly kind: 'copied' }
  | { readonly kind: 'copyFailed'; readonly text: string };

/**
 * The Create view's sentence and its two exits for the page the panel sits on:
 * ask this page to open a new chat with the creation message (the panel then
 * closes so the user reads it), or copy a handoff for a local coding agent.
 */
export function useCreateHandoff({
  context,
  requestTab,
  close,
  t,
}: {
  context: PanelContext;
  requestTab: TabRequester | null;
  close: () => void;
  t: (key: TranslationKey) => string;
}) {
  const site = authoringSites().find((candidate) => candidate.id === context.siteId) ?? null;
  const [request, setRequestText] = useState('');
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<CreateHandoffOutcome | null>(null);
  const ready = site !== null && request.trim() !== '';

  const setRequest = (value: string): void => {
    setRequestText(value);
    setOutcome(null);
  };

  const createOnPage = async (): Promise<void> => {
    if (!ready || !requestTab || sending) return;
    setSending(true);
    setOutcome(null);
    let reply = null;
    try {
      reply = parseCreateStartReply(
        await requestTab({ type: CREATE_MODE_MESSAGES.start, request: request.trim() }),
      );
    } catch {
      reply = null;
    }
    setSending(false);
    if (reply?.ok) {
      setRequestText('');
      close();
      return;
    }
    setOutcome({ kind: 'refused', reason: reply?.reason ?? 'unavailable' });
  };

  const copyForAgent = async (): Promise<void> => {
    if (!site || !ready) return;
    const text = buildAgentHandoff(request, site, t);
    try {
      await navigator.clipboard.writeText(text);
      setOutcome({ kind: 'copied' });
    } catch {
      setOutcome({ kind: 'copyFailed', text });
    }
  };

  return { site, request, setRequest, ready, sending, outcome, createOnPage, copyForAgent };
}

export type CreateHandoff = ReturnType<typeof useCreateHandoff>;
