import { type ReactNode, useMemo, useState } from 'react';

import type { PluginStatus } from '@/features/plugins/runtime/pluginStatus';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import type { BlockedPluginUpdate } from '@/features/plugins/sources/defaultSources';
import type { PluginManifest } from '@/features/plugins/types';
import type { TranslationKey } from '@/utils/translations';

import { Card, CardContent, CardTitle } from '../../../components/ui/card';
import { Switch } from '../../../components/ui/switch';
import { useLanguage } from '../../../contexts/LanguageContext';
import { COVERAGE_REFUSAL_MESSAGES } from '../hooks/useCustomWebsites';
import { PROMPT_SWITCH_ID, type PromptSwitch } from '../hooks/usePromptSwitch';
import { PluginCatalogControls, usePluginCatalog } from './PluginCatalogControls';
import {
  PluginIdentity,
  pickLocalized,
  siteHostsFromMatches,
  usePluginSite,
} from './PluginIdentity';
import { PluginOpsNotes } from './PluginOpsNotes';
import { PluginSettings } from './PluginSettings';
import { DEDICATED_TIMELINE_SOURCES } from './dedicatedTimelineSources';
import { BLOCKED_NOTE_TONE_CLASS, blockedPluginNote } from './pluginBlockedNote';
import { usePluginAccess } from './usePluginAccess';
import { usePluginPreferences } from './usePluginPreferences';
import { usePluginUpdates } from './usePluginUpdates';

/** The site's timeline rail: its options open under its plugin row. */
export interface TimelineRailOptions {
  readonly pluginId: string;
  /** Plugin settings the options can edit, so the row's own controls may leave them out. */
  readonly settingKeys: readonly string[];
  /**
   * The options, given the settings the row left out for them, the plugin's name and whether
   * the rail is on: its shared entries (Saved Library, message times) work while it is off.
   */
  readonly render: (
    ownedSettingKeys: readonly string[],
    name: string,
    enabled: boolean,
  ) => ReactNode;
}

function dedicatedTimelineKeys(
  plugin: PluginManifest,
  sourceId: string | undefined,
  dedicated: TimelineRailOptions | undefined,
): readonly string[] | undefined {
  // Only the visible card's official rail loses duplicates; local rails keep their own controls.
  if (
    dedicated?.pluginId !== plugin.id ||
    !sourceId ||
    !DEDICATED_TIMELINE_SOURCES.get(plugin.id)?.includes(sourceId)
  )
    return undefined;
  return dedicated.settingKeys.filter((key) => {
    const field = plugin.contributes.settings?.[key];
    if (!field || field.enabledBy) return false;
    if (key === 'markerLevel') return field.type === 'boolean';
    // A remote catalog may add choices the three-style card cannot express.
    return (
      key === 'timelineStyle' &&
      field.type === 'select' &&
      field.options?.length === 3 &&
      field.options.every((option) => ['dots', 'compact', 'ruler'].includes(option.value))
    );
  });
}

export interface PluginManagerProps {
  /** Plugin manifests from bundled and remote sources (loaded by the parent). */
  readonly manifests: readonly PluginManifest[];
  /** True while the manifest list is still loading. */
  readonly loading?: boolean;
  /** Force-refresh the remote marketplace and re-read bundled manifests. */
  readonly onRefresh?: () => void;
  /** True while a manual refresh is in flight. */
  readonly refreshing?: boolean;
  /** URL of the active tab — selects which platform logo each plugin shows. */
  readonly activeUrl?: string;
  /**
   * Source id per plugin id: `builtin` (first-party JS), `bundled-catalog`
   * (snapshot shipped with this build) or `host-catalog` (fetched from the
   * remote catalog for the active host). Drives the per-plugin source label.
   */
  readonly sourceIds?: Readonly<Record<string, string>>;
  /** Remote updates held back because they need a newer engine than this build (plan D6). */
  readonly blockedUpdates?: Readonly<Record<string, BlockedPluginUpdate>>;
  /** Host whose remote catalog this popup reads; undefined on hosts that can never have one. */
  readonly catalogHost?: string;
  /**
   * Per-plugin status reported by the active tab's PluginHost (D8):
   * needs-form-factor / needs-engine / needs-handler / needs-semantic / needs-site-data disable the toggle with a
   * reason, no-effect shows the health warning, pendingVersion says the update
   * applies after a page reload, blocked keeps the toggle and says why the
   * plugin waits. Empty when the tab reported nothing.
   */
  readonly statuses?: readonly PluginStatus[];
  /**
   * Manifests to name a blocking plugin from, when it may be missing from
   * `manifests` (the native popup lists only local plugins, yet a packaged
   * official one can hold the runtime). Defaults to `manifests`.
   */
  readonly nameSources?: readonly PluginManifest[];
  readonly timelineRail?: TimelineRailOptions;
  /** Official plugin rows that also cover this site, listed ahead of its plugins. */
  readonly officialRows?: ReactNode;
  /**
   * Prompt Manager's switch on this site. Its catalog plugin's row comes first
   * and shows and writes the page host's coverage entry, not plugin state.
   */
  readonly promptSwitch?: PromptSwitch | null;
}

/**
 * Render the popup's plugin catalog and manage each plugin's enabled state,
 * optional host access, platform-specific settings, and refresh lifecycle.
 */
export function PluginManager({
  manifests,
  loading = false,
  onRefresh,
  refreshing = false,
  activeUrl,
  sourceIds,
  blockedUpdates,
  catalogHost,
  statuses,
  nameSources,
  timelineRail,
  officialRows,
  promptSwitch,
}: PluginManagerProps) {
  const { t, language } = useLanguage();
  const { currentSiteId, currentSiteLabel } = usePluginSite(activeUrl);
  const promptPlugin = promptSwitch
    ? manifests.find((plugin) => plugin.id === promptSwitch.pluginId)
    : undefined;
  // Its coverage entry runs on the page's own grant, so it needs no repair of its own.
  const accessManifests = useMemo(
    () => (promptPlugin ? manifests.filter((plugin) => plugin !== promptPlugin) : manifests),
    [manifests, promptPlugin],
  );
  const [promptRefusal, setPromptRefusal] = useState<TranslationKey | null>(null);
  // Status per plugin id. A plugin the tab said nothing about keeps today's
  // behaviour (enabled toggle, no note).
  const statusById = useMemo(() => {
    const map = new Map<string, PluginStatus>();
    for (const status of statuses ?? []) map.set(status.id, status);
    return map;
  }, [statuses]);
  const preferences = usePluginPreferences();
  const {
    enabledMap,
    settingsMap,
    collapsed,
    handleSetting,
    handleImmediateSettings,
    toggleCollapsed,
  } = preferences;
  const updatedIds = usePluginUpdates(manifests);
  const {
    deniedId,
    unsupportedId,
    enableRefusal,
    missingPermissionIds,
    handleToggle,
    handleGrantRequiredAccess,
  } = usePluginAccess(accessManifests, activeUrl, enabledMap, preferences.mirrorEnabled);
  const catalog = usePluginCatalog(catalogHost, refreshing);

  const hasUpdatedPlugins = manifests.some((plugin) => updatedIds.has(plugin.id));

  const renderRow = (plugin: PluginManifest) => {
    // Listed as an official row (officialRows) where the effect can run.
    if (plugin.id === OFFICIAL_PLUGIN_IDS.visualEffects) return null;
    const prompt = plugin === promptPlugin ? promptSwitch : null;
    const enabled = prompt ? prompt.enabled : enabledMap[plugin.id] === true;
    const isOpen = !collapsed.has(plugin.id);
    const hosts = siteHostsFromMatches(plugin.matches);
    const localizedName = pickLocalized(plugin, 'name', language);
    const needsSiteAccess = !prompt && enabled && missingPermissionIds.has(plugin.id);
    const isUpdated = updatedIds.has(plugin.id);
    const status = statusById.get(plugin.id);
    // Only the incompatibility kinds block the toggle; `no-effect`
    // stays enabled because the plugin did run, it just found no targets,
    // and `blocked` keeps the user's choice for when the reason clears.
    const incompatibleNote = ((): string | null => {
      switch (status?.kind) {
        case 'needs-form-factor':
          return t('pluginUnavailableOnMobile');
        case 'needs-engine':
          return t('pluginNeedsNewerVoyager').replace(
            '{engine}',
            status.requiredEngine ?? plugin.engine,
          );
        case 'needs-handler':
          return t('pluginNeedsVoyagerUpdate');
        case 'needs-semantic':
        case 'needs-site-data':
          return t('pluginNeedsSiteAdapterUpdate').replace('{site}', currentSiteLabel ?? hosts);
        default:
          return null;
      }
    })();
    const railKeys = dedicatedTimelineKeys(plugin, sourceIds?.[plugin.id], timelineRail);
    const blockedNote = blockedPluginNote({
      status,
      manifests: nameSources ?? manifests,
      language,
      t,
    });
    return (
      <div key={plugin.id} className="border-border/60 rounded-lg border p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <PluginIdentity
              plugin={plugin}
              isOpen={isOpen}
              onCollapse={() => toggleCollapsed(plugin.id)}
              isUpdated={isUpdated}
              sourceId={sourceIds?.[plugin.id]}
              blockedUpdate={blockedUpdates?.[plugin.id]}
              activeUrl={activeUrl}
              currentSiteId={currentSiteId}
            />

            {/* Status notes stay visible while the card is collapsed —
                they explain a toggle the user cannot move, or why an
                enabled plugin is not running on this page. */}
            {incompatibleNote && (
              <p className="text-destructive/80 mt-1 text-[11px] leading-snug">
                {incompatibleNote}
              </p>
            )}

            {blockedNote && (
              <p
                className={`mt-1 text-[11px] leading-snug ${BLOCKED_NOTE_TONE_CLASS[blockedNote.tone]}`}
              >
                {blockedNote.text}
              </p>
            )}

            {status?.kind === 'no-effect' && (
              <p className="text-warning mt-1 text-[11px] leading-snug">
                {t('pluginNoEffectOnPage')}
              </p>
            )}

            <PluginOpsNotes status={status} isOpen={isOpen} t={t} />

            {status?.pendingVersion && (
              <p className="text-muted-foreground mt-1 text-[11px] leading-snug">
                {t('pluginUpdateAfterReload').replace('{version}', status.pendingVersion)}
              </p>
            )}

            {needsSiteAccess && (
              <button
                type="button"
                onClick={() => void handleGrantRequiredAccess(plugin)}
                className="border-primary/25 bg-primary/5 text-primary hover:bg-primary/10 mt-2 flex w-full items-center justify-center rounded-md border px-2.5 py-2 text-xs font-medium transition-colors"
              >
                {t('pluginGrantRequiredAccess')}
              </button>
            )}

            {/* Settings stay visible even when the description is collapsed, so a
                slider-based plugin (e.g. reading width) is always adjustable. A missing
                companion-frame grant must not disable settings that still affect the
                already-authorized parent page. */}
            {enabled && (
              <PluginSettings
                plugin={plugin}
                values={settingsMap[plugin.id]}
                hiddenKeys={railKeys}
                handleSetting={handleSetting}
                handleImmediateSettings={handleImmediateSettings}
              />
            )}

            {timelineRail?.pluginId === plugin.id &&
              timelineRail.render(railKeys ?? [], localizedName, enabled)}

            {deniedId === plugin.id && (
              <p className="text-destructive mt-1 text-[11px]">{t('pluginPermissionDenied')}</p>
            )}

            {unsupportedId === plugin.id && (
              <p className="text-destructive mt-1 text-[11px]">{t('pluginUnsupportedPlatform')}</p>
            )}

            {enableRefusal?.id === plugin.id && (
              <p className="text-destructive mt-1 text-[11px]">{t(enableRefusal.key)}</p>
            )}

            {prompt && promptRefusal && (
              <p className="text-destructive mt-1 text-[11px]">{t(promptRefusal)}</p>
            )}
          </div>
          <Switch
            id={prompt ? PROMPT_SWITCH_ID : undefined}
            checked={enabled}
            disabled={!enabled && incompatibleNote !== null}
            onChange={(e) => {
              if (!prompt) {
                void handleToggle(plugin, e.target.checked);
                return;
              }
              setPromptRefusal(null);
              void prompt.setEnabled(e.target.checked).then((refusal) => {
                if (refusal) setPromptRefusal(COVERAGE_REFUSAL_MESSAGES[refusal]);
              });
            }}
            aria-label={localizedName}
          />
        </div>
      </div>
    );
  };

  return (
    <Card className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <CardTitle>{t('pluginsTitle')}</CardTitle>
          {hasUpdatedPlugins && (
            <span
              data-testid="plugin-updates-dot"
              className="bg-primary inline-block h-1.5 w-1.5 rounded-full"
              aria-hidden="true"
            />
          )}
        </div>
        {/* Where the online updates row shows, its own button is the card's manual check. */}
        {onRefresh && !catalogHost && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title={t('pluginsRefresh')}
            aria-label={t('pluginsRefresh')}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={refreshing ? 'animate-spin' : ''}
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
            </svg>
          </button>
        )}
      </div>
      <CardContent className="space-y-3 p-0">
        <p className="text-muted-foreground text-xs">{t('pluginsDescription')}</p>

        {manifests.length === 0 && (
          <p className="text-muted-foreground text-xs">
            {loading ? t('pluginsLoading') : t('pluginsEmpty')}
          </p>
        )}

        {/* Prompt Manager leads the site's features; its row is found by binding, not by site. */}
        {promptPlugin && renderRow(promptPlugin)}

        {officialRows}

        {manifests.map((plugin) => (plugin === promptPlugin ? null : renderRow(plugin)))}

        {/* Online-catalog controls require a concrete HTTPS host without a port or wildcard. */}
        <PluginCatalogControls
          catalogHost={catalogHost}
          onRefresh={onRefresh}
          refreshing={refreshing}
          {...catalog}
        />
      </CardContent>
    </Card>
  );
}
