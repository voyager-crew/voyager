import type { PluginPreview } from '@/features/plugins/local/pluginPreview';
import type { PluginManifest } from '@/features/plugins/types';
import type { TranslationKey } from '@/utils/translations';

import { LocalPluginCssSource } from './LocalPluginCssSource';
import { changeText, warningText } from './localPluginPreviewText';
import { ScriptedBadge, ScriptedSource, SourceDisclosure } from './scripted/ScriptedSource';
import { POPUP_SCRIPTED_LOOK, type ScriptedLook } from './scripted/scriptedLook';

/** Class names per part, so the popup and the panel share what a review shows and differ in look. */
export interface PreviewLook {
  readonly name: string;
  readonly meta: string;
  readonly description: string;
  readonly line: string;
  readonly label: string;
  readonly list: string;
  /** The CSS source; the popup's own when omitted. */
  readonly css?: string;
  /** Folds the CSS under its label in a `details` with this class, as the scripted look does. */
  readonly disclosure?: string;
  readonly warnings: string;
  readonly warningsTitle: string;
  readonly scripted: ScriptedLook;
}

/**
 * What a reviewed plugin does, in plain terms: its name and version, the sites
 * it runs on, each change, its CSS in full and anything to check first. A
 * plugin that runs code shows a badge, one warning and its full source instead
 * of changes.
 */
export function LocalPluginPreviewSummary({
  manifest,
  preview,
  look,
  t,
}: {
  manifest: PluginManifest;
  preview: PluginPreview;
  look: PreviewLook;
  t: (key: TranslationKey) => string;
}) {
  const css = (
    <LocalPluginCssSource
      css={preview.css}
      label={t('localPluginInspectCss')}
      className={look.css}
    />
  );
  return (
    <>
      <div>
        <p className={look.name}>
          {preview.name}{' '}
          <span className={look.meta} dir="ltr">
            {manifest.id} · v{manifest.version}
          </span>
          {preview.script !== undefined && <ScriptedBadge look={look.scripted} t={t} />}
        </p>
        <p className={look.description}>{preview.description}</p>
      </div>
      <p className={look.line}>
        <span className={look.label}>{t('localPluginInspectSites')}: </span>
        {preview.sites.join(', ')}
      </p>
      {preview.script !== undefined ? (
        <ScriptedSource source={preview.script} sites={preview.sites} look={look.scripted} t={t} />
      ) : (
        <>
          <div>
            <p className={look.label}>{t('localPluginPreviewChanges')}</p>
            <ul className={look.list}>
              {preview.changes.map((change, index) => (
                <li key={index}>{changeText(t, change)}</li>
              ))}
            </ul>
          </div>
          {look.disclosure && preview.css.length > 0 ? (
            <SourceDisclosure
              label={t('localPluginInspectCss')}
              disclosure={look.disclosure}
              labelClass={look.label}
            >
              {css}
            </SourceDisclosure>
          ) : (
            css
          )}
        </>
      )}
      {preview.warnings.length > 0 && (
        <div className={look.warnings} data-testid="local-plugin-warnings">
          <p className={look.warningsTitle}>{t('localPluginPreviewWarnings')}</p>
          <ul className={look.list}>
            {preview.warnings.map((warning, index) => (
              <li key={index}>{warningText(t, warning)}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/** The popup's look: Tailwind utilities, as the rest of the card. */
export const POPUP_PREVIEW_LOOK: PreviewLook = {
  name: 'text-sm leading-snug font-medium break-words',
  meta: 'text-muted-foreground font-mono text-[10px]',
  description: 'text-muted-foreground text-[11px] break-words',
  line: 'text-[11px]',
  label: 'text-muted-foreground text-[11px]',
  list: 'mt-0.5 list-disc space-y-0.5 ps-4 text-[11px] break-words',
  warnings: 'text-warning',
  warningsTitle: 'text-[11px] font-medium',
  scripted: POPUP_SCRIPTED_LOOK,
};
