import type { ReactNode } from 'react';

import { fillPlaceholders } from '@/utils/translations';
import type { TranslationKey } from '@/utils/translations';

import { HighlightedCode } from './HighlightedCode';
import type { ScriptedLook } from './scriptedLook';

type Translate = (key: TranslationKey) => string;

export function ScriptedBadge({ look, t }: { look: ScriptedLook; t: Translate }) {
  return (
    <span className={look.badge} data-testid="scripted-badge">
      {t('scriptedBadge')}
    </span>
  );
}

/** A long source under its label: folded in a `details` where the look asks for one. */
export function SourceDisclosure({
  label,
  disclosure,
  labelClass,
  children,
}: {
  label: string;
  disclosure: string | undefined;
  labelClass: string;
  children: ReactNode;
}) {
  if (!disclosure) {
    return (
      <div>
        <p className={labelClass}>{label}</p>
        {children}
      </div>
    );
  }
  return (
    <details className={disclosure}>
      <summary>{label}</summary>
      {children}
    </details>
  );
}

/**
 * What a review shows for code: one plain warning and the full source.
 * Voyager does not summarise code, so nothing here describes what it does.
 * The warning always shows; only the source body may fold.
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
      <SourceDisclosure
        label={t('scriptedSourceLabel')}
        disclosure={look.disclosure}
        labelClass={look.label}
      >
        <pre
          className={look.source}
          dir="ltr"
          aria-label={t('scriptedSourceLabel')}
          data-testid="scripted-source"
        >
          <HighlightedCode source={source} language="javascript" />
        </pre>
      </SourceDisclosure>
    </>
  );
}
