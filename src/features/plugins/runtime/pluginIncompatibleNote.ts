import { type TranslationKey, fillPlaceholders } from '@/utils/translations';

import type { PluginManifest } from '../types';
import type { PluginStatus } from './pluginStatus';

/**
 * Why a plugin's switch can't turn on here, or null when it can. The popup's
 * plugin list and the panel both disable the switch on a note. Only the
 * incompatibility kinds block it: `no-effect` stays enabled because the plugin
 * did run and found no targets, and `blocked` keeps the person's choice for
 * when the reason clears.
 */
export function pluginIncompatibleNote(
  status: PluginStatus | undefined,
  plugin: PluginManifest,
  siteLabel: string,
  t: (key: TranslationKey) => string,
): string | null {
  if (!status) return null;
  const kind = status.kind;
  switch (kind) {
    case 'needs-form-factor':
      return t('pluginUnavailableOnMobile');
    case 'needs-engine':
      return fillPlaceholders(t('pluginNeedsNewerVoyager'), {
        engine: status.requiredEngine ?? plugin.engine,
      });
    case 'needs-handler':
      return t('pluginNeedsVoyagerUpdate');
    case 'needs-semantic':
    case 'needs-site-data':
      return fillPlaceholders(t('pluginNeedsSiteAdapterUpdate'), { site: siteLabel });
    case 'ready':
    case 'mounted':
    case 'no-effect':
    case 'blocked':
      return null;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
