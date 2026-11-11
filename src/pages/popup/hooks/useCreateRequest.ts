import { useState } from 'react';

import { authoringSiteForUrl, authoringSites } from '@/features/plugins/local/authoringSites';
import { buildAgentHandoff, buildCreationMessage } from '@/features/plugins/local/creationMessage';
import type { SiteAdapter } from '@/features/plugins/types';
import type { TranslationKey } from '@/utils/translations';

/** Who the copied text is for: the AI chat the user is on, or a coding agent on their machine. */
export type CreateCopyTarget = 'chat' | 'agent';

/** The last copy, and whether the clipboard took it; a refused copy shows `text` to select. */
export interface CreateCopyOutcome {
  readonly target: CreateCopyTarget;
  readonly text: string;
  readonly copied: boolean;
}

type CreateTranslate = (key: TranslationKey) => string;

const BUILDERS: Readonly<
  Record<CreateCopyTarget, (request: string, site: SiteAdapter, t: CreateTranslate) => string>
> = {
  chat: buildCreationMessage,
  agent: buildAgentHandoff,
};

/** The DOM id of the Create card's request field, which "Create your own" focuses. */
export const CREATE_REQUEST_INPUT_ID = 'gv-create-request';

/**
 * The Create card's one sentence and target site, and the text each copy
 * button hands over. The site starts as the active tab's; with no supported
 * tab the picker shows a default that nothing is compared against until the
 * user picks one.
 */
export function useCreateRequest(activeUrl: string | undefined, t: CreateTranslate) {
  const sites = authoringSites();
  const [request, setRequestText] = useState('');
  const [picked, setPicked] = useState(() => {
    const activeSite = authoringSiteForUrl(activeUrl);
    return { id: activeSite?.id ?? sites[0]?.id ?? '', chosen: activeSite !== null };
  });
  const [outcome, setOutcome] = useState<CreateCopyOutcome | null>(null);

  const site = sites.find((candidate) => candidate.id === picked.id) ?? null;

  const setRequest = (value: string): void => {
    setRequestText(value);
    setOutcome(null);
  };

  const pickSite = (id: string): void => {
    setPicked({ id, chosen: true });
    setOutcome(null);
  };

  const copy = async (target: CreateCopyTarget): Promise<void> => {
    if (!site || request.trim() === '') return;
    const text = BUILDERS[target](request, site, t);
    try {
      await navigator.clipboard.writeText(text);
      setOutcome({ target, text, copied: true });
    } catch {
      setOutcome({ target, text, copied: false });
    }
  };

  return {
    sites,
    request,
    setRequest,
    siteId: picked.id,
    pickSite,
    /** The site a pasted reply is compared with: only one the tab or the user chose. */
    targetSite: picked.chosen ? site : null,
    canCopy: site !== null && request.trim() !== '',
    copy,
    outcome,
  };
}
