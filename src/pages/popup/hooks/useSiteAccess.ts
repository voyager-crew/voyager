import { useCallback, useEffect, useMemo, useState } from 'react';

import browser from 'webextension-polyfill';

import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { matchesAnyPattern } from '@/features/plugins/sites/matchPattern';
import { effectivePluginView } from '@/features/plugins/storage/effectivePluginView';
import {
  promptCoverageBindingFor,
  promptCoverageBindingForUrl,
} from '@/features/plugins/storage/promptCoverageBinding';
import type { PluginManifest } from '@/features/plugins/types';
import type { TranslationKey } from '@/utils/translations';

import { displayName, pickLocalized } from '../components/PluginIdentity';
import {
  type AccessSite,
  CATALOG_SITES,
  otherWebsiteEntries,
  siteCoverageOn,
} from '../utils/siteAccessSites';
import { holdsAny, holdsOrigin, pageOrigin } from '../utils/sitePermissions';
import type { useCustomWebsites } from './useCustomWebsites';
import type { usePopupPlugins } from './usePopupPlugins';
import { usePromptSwitch } from './usePromptSwitch';
import { useSiteAccessActions } from './useSiteAccessActions';
import type { UndoOffer, WithdrawUndoOffer } from './useUndoToast';

type Coverage = Pick<
  ReturnType<typeof useCustomWebsites>,
  | 'customWebsites'
  | 'setPromptCoverage'
  | 'removeEntries'
  | 'restoreEntries'
  | 'restoreAccess'
  | 'handleRemoveWebsite'
>;

/** `unknown` until the browser has answered, so no site flashes as not allowed. */
export type SiteAccessState = 'unknown' | 'granted' | 'none';

export interface CatalogSiteRow {
  readonly site: AccessSite;
  readonly access: SiteAccessState;
  /** The features that are on there, by name, Prompt Manager first. */
  readonly features: readonly string[];
}

export interface SiteAccessOptions {
  readonly activeUrl: string;
  readonly coverage: Coverage;
  /** The complete catalog and its stored state, so a site's features are listed from any tab. */
  readonly plugins: Pick<
    ReturnType<typeof usePopupPlugins>,
    'pluginManifests' | 'pluginState' | 'legacySettings'
  >;
  readonly language: string;
  readonly t: (key: TranslationKey) => string;
  readonly onUndoOffer: (offer: UndoOffer) => WithdrawUndoOffer;
}

const OFFICIAL_IDS: ReadonlySet<string> = new Set(Object.values(OFFICIAL_PLUGIN_IDS));

const isPromptPlugin = (plugin: PluginManifest) => promptCoverageBindingFor(plugin.id) !== null;

/**
 * The site access card's state: which supported sites Voyager can reach, the
 * features on there, revoking a site with an undo, and Prompt Manager's switch
 * on the open site, which reuses a site's existing grant instead of asking again.
 */
export function useSiteAccess({
  activeUrl,
  coverage,
  plugins,
  language,
  t,
  onUndoOffer,
}: SiteAccessOptions) {
  const [granted, setGranted] = useState<ReadonlySet<string> | null>(null);
  const [pageGranted, setPageGranted] = useState<boolean | null>(null);
  const [checks, setChecks] = useState(0);
  const recheck = useCallback(() => setChecks((count) => count + 1), []);

  // A grant made from a plugin row, or a site removed in the browser, shows here at once.
  useEffect(() => {
    const permissions = browser.permissions;
    permissions?.onAdded?.addListener(recheck);
    permissions?.onRemoved?.addListener(recheck);
    return () => {
      permissions?.onAdded?.removeListener(recheck);
      permissions?.onRemoved?.removeListener(recheck);
    };
  }, [recheck]);

  useEffect(() => {
    let active = true;
    const origin = pageOrigin(activeUrl);
    void Promise.all([
      Promise.all(
        CATALOG_SITES.map(async (site) => [site.id, await holdsAny(site.origins)] as const),
      ),
      origin ? holdsOrigin(origin) : false,
    ]).then(([answers, page]) => {
      if (!active) return;
      setGranted(new Set(answers.filter(([, held]) => held).map(([id]) => id)));
      setPageGranted(page);
    });
    return () => {
      active = false;
    };
  }, [activeUrl, checks]);

  const { pluginManifests, pluginState, legacySettings } = plugins;
  const name = useCallback(
    (plugin: PluginManifest) => displayName(pickLocalized(plugin, 'name', language)),
    [language],
  );
  const enabledPlugins = useMemo(
    () =>
      pluginManifests.filter(
        (plugin) => effectivePluginView(plugin, pluginState, legacySettings).enabled,
      ),
    [legacySettings, pluginManifests, pluginState],
  );

  const rows = useMemo(
    (): readonly CatalogSiteRow[] =>
      CATALOG_SITES.map((site) => {
        const urls = site.hosts.map((host) => `https://${host}/`);
        const here = (plugin: PluginManifest) =>
          urls.some((url) => matchesAnyPattern(url, plugin.matches));
        const prompt = siteCoverageOn(coverage.customWebsites, site);
        const promptPlugin = pluginManifests.find(
          (plugin) => isPromptPlugin(plugin) && here(plugin),
        );
        // Counted once: Prompt Manager's row is its coverage entry, not a plugin-state entry.
        const own = enabledPlugins.filter(
          (plugin) => !OFFICIAL_IDS.has(plugin.id) && !isPromptPlugin(plugin) && here(plugin),
        );
        // A feature for every site (visual effects) never asks for a site itself:
        // it is on there while another feature brings Voyager's page script.
        const riding =
          prompt || own.length > 0
            ? enabledPlugins.filter((plugin) => OFFICIAL_IDS.has(plugin.id) && here(plugin))
            : [];
        return {
          site,
          access: granted === null ? 'unknown' : granted.has(site.id) ? 'granted' : 'none',
          features: [
            ...(prompt ? [promptPlugin ? name(promptPlugin) : t('promptManagerOptions')] : []),
            ...own.map(name),
            ...riding.map(name),
          ],
        };
      }),
    [coverage.customWebsites, enabledPlugins, granted, name, pluginManifests, t],
  );

  const otherWebsites = useMemo(
    () => otherWebsiteEntries(coverage.customWebsites),
    [coverage.customWebsites],
  );

  const promptPlugin = useMemo(() => {
    const id = promptCoverageBindingForUrl(activeUrl)?.pluginId;
    return pluginManifests.find((plugin) => plugin.id === id);
  }, [activeUrl, pluginManifests]);
  const promptSwitch = usePromptSwitch({
    activeUrl,
    coverage,
    pageGranted,
    name: promptPlugin ? name(promptPlugin) : t('promptManagerOptions'),
    t,
    onUndoOffer,
    onSettled: recheck,
  });

  const actions = useSiteAccessActions({
    coverage,
    enabledPlugins,
    t,
    onUndoOffer,
    onSettled: recheck,
  });

  return { rows, otherWebsites, promptSwitch, ...actions };
}

export type SiteAccess = ReturnType<typeof useSiteAccess>;
