import React, { useState } from 'react';

import {
  CREATE_MODE_MESSAGES,
  parseCreateOutlineReply,
} from '@/features/plugins/local/creation/messages';
import type { TabRequester } from '@/pages/popup/hooks/currentTab';
import type { TranslationKey } from '@/utils/translations';

import { PanelSwitch } from '../components/PanelSwitch';
import { type PageFactState, usePageFact } from '../hooks/pageFact';

const SWITCH_ID = 'panel-create-structure';
/** The page may still be rendering right after it navigated. */
const OUTLINE_SETTLE_MS = 400;

type Translate = (key: TranslationKey) => string;

function outlineText(t: Translate, state: PageFactState<string>): string {
  switch (state.status) {
    case 'known':
      return state.fact;
    case 'unknown':
      return t('panelCreateStructureUnavailable');
    case 'idle':
    case 'settling':
    case 'asking':
      return t('panelCreateStructureReading');
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

/**
 * The Create tab's line about the page structure Voyager adds to a request:
 * its switch, on by default, and the exact text, read from the page while it
 * is open and again whenever the page moves.
 */
export function PageStructure({
  on,
  onToggle,
  pageUrl,
  requestTab,
  t,
}: {
  on: boolean;
  onToggle: (next: boolean) => void;
  pageUrl: string;
  requestTab: TabRequester;
  t: Translate;
}) {
  const [open, setOpen] = useState(false);
  const outline = usePageFact<string>(
    on && open ? pageUrl : null,
    async () => parseCreateOutlineReply(await requestTab({ type: CREATE_MODE_MESSAGES.outline })),
    OUTLINE_SETTLE_MS,
  );
  return (
    <div className="create-structure">
      <div className="create-structure-row">
        <PanelSwitch
          id={SWITCH_ID}
          checked={on}
          label={t('panelCreateStructure')}
          onToggle={onToggle}
        />
        <label htmlFor={SWITCH_ID} className="create-structure-label">
          {t('panelCreateStructure')}
        </label>
      </div>
      {on && (
        <details
          className="create-fold"
          open={open}
          onToggle={(event) => setOpen(event.currentTarget.open)}
        >
          <summary>{t('panelCreateStructureShow')}</summary>
          <pre className="create-code" dir="ltr" data-testid="page-structure">
            {outlineText(t, outline)}
          </pre>
        </details>
      )}
    </div>
  );
}
