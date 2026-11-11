import { useState } from 'react';

import type {
  ScriptedManifest,
  ScriptedPauseReason,
  ScriptedRunState,
} from '@/features/plugins/scripted/types';
import type { TranslationKey } from '@/utils/translations';

import type { ScriptedCreations } from '../../hooks/useScriptedCreations';
import { LocalPluginInspection } from '../LocalPluginInspection';
import { ScriptedTurnOn } from './ScriptedTurnOn';
import { POPUP_SCRIPTED_LOOK as LOOK } from './scriptedLook';

type Translate = (key: TranslationKey) => string;

export const PAUSE_REASON_KEYS: Readonly<Record<ScriptedPauseReason, TranslationKey>> = {
  'user-scripts-off': 'scriptedPausedUserScriptsOff',
  unsupported: 'scriptedPausedUnsupported',
  'stopped-all': 'scriptedPausedStopped',
  'crash-guard': 'scriptedPausedCrash',
  'needs-review': 'scriptedPausedReview',
  'world-setup': 'scriptedPausedWorldSetup',
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
export function isScriptedOn(state: ScriptedRunState): boolean {
  if (state.kind === 'running') return true;
  return (
    state.kind === 'paused' && state.reason !== 'crash-guard' && state.reason !== 'needs-review'
  );
}

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
  const state = scripted.runState(manifest.id) ?? { kind: 'off' };
  const on = isScriptedOn(state);

  return (
    <div className="mt-1.5 space-y-1.5" data-testid="scripted-row">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-[11px]" data-testid="scripted-state">
          {runStateText(t, state)}
        </p>
        {on ? (
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
      {reviewing && !on && (
        <div className="space-y-2">
          <LocalPluginInspection manifest={manifest} t={t} />
          <ScriptedTurnOn
            manifest={manifest}
            scripted={scripted}
            activeUrl={activeUrl}
            look={LOOK}
            t={t}
            onEnabled={() => setReviewing(false)}
          />
        </div>
      )}
    </div>
  );
}
