import type { MouseEvent } from 'react';

import { isUserEvent } from '@/core/utils/userEvent';
import type { TranslationKey } from '@/utils/translations';

import type { ScriptedCreations } from '../../hooks/useScriptedCreations';
import type { ScriptedLook } from './scriptedLook';

type Translate = (key: TranslationKey) => string;

/**
 * The kill switch for every creation that runs code, and Resume. Stopping
 * unregisters them for new page loads only, so it says that open pages keep
 * them until reloaded and offers a reload the user has to click.
 */
export function ScriptedStopAll({
  scripted,
  look,
  t,
}: {
  scripted: ScriptedCreations;
  look: ScriptedLook;
  t: Translate;
}) {
  const { status } = scripted;
  if (!status || (!status.stopped && status.plugins.length === 0)) return null;
  const user = (action: () => void) => (event: MouseEvent) => {
    if (isUserEvent(event.nativeEvent)) action();
  };
  if (!status.stopped) {
    return (
      <div className={look.actions} data-testid="scripted-stop-all">
        <button
          type="button"
          className={look.secondary}
          onClick={user(() => void scripted.stopAll())}
        >
          {t('scriptedStopAll')}
        </button>
      </div>
    );
  }
  return (
    <div className={look.card} role="status" data-testid="scripted-stopped">
      <p className={look.title}>{t('scriptedStoppedAll')}</p>
      {scripted.stoppedHere && <p className={look.text}>{t('scriptedStoppedReload')}</p>}
      <div className={look.actions}>
        {scripted.stoppedHere && scripted.reloadPage && (
          <button
            type="button"
            className={look.secondary}
            onClick={user(() => scripted.reloadPage?.())}
          >
            {t('scriptedReloadPage')}
          </button>
        )}
        <button type="button" className={look.primary} onClick={user(() => void scripted.resume())}>
          {t('scriptedResume')}
        </button>
      </div>
    </div>
  );
}
