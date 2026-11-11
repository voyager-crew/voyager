import { type MouseEvent, useState } from 'react';

import { isUserEvent } from '@/core/utils/userEvent';
import type {
  ScriptedManifest,
  ScriptedPauseReason,
  ScriptedRunState,
} from '@/features/plugins/scripted/types';
import type { TranslationKey } from '@/utils/translations';

import type { ScriptedCreations } from '../../hooks/useScriptedCreations';
import {
  type ScriptedTurnOnResult,
  enableScriptedWithSiteAccess,
} from '../../utils/scriptedEnablement';
import { LocalPluginInspection } from '../LocalPluginInspection';
import { ScriptedSetupCard } from './ScriptedSetupCard';
import { POPUP_SCRIPTED_LOOK as LOOK } from './scriptedLook';

type Translate = (key: TranslationKey) => string;

export const PAUSE_REASON_KEYS: Readonly<Record<ScriptedPauseReason, TranslationKey>> = {
  'user-scripts-off': 'scriptedPausedUserScriptsOff',
  unsupported: 'scriptedPausedUnsupported',
  'stopped-all': 'scriptedPausedStopped',
  'crash-guard': 'scriptedPausedCrash',
  'needs-review': 'scriptedPausedReview',
};

export function runStateText(t: Translate, state: ScriptedRunState): string {
  switch (state.kind) {
    case 'running':
      return t('scriptedStateOn');
    case 'off':
      return t('scriptedStateOff');
    case 'paused':
      return `${t('scriptedStatePaused')}: ${t(PAUSE_REASON_KEYS[state.reason])}`;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

/** Still turned on: paused only by this browser or the kill switch, so it resumes by itself. */
function isOn(state: ScriptedRunState): boolean {
  if (state.kind === 'running') return true;
  return (
    state.kind === 'paused' && state.reason !== 'crash-guard' && state.reason !== 'needs-review'
  );
}

const TURN_ON_PROBLEMS: Readonly<Record<Exclude<ScriptedTurnOnResult, 'enabled'>, TranslationKey>> =
  {
    changed: 'scriptedChangedSinceReview',
    denied: 'scriptedTurnOnDenied',
    write_failed: 'scriptedTurnOnFailed',
  };

/**
 * A scripted creation's row: its state, Turn off, or a review (the full source
 * and the warning) whose Turn on binds to exactly what that review shows.
 * Paused creations stay listed with their reason; nothing here deletes one.
 */
export function ScriptedRowControls({
  manifest,
  scripted,
  activeUrl,
  t,
}: {
  manifest: ScriptedManifest;
  scripted: ScriptedCreations;
  activeUrl?: string;
  t: Translate;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [problem, setProblem] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState(false);
  const state = scripted.runState(manifest.id) ?? { kind: 'off' };
  const cannotRun = scripted.status?.availability.kind === 'unsupported';

  const turnOn = async (event: MouseEvent): Promise<void> => {
    if (!isUserEvent(event.nativeEvent)) return;
    setBusy(true);
    const result = await enableScriptedWithSiteAccess(manifest, activeUrl);
    setBusy(false);
    setProblem(result === 'enabled' ? null : TURN_ON_PROBLEMS[result]);
    if (result === 'enabled') setReviewing(false);
  };

  return (
    <div className="mt-1.5 space-y-1.5" data-testid="scripted-row">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-[11px]" data-testid="scripted-state">
          {runStateText(t, state)}
        </p>
        {isOn(state) ? (
          <button
            type="button"
            className={LOOK.secondary}
            onClick={() => void scripted.turnOff(manifest.id)}
          >
            {t('scriptedTurnOff')}
          </button>
        ) : (
          <button
            type="button"
            className={LOOK.secondary}
            aria-expanded={reviewing}
            onClick={() => setReviewing((value) => !value)}
          >
            {t(reviewing ? 'localPluginsHideDetails' : 'scriptedReviewAndTurnOn')}
          </button>
        )}
      </div>
      {reviewing && !isOn(state) && (
        <div className="space-y-2">
          <LocalPluginInspection manifest={manifest} t={t} />
          <ScriptedSetupCard scripted={scripted} look={LOOK} t={t} />
          {problem && (
            <p className={LOOK.alert} role="alert">
              {t(problem)}
            </p>
          )}
          {!cannotRun && (
            <div className={LOOK.actions}>
              <button
                type="button"
                className={LOOK.primary}
                disabled={busy}
                onClick={(event) => void turnOn(event)}
              >
                {t('scriptedTurnOn')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
