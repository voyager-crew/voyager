import React from 'react';

import type { ManifestIssue } from '@/features/plugins/manifest/validate';
import {
  LocalPluginPreviewSummary,
  type PreviewLook,
} from '@/pages/popup/components/LocalPluginPreviewSummary';
import { REPLY_PROBLEM_KEYS } from '@/pages/popup/components/localPluginPreviewText';
import type { TranslationKey } from '@/utils/translations';

import { fillPlaceholders } from '../panelText';
import type { CreationReview as Review } from './useCreationReview';

type Translate = (key: TranslationKey) => string;

const PANEL_PREVIEW_LOOK: PreviewLook = {
  name: 'create-name',
  meta: 'create-meta',
  description: 'create-intro',
  line: 'create-line',
  label: 'create-sub',
  list: 'create-list',
  css: 'create-code',
  warnings: 'create-warn',
  warningsTitle: 'create-sub',
};

function Issues({ issues }: { issues: readonly ManifestIssue[] }) {
  return (
    <ul className="create-list create-code-list" dir="ltr">
      {issues.map((issue, index) => (
        <li key={index}>{issue.path ? `${issue.path}: ${issue.message}` : issue.message}</li>
      ))}
    </ul>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="create-review" aria-label={title} data-testid="create-review">
      <p className="create-label">{title}</p>
      {children}
    </section>
  );
}

/** The review of a reply picked on the page, then its install and switch-on. */
export function CreationReview({ review, t }: { review: Review; t: Translate }) {
  const { state, send, preview } = review;
  const done = (
    <button type="button" className="sec" onClick={() => send({ type: 'dismiss' })}>
      {t('localPluginsCancel')}
    </button>
  );
  switch (state.status) {
    case 'idle':
      return null;
    case 'loading':
    case 'checking':
    case 'installing':
      return (
        <Card title={t('panelCreateReviewTitle')}>
          <p className="create-status" aria-live="polite">
            {t(state.status === 'installing' ? 'panelCreateInstalling' : 'panelCreateChecking')}
          </p>
        </Card>
      );
    case 'reviewing': {
      const { manifest } = state.checked;
      const update = state.checked.previousVersion !== undefined;
      return (
        <Card title={t('panelCreateReviewTitle')}>
          {state.changed && (
            <p className="create-status bad" role="alert">
              {t('localPluginChangedSinceReview')}
            </p>
          )}
          {preview && (
            <LocalPluginPreviewSummary
              manifest={manifest}
              preview={preview}
              look={PANEL_PREVIEW_LOOK}
              t={t}
            />
          )}
          <p className="create-status">{t('panelCreateInstallNote')}</p>
          <div className="create-actions">
            {done}
            <button type="button" className="pri" onClick={() => send({ type: 'install' })}>
              {t(update ? 'panelCreateUpdate' : 'panelCreateInstall')}
            </button>
          </div>
        </Card>
      );
    }
    case 'rejected': {
      const { checked } = state;
      return (
        <Card title={t('panelCreateReviewTitle')}>
          <div className="create-status bad" role="alert">
            {'problem' in checked ? (
              <p>{t(REPLY_PROBLEM_KEYS[checked.problem])}</p>
            ) : (
              <>
                <p>{t('localPluginsRejected')}</p>
                <Issues issues={checked.issues} />
              </>
            )}
          </div>
          <p className="create-status">{t('panelCreateRejectedHint')}</p>
          <div className="create-actions">{done}</div>
        </Card>
      );
    }
    case 'installed':
    case 'turningOn': {
      const on = state.status === 'installed' && state.enabled;
      const name = { name: state.manifest.name };
      return (
        <Card title={t('panelCreateReviewTitle')}>
          <p className="create-status" role="status">
            {fillPlaceholders(t(on ? 'panelCreateInstalledOn' : 'panelCreateInstalledOff'), name)}
          </p>
          {state.reload && <p className="create-status">{t('panelCreateReload')}</p>}
          {on && <p className="create-status">{t('panelCreateChangeAgain')}</p>}
          <div className="create-actions">
            {done}
            {!on && (
              <button
                type="button"
                className="pri"
                disabled={state.status === 'turningOn'}
                onClick={() => send({ type: 'turnOn' })}
              >
                {t('panelCreateTurnOn')}
              </button>
            )}
          </div>
        </Card>
      );
    }
    case 'failed':
      return (
        <Card title={t('panelCreateReviewTitle')}>
          <div className="create-status bad" role="alert">
            <p>{t('panelCreateFailed')}</p>
            <Issues issues={state.issues} />
          </div>
          <div className="create-actions">{done}</div>
        </Card>
      );
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}
