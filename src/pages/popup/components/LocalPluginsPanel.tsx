import { authoringSiteForUrl } from '@/features/plugins/local/authoringSites';
import { isScriptedManifest } from '@/features/plugins/scripted/types';
import type { TranslationKey } from '@/utils/translations';

import { Card, CardContent, CardTitle } from '../../../components/ui/card';
import { useCreateRequest } from '../hooks/useCreateRequest';
import { useLocalPlugins } from '../hooks/useLocalPlugins';
import { usePluginReplyReview } from '../hooks/usePluginReplyReview';
import { useScriptedCreations } from '../hooks/useScriptedCreations';
import { reloadActiveTab } from '../utils/reloadActiveTab';
import { CreateModeRequest } from './CreateModeRequest';
import { LocalPluginInspection } from './LocalPluginInspection';
import { LocalPluginIssueList as IssueList } from './LocalPluginIssueList';
import { LocalPluginMoreWays } from './LocalPluginMoreWays';
import { LocalPluginReplyCheck } from './LocalPluginReplyCheck';
import { LocalPluginRow } from './LocalPluginRow';
import { ScriptedSetupCard } from './scripted/ScriptedSetupCard';
import { ScriptedStopAll } from './scripted/ScriptedStopAll';
import { POPUP_SCRIPTED_LOOK } from './scripted/scriptedLook';

/**
 * My creations: Create mode first (one sentence copied for an AI, then its
 * reply checked and previewed), then the user's own plugins to inspect, export
 * or remove, then the file and JSON imports. Turning one on stays in
 * `PluginManager`, which owns the host-permission flow, so an import can never
 * enable anything by itself. Creations that run code are the exception:
 * `PluginManager` never lists them, so their rows here turn them on after a
 * review, and the card holds their setup steps and the kill switch.
 */
export function LocalPluginsPanel({
  t,
  activeUrl,
  dir,
}: {
  t: (key: TranslationKey) => string;
  /** The active tab's URL, which preselects the site a creation is for. */
  activeUrl?: string;
  /** The popup sets no direction, so the card mirrors itself for RTL languages. */
  dir?: 'rtl';
}) {
  const local = useLocalPlugins();
  const create = useCreateRequest(activeUrl, t);
  const review = usePluginReplyReview(local, create.targetSite, activeUrl);
  const scripted = useScriptedCreations({
    reloadPage:
      activeUrl && authoringSiteForUrl(activeUrl) ? () => void reloadActiveTab() : undefined,
  });
  const result = local.result;
  const imported = result?.ok ? result.manifest : null;
  const hasCode = local.entries.some(
    (entry) => entry.manifest && isScriptedManifest(entry.manifest),
  );

  return (
    <Card className="p-4" dir={dir}>
      <CardTitle className="mb-2">{t('localPluginsTitle')}</CardTitle>
      <CardContent className="space-y-3 p-0">
        <p className="text-muted-foreground text-xs">{t('localPluginsDescription')}</p>
        <CreateModeRequest create={create} t={t} />
        <div className="border-border/60 border-t pt-3">
          <LocalPluginReplyCheck review={review} local={local} scripted={scripted} t={t} />
        </div>

        {result && !result.ok && (
          <div className="text-destructive text-[11px]" role="alert">
            <p>{t('localPluginsRejected')}</p>
            <IssueList issues={result.issues} />
            {result.previousVersion && (
              <p className="text-muted-foreground mt-1">
                {t('localPluginsPreviousKept').replace('{version}', result.previousVersion)}
              </p>
            )}
          </div>
        )}
        {imported && (
          <div role="status">
            <p className="text-success text-[11px]">
              {t('localPluginsImported')
                .replace('{name}', imported.name)
                .replace('{version}', imported.version)}
            </p>
            {review.turnedOn && (
              <p
                className={
                  review.turnedOn === 'enabled'
                    ? 'text-success text-[11px]'
                    : 'text-destructive text-[11px]'
                }
              >
                {t(
                  review.turnedOn === 'enabled'
                    ? 'scriptedTurnedOn'
                    : review.turnedOn === 'denied'
                      ? 'scriptedTurnOnDenied'
                      : 'scriptedTurnOnFailed',
                )}
              </p>
            )}
            <LocalPluginInspection manifest={imported} t={t} />
          </div>
        )}

        <div className="border-border/60 space-y-2 border-t pt-3">
          {hasCode && <ScriptedSetupCard scripted={scripted} look={POPUP_SCRIPTED_LOOK} t={t} />}
          {local.entries.length === 0 ? (
            <p className="text-muted-foreground text-xs">{t('localPluginsEmpty')}</p>
          ) : (
            local.entries.map((entry) => (
              <LocalPluginRow
                key={entry.id}
                entry={entry}
                t={t}
                onExport={local.exportPlugin}
                onRemove={(id) => void local.remove(id)}
                scripted={scripted}
                activeUrl={activeUrl}
              />
            ))
          )}
          <ScriptedStopAll scripted={scripted} look={POPUP_SCRIPTED_LOOK} t={t} />
          <LocalPluginMoreWays local={local} t={t} />
        </div>
      </CardContent>
    </Card>
  );
}
