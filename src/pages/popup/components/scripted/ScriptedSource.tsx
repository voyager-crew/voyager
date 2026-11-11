import { fillPlaceholders } from '@/utils/translations';
import type { TranslationKey } from '@/utils/translations';

import type { ScriptedLook } from './scriptedLook';

type Translate = (key: TranslationKey) => string;

export function ScriptedBadge({ look, t }: { look: ScriptedLook; t: Translate }) {
  return (
    <span className={look.badge} data-testid="scripted-badge">
      {t('scriptedBadge')}
    </span>
  );
}

/**
 * What a review shows for code: one plain warning and the full source.
 * Voyager does not summarise code, so nothing here describes what it does.
 */
export function ScriptedSource({
  source,
  sites,
  look,
  t,
}: {
  source: string;
  sites: readonly string[];
  look: ScriptedLook;
  t: Translate;
}) {
  return (
    <>
      <p className={look.warning} data-testid="scripted-warning">
        {fillPlaceholders(t('scriptedWarning'), { sites: sites.join(', ') })}
      </p>
      <div>
        <p className={look.label}>{t('scriptedSourceLabel')}</p>
        <pre
          className={look.source}
          dir="ltr"
          aria-label={t('scriptedSourceLabel')}
          data-testid="scripted-source"
        >
          {source}
        </pre>
      </div>
    </>
  );
}
