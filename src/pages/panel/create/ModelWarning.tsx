import React from 'react';

import type { CreateModelWarning } from '@/features/plugins/local/creation/messages';
import type { TranslationKey } from '@/utils/translations';

import { SiteGlyph } from '../components/SiteMark';
import type { PanelSite } from '../sites/panelSites';

type Translate = (key: TranslationKey) => string;

function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? values[name] : placeholder,
  );
}

/**
 * Above the request: the page's chat model usually cannot write a creation.
 * Its two ways out are a stronger model, chosen by the user in the site's own
 * menu ("Check again" reads the page once more), or a local coding agent.
 * The thinking level is named only when the page or the applied default said it.
 * The site's own mark leads it, on the title's first line.
 */
export function ModelWarning({
  warning,
  site,
  siteLabel,
  copyLabel,
  canCopy,
  onCheck,
  onCopy,
  t,
}: {
  warning: CreateModelWarning;
  site: PanelSite;
  siteLabel: string;
  copyLabel: string;
  canCopy: boolean;
  onCheck: () => void;
  onCopy: () => void;
  t: Translate;
}) {
  const values = {
    site: siteLabel,
    model: warning.model,
    thinking: warning.thinking ?? '',
    suggested: warning.suggested,
  };
  return (
    <div className="create-model-warn" role="note">
      <SiteGlyph site={site} size={16} />
      <div className="create-model-text">
        <p className="create-strong">
          {fill(
            t(warning.thinking ? 'panelCreateWeakModelThinking' : 'panelCreateWeakModel'),
            values,
          )}
        </p>
        <p className="create-note">{fill(t('panelCreateWeakModelAdvice'), values)}</p>
        <div className="create-model-actions">
          <button type="button" className="sec" onClick={onCheck}>
            {t('panelCreateCheckModel')}
          </button>
          <button type="button" className="sec" disabled={!canCopy} onClick={onCopy}>
            {copyLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
