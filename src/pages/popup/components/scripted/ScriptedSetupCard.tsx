import type { MouseEvent } from 'react';

import { isUserEvent } from '@/core/utils/userEvent';
import type { TranslationKey } from '@/utils/translations';

import type { ScriptedCreations } from '../../hooks/useScriptedCreations';
import type { ScriptedLook } from './scriptedLook';

type Translate = (key: TranslationKey) => string;

/**
 * Why creations that run code cannot run here, and what to do: the one-time
 * "Allow User Scripts" toggle in numbered steps, or that this browser cannot
 * run them at all. Nothing when they can run.
 */
export function ScriptedSetupCard({
  scripted,
  look,
  t,
}: {
  scripted: ScriptedCreations;
  look: ScriptedLook;
  t: Translate;
}) {
  const availability = scripted.status?.availability;
  if (!availability || availability.kind === 'available') return null;
  if (availability.kind === 'unsupported') {
    return (
      <div className={look.card} role="note" data-testid="scripted-unsupported">
        <p className={look.title}>
          {t(availability.browser === 'old' ? 'scriptedUnsupportedOld' : 'scriptedUnsupported')}
        </p>
        <p className={look.text}>{t('scriptedUnsupportedHint')}</p>
      </div>
    );
  }
  const open = (event: MouseEvent) => {
    if (isUserEvent(event.nativeEvent)) void scripted.openDetails();
  };
  return (
    <div className={look.card} data-testid="scripted-setup">
      <p className={look.title}>{t('scriptedSetupTitle')}</p>
      <ol className={look.steps}>
        <li>{t('scriptedSetupStepOpen')}</li>
        <li>
          {t(
            availability.needs === 'developer-mode'
              ? 'scriptedSetupStepDevMode'
              : 'scriptedSetupStepAllow',
          )}
        </li>
        <li>{t('scriptedSetupStepBack')}</li>
      </ol>
      {scripted.detailsAddress && (
        <>
          <p className={look.text}>{t('scriptedSetupOpenFailed')}</p>
          <code className={look.address} dir="ltr" data-testid="scripted-details-address">
            {scripted.detailsAddress}
          </code>
        </>
      )}
      {scripted.stillOff && (
        <p className={look.alert} role="alert">
          {t('scriptedSetupStillOff')}
        </p>
      )}
      <div className={look.actions}>
        <button type="button" className={look.secondary} onClick={open}>
          {t('scriptedSetupOpen')}
        </button>
        <button
          type="button"
          className={look.primary}
          disabled={scripted.checking}
          onClick={() => void scripted.recheck()}
        >
          {t(scripted.checking ? 'scriptedSetupChecking' : 'scriptedSetupDone')}
        </button>
      </div>
    </div>
  );
}
