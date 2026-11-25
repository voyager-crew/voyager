import { useState } from 'react';

import { catalogSiteForUrl } from '@/features/plugins/sites/siteAccessSites';
import type { PluginManifest } from '@/features/plugins/types';
import type { TranslationKey } from '@/utils/translations';

import { Button } from '../../../components/ui/button';
import {
  type PluginToggleOutcome,
  setPluginEnabledWithSiteAccess,
} from '../utils/pluginEnablement';

/** A feature the in-page panel could not get site access for (Firefox), resolved to its manifest. */
export interface HandedOverGrant {
  readonly plugin: PluginManifest;
  readonly name: string;
  /** The page URL the panel's rows were read for: its site may not be the open tab's. */
  readonly pageUrl: string;
}

const RESULT_TEXT: Partial<Record<PluginToggleOutcome, TranslationKey>> = {
  enabled: 'pluginToggleToastOn',
  denied: 'pluginPermissionDenied',
  unsupported: 'pluginUnsupportedPlatform',
  changed: 'localPluginChangedBeforeEnable',
  write_failed: 'watermarkNotice_error',
};

function siteLabel(pageUrl: string): string {
  const site = catalogSiteForUrl(pageUrl);
  if (site) return site.label;
  try {
    return new URL(pageUrl).hostname;
  } catch {
    return pageUrl;
  }
}

/**
 * The grant a panel switch handed over: the feature and site it was for, and
 * one button that asks the browser and turns the feature on. The request is
 * the click's first await, as Firefox requires.
 */
export function PanelGrantOffer({
  offer,
  t,
}: {
  offer: HandedOverGrant;
  t: (key: TranslationKey) => string;
}) {
  const [outcome, setOutcome] = useState<PluginToggleOutcome | null>(null);
  const [asking, setAsking] = useState(false);
  const fill = (text: string) =>
    text.replace('{name}', () => offer.name).replace('{site}', () => siteLabel(offer.pageUrl));
  const resultKey = outcome ? RESULT_TEXT[outcome] : undefined;

  return (
    <div
      data-panel-grant={offer.plugin.id}
      className="border-primary/40 bg-primary/5 space-y-2 rounded-lg border p-3"
    >
      <p className="text-xs leading-snug">{fill(t('siteAccessPanelGrant'))}</p>
      {outcome !== 'enabled' && (
        <Button
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={asking}
          onClick={() => {
            setAsking(true);
            void setPluginEnabledWithSiteAccess(offer.plugin, true, offer.pageUrl, () => {})
              .then(setOutcome)
              .finally(() => setAsking(false));
          }}
        >
          {t('pluginGrantRequiredAccess')}
        </Button>
      )}
      {resultKey && (
        <p role="status" className="text-muted-foreground text-xs leading-snug">
          {fill(t(resultKey))}
        </p>
      )}
    </div>
  );
}
