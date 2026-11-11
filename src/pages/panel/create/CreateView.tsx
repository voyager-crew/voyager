import React from 'react';

import { MAX_PLUGIN_REQUEST_CHARS } from '@/features/plugins/local/authoringSites';
import { ScriptedStopAll } from '@/pages/popup/components/scripted/ScriptedStopAll';
import type { ScriptedCreations } from '@/pages/popup/hooks/useScriptedCreations';
import type { TranslationKey } from '@/utils/translations';

import { PANEL_SCRIPTED_LOOK } from './scriptedLook';
import type { CreateHandoff, CreateHandoffOutcome } from './useCreateHandoff';

export const CREATE_REQUEST_ID = 'panel-create-request';

type Translate = (key: TranslationKey) => string;

function statusText(t: Translate, outcome: CreateHandoffOutcome | null): string {
  if (!outcome) return t('panelCreateHint');
  switch (outcome.kind) {
    case 'refused':
      return outcome.reason === 'busy' ? t('createModeComposerBusy') : t('panelCreateUnavailable');
    case 'copied':
      return t('createModeAgentHint')
        .replace('{more}', () => t('createModeMoreWays'))
        .replace('{importFiles}', () => t('localPluginsImportFiles'));
    case 'copyFailed':
      return t('localPluginDescribeCopyFailed');
  }
}

/**
 * The 创造 tab: one sentence, then "Create on this page" (a new chat here,
 * filled and left for the user to send) or a copy for a local coding agent.
 * `children` is the review of a reply the user chose on the page, if any;
 * the kill switch for creations that run code closes the tab.
 */
export function CreateView({
  handoff,
  scripted,
  t,
  children,
}: {
  handoff: CreateHandoff;
  scripted: ScriptedCreations;
  t: Translate;
  children?: React.ReactNode;
}) {
  const { outcome, site } = handoff;
  const problem = outcome?.kind === 'refused' || outcome?.kind === 'copyFailed';
  return (
    <div className="create">
      {children}
      <section className="create-ask" aria-labelledby={`${CREATE_REQUEST_ID}-label`}>
        <p className="create-intro">{t(site ? 'panelCreateIntro' : 'panelCreateUnsupported')}</p>
        <label
          id={`${CREATE_REQUEST_ID}-label`}
          htmlFor={CREATE_REQUEST_ID}
          className="create-label"
        >
          {t('localPluginDescribeRequestLabel')}
        </label>
        <textarea
          id={CREATE_REQUEST_ID}
          className="create-field"
          value={handoff.request}
          rows={3}
          maxLength={MAX_PLUGIN_REQUEST_CHARS}
          disabled={!site}
          placeholder={t('localPluginDescribeRequestPlaceholder')}
          onChange={(event) => handoff.setRequest(event.target.value)}
        />
        <div className="create-actions">
          <button
            type="button"
            className="pri"
            disabled={!handoff.ready || handoff.sending}
            onClick={() => void handoff.createOnPage()}
          >
            {t('panelCreateOnPage')}
          </button>
          <button
            type="button"
            className="sec"
            disabled={!handoff.ready}
            onClick={() => void handoff.copyForAgent()}
          >
            {outcome?.kind === 'copied'
              ? t('localPluginDescribeCopied')
              : t('createModeCopyForAgent')}
          </button>
        </div>
        <p
          className={problem ? 'create-status bad' : 'create-status'}
          role={problem ? 'alert' : undefined}
          aria-live="polite"
        >
          {statusText(t, outcome)}
        </p>
        {outcome?.kind === 'copyFailed' && (
          <textarea
            readOnly
            className="create-field mono"
            value={outcome.text}
            rows={5}
            dir="ltr"
            aria-label={t('createModeCopyForAgent')}
            onFocus={(event) => event.target.select()}
          />
        )}
      </section>
      <ScriptedStopAll scripted={scripted} look={PANEL_SCRIPTED_LOOK} t={t} />
    </div>
  );
}
