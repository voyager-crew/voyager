import React, { type MouseEvent } from 'react';

import { isUserEvent } from '@/core/utils/userEvent';
import type { ManifestIssue } from '@/features/plugins/manifest/validate';
import { isScriptedManifest } from '@/features/plugins/scripted/types';
import {
  LocalPluginPreviewSummary,
  type PreviewLook,
} from '@/pages/popup/components/LocalPluginPreviewSummary';
import { REPLY_PROBLEM_KEYS } from '@/pages/popup/components/localPluginPreviewText';
import { ScriptedSetupCard } from '@/pages/popup/components/scripted/ScriptedSetupCard';
import type { ScriptedCreations } from '@/pages/popup/hooks/useScriptedCreations';
import type { TranslationKey } from '@/utils/translations';

import { fillPlaceholders } from '../panelText';
import { PANEL_SCRIPTED_LOOK } from './scriptedLook';
import type { CreationReview as Review } from './useCreationReview';

type Translate = (key: TranslationKey) => string;

const PANEL_PREVIEW_LOOK: PreviewLook = {
  name: 'create-name',
  meta: 'create-meta',
  description: 'create-desc',
  line: 'create-line',
  label: 'create-sub',
  list: 'create-list',
  css: 'create-code',
  disclosure: 'create-fold',
  warnings: 'create-warn',
  warningsTitle: 'create-sub',
  scripted: PANEL_SCRIPTED_LOOK,
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

const REVIEW_TITLE_ID = 'panel-create-review-title';

/** The review sits in the tab's flow under a small title, with no box of its own. */
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="create-review"
      aria-labelledby={REVIEW_TITLE_ID}
      data-testid="create-review"
    >
      <p id={REVIEW_TITLE_ID} className="create-kicker">
        {title}
      </p>
      {children}
    </section>
  );
}

/** The review of a reply picked on the page, then its install and switch-on. */
export function CreationReview({
  review,
  scripted,
  t,
}: {
  review: Review;
  scripted: ScriptedCreations;
  t: Translate;
}) {
  const { state, send, preview } = review;
  const setup = <ScriptedSetupCard scripted={scripted} look={PANEL_SCRIPTED_LOOK} t={t} />;
  // Cancel while an install is still a choice; Close once there is nothing left to cancel.
  const dismiss = (label: 'localPluginsCancel' | 'commonClose') => (
    <button type="button" className="sec" onClick={() => send({ type: 'dismiss' })}>
      {t(label)}
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
          <p className="create-note" aria-live="polite">
            {t(state.status === 'installing' ? 'panelCreateInstalling' : 'panelCreateChecking')}
          </p>
        </Card>
      );
    case 'reviewing': {
      const { manifest } = state.checked;
      const update = state.checked.previousVersion !== undefined;
      const runsCode = isScriptedManifest(manifest);
      const cannotRun = runsCode && scripted.status?.availability.kind === 'unsupported';
      // Turning on code takes the person's own click; a declarative install keeps its old path.
      const install = (event: MouseEvent) => {
        if (!runsCode || isUserEvent(event.nativeEvent)) send({ type: 'install' });
      };
      return (
        <Card title={t('panelCreateReviewTitle')}>
          {state.changed && (
            <p className="create-note bad" role="alert">
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
          {runsCode && setup}
          {!cannotRun && (
            <p className="create-note">
              {t(runsCode ? 'scriptedInstallNote' : 'panelCreateInstallNote')}
            </p>
          )}
          <div className="create-actions">
            {dismiss('localPluginsCancel')}
            {!cannotRun && (
              <button type="button" className="pri" onClick={install}>
                {t(update ? 'panelCreateUpdate' : 'panelCreateInstall')}
              </button>
            )}
          </div>
        </Card>
      );
    }
    case 'rejected': {
      const { checked } = state;
      return (
        <Card title={t('panelCreateReviewTitle')}>
          <div className="create-note bad" role="alert">
            {'problem' in checked ? (
              <p>{t(REPLY_PROBLEM_KEYS[checked.problem])}</p>
            ) : (
              <>
                <p>{t('localPluginsRejected')}</p>
                <Issues issues={checked.issues} />
              </>
            )}
          </div>
          <p className="create-note">{t('panelCreateRejectedHint')}</p>
          <div className="create-actions">{dismiss('commonClose')}</div>
        </Card>
      );
    }
    case 'installed':
    case 'turningOn': {
      const on = state.status === 'installed' && state.enabled;
      const name = { name: state.manifest.name };
      return (
        <Card title={t('panelCreateReviewTitle')}>
          <p className="create-note" role="status">
            {fillPlaceholders(t(on ? 'panelCreateInstalledOn' : 'panelCreateInstalledOff'), name)}
          </p>
          {state.reload && <p className="create-note">{t('panelCreateReload')}</p>}
          {on && isScriptedManifest(state.manifest) && setup}
          {on && <p className="create-note">{t('panelCreateChangeAgain')}</p>}
          <div className="create-actions">
            {dismiss('commonClose')}
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
          <div className="create-note bad" role="alert">
            <p>{t('panelCreateFailed')}</p>
            <Issues issues={state.issues} />
          </div>
          <div className="create-actions">{dismiss('commonClose')}</div>
        </Card>
      );
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}
