import type { ComponentProps } from 'react';

import { isLocalPluginId } from '@/features/plugins/local/localPluginId';
import type { TranslationKey } from '@/utils/translations';

import { LocalPluginsPanel } from './LocalPluginsPanel';
import { PluginManager } from './PluginManager';

/**
 * My creations on Voyager's native surfaces (Gemini, AI Studio). The native
 * popup has no plugin page, so this is one reorderable section of the
 * settings: the Create card, open at rest, then toggles and settings for the
 * creations that target this page (the usual `PluginManager`, without the
 * online catalog, which never serves a native surface). The packaged official
 * plugins that also target this page are driven by their own settings cards,
 * so only local ones appear here; the full list still names whichever plugin
 * holds a runtime a local one waits for.
 */
export function NativeLocalPluginsSection({
  plugins,
  dir,
  t,
}: {
  plugins: Omit<ComponentProps<typeof PluginManager>, 'catalogHost' | 'onRefresh' | 'refreshing'>;
  dir?: 'rtl';
  t: (key: TranslationKey) => string;
}) {
  const localHere = plugins.manifests.filter((plugin) => isLocalPluginId(plugin.id));
  return (
    <div className="flex flex-col gap-4">
      <LocalPluginsPanel dir={dir} t={t} activeUrl={plugins.activeUrl} />
      {localHere.length > 0 && (
        <PluginManager {...plugins} manifests={localHere} nameSources={plugins.manifests} />
      )}
    </div>
  );
}
