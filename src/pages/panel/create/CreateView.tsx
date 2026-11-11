import React, { useEffect } from 'react';

import { MAX_PLUGIN_REQUEST_CHARS } from '@/features/plugins/local/authoringSites';
import type { TranslationKey } from '@/utils/translations';

import type { PanelSite } from '../sites/panelSites';
import { ModelWarning } from './ModelWarning';
import { PageStructure } from './PageStructure';
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

// Where `field-sizing` is missing, a field grows by script, so the tab stays the one scroller.
const sizesItself = typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content');

function fit(field: HTMLTextAreaElement | null): void {
  if (!field || sizesItself) return;
  field.style.height = 'auto';
  field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
}

/**
 * The 创造 tab: one sentence, then "Create on this page" (a new chat here,
 * filled and left for the user to send) or a copy for a local coding agent.
 * The request field is the tab's writing surface and grows with its text.
 * `children` is the review of a reply the user chose on the page, if any.
 * What it installs is controlled in the 功能 tab, under My creations.
 */
export function CreateView({
  handoff,
  pageSite,
  t,
  children,
}: {
  handoff: CreateHandoff;
  /** The page the panel sits on, whose mark leads the model notice. */
  pageSite: PanelSite;
  t: Translate;
  children?: React.ReactNode;
}) {
  const { outcome, site, warning, checkModel } = handoff;
  const problem = outcome?.kind === 'refused' || outcome?.kind === 'copyFailed';
  const copyLabel =
    outcome?.kind === 'copied' ? t('localPluginDescribeCopied') : t('createModeCopyForAgent');

  // Read the page's model as the tab opens, and again when the user comes back from the page.
  useEffect(() => {
    if (!site) return;
    void checkModel();
    const recheck = () => void checkModel();
    window.addEventListener('focus', recheck);
    return () => window.removeEventListener('focus', recheck);
  }, [site, checkModel]);

  return (
    <div className="create">
      {children}
      <section className="create-ask" aria-labelledby={`${CREATE_REQUEST_ID}-label`}>
        <label
          id={`${CREATE_REQUEST_ID}-label`}
          htmlFor={CREATE_REQUEST_ID}
          className="create-label"
        >
          {t('localPluginDescribeRequestLabel')}
        </label>
        <p id={`${CREATE_REQUEST_ID}-intro`} className="create-intro">
          {t(site ? 'panelCreateIntro' : 'panelCreateUnsupported')}
        </p>
        {site && warning && (
          <ModelWarning
            warning={warning}
            site={pageSite}
            siteLabel={site.label}
            copyLabel={copyLabel}
            canCopy={handoff.ready}
            onCheck={() => void checkModel()}
            onCopy={() => void handoff.copyForAgent()}
            t={t}
          />
        )}
        <textarea
          ref={fit}
          id={CREATE_REQUEST_ID}
          className="create-sheet"
          value={handoff.request}
          rows={6}
          maxLength={MAX_PLUGIN_REQUEST_CHARS}
          disabled={!site}
          placeholder={t('localPluginDescribeRequestPlaceholder')}
          aria-describedby={`${CREATE_REQUEST_ID}-intro`}
          onChange={(event) => {
            handoff.setRequest(event.target.value);
            fit(event.target);
          }}
        />
        {site && handoff.requestTab && (
          <PageStructure
            on={handoff.structure}
            onToggle={handoff.setStructure}
            pageUrl={handoff.pageUrl}
            requestTab={handoff.requestTab}
            t={t}
          />
        )}
        <div className="create-foot">
          <p
            className={problem ? 'create-note bad' : 'create-note'}
            role={problem ? 'alert' : undefined}
            aria-live="polite"
          >
            {statusText(t, outcome)}
          </p>
          <div className="create-actions">
            {!warning && (
              <button
                type="button"
                className="sec"
                disabled={!handoff.ready}
                onClick={() => void handoff.copyForAgent()}
              >
                {copyLabel}
              </button>
            )}
            <button
              type="button"
              className="pri"
              disabled={!handoff.ready || handoff.sending}
              onClick={() => void handoff.createOnPage()}
            >
              {t('panelCreateOnPage')}
            </button>
          </div>
        </div>
        {outcome?.kind === 'copyFailed' && (
          <textarea
            ref={fit}
            readOnly
            className="create-code create-copy"
            value={outcome.text}
            rows={5}
            dir="ltr"
            aria-label={t('createModeCopyForAgent')}
            onFocus={(event) => event.target.select()}
          />
        )}
      </section>
    </div>
  );
}
