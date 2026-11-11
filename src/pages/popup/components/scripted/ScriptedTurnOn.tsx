import { type MouseEvent, useState } from 'react';

import { isUserEvent } from '@/core/utils/userEvent';
import type { ScriptedManifest } from '@/features/plugins/scripted/types';
import type { TranslationKey } from '@/utils/translations';

import type { ScriptedCreations } from '../../hooks/useScriptedCreations';
import {
  type ScriptedTurnOnResult,
  enableScriptedWithSiteAccess,
} from '../../utils/scriptedEnablement';
import { ScriptedSetupCard } from './ScriptedSetupCard';
import type { ScriptedLook } from './scriptedLook';

type Translate = (key: TranslationKey) => string;

const TURN_ON_PROBLEMS: Readonly<Record<Exclude<ScriptedTurnOnResult, 'enabled'>, TranslationKey>> =
  {
    changed: 'scriptedChangedSinceReview',
    denied: 'scriptedTurnOnDenied',
    write_failed: 'scriptedTurnOnFailed',
  };

/**
 * The end of a review of an installed creation that runs code, under its
 * source: the setup steps when this browser can't run it yet, then **Turn
 * on**, bound to the hash of `manifest`, the version on screen. The popup's
 * My creations and the panel's Features tab both end their review here.
 */
export function ScriptedTurnOn({
  manifest,
  scripted,
  activeUrl,
  look,
  t,
  onEnabled,
}: {
  manifest: ScriptedManifest;
  scripted: ScriptedCreations;
  activeUrl?: string;
  look: ScriptedLook;
  t: Translate;
  onEnabled: () => void;
}) {
  const [problem, setProblem] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState(false);
  const cannotRun = scripted.status?.availability.kind === 'unsupported';

  const turnOn = async (event: MouseEvent): Promise<void> => {
    if (!isUserEvent(event.nativeEvent)) return;
    setBusy(true);
    const result = await enableScriptedWithSiteAccess(manifest, activeUrl);
    setBusy(false);
    setProblem(result === 'enabled' ? null : TURN_ON_PROBLEMS[result]);
    if (result === 'enabled') onEnabled();
  };

  return (
    <>
      <ScriptedSetupCard scripted={scripted} look={look} t={t} />
      {problem && (
        <p className={look.alert} role="alert">
          {t(problem)}
        </p>
      )}
      {!cannotRun && (
        <div className={look.actions}>
          <button
            type="button"
            className={look.primary}
            disabled={busy}
            onClick={(event) => void turnOn(event)}
          >
            {t('scriptedTurnOn')}
          </button>
        </div>
      )}
    </>
  );
}
