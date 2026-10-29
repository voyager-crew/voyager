import { useCallback, useEffect, useMemo, useState } from 'react';

import browser from 'webextension-polyfill';

import { logger } from '@/core/services/LoggerService';
import { isFirefox } from '@/core/utils/browser';
import { customWebsitesIncludeHost } from '@/core/utils/customWebsites';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { matchesAnyPattern } from '@/features/plugins/sites/matchPattern';
import { effectivePluginView } from '@/features/plugins/storage/effectivePluginView';
import type { TranslationKey } from '@/utils/translations';

import { displayName, pickLocalized } from '../components/PluginIdentity';
import { requestPluginContentScriptSync } from '../utils/pluginEnablement';
import {
  type AccessSite,
  CATALOG_SITES,
  catalogSiteForUrl,
  otherWebsiteEntries,
  siteCoverageEntries,
  siteCoverageOn,
  siteGrantsToRemove,
} from '../utils/siteAccessSites';
import type { CoverageRefusal, useCustomWebsites } from './useCustomWebsites';
import type { usePopupPlugins } from './usePopupPlugins';
import type { UndoOffer, WithdrawUndoOffer } from './useUndoToast';

type Coverage = Pick<
  ReturnType<typeof useCustomWebsites>,
  | 'customWebsites'
  | 'setHostCoverage'
  | 'removeEntries'
  | 'restoreEntries'
  | 'handleRemoveWebsite'
  | 'toggleQuickWebsite'
>;

/** `unknown` until the browser has answered, so no site flashes as not allowed. */
export type SiteAccessState = 'unknown' | 'granted' | 'none';

export interface CatalogSiteRow {
  readonly site: AccessSite;
  readonly access: SiteAccessState;
  /** The features that are on there, by name, Prompt Manager first. */
  readonly features: readonly string[];
}

/** Prompt Manager's switch for the open page, as a row of that site's feature list. */
export interface ActiveSitePrompt {
  readonly enabled: boolean;
  /** Called from the switch's click: Firefox asks for access only inside the gesture. */
  readonly setEnabled: (enabled: boolean) => Promise<CoverageRefusal | null>;
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

/** Whether any of the origins is granted. An unanswerable check counts as granted, as elsewhere. */
async function holdsAny(origins: readonly string[]): Promise<boolean> {
  if (!browser.permissions?.contains) return true;
  for (const origin of origins) {
    try {
      if (await browser.permissions.contains({ origins: [origin] })) return true;
    } catch {
      return true;
    }
  }
  return false;
}

function requiredHostPermissions(): ReadonlySet<string> {
  try {
    return new Set(browser.runtime.getManifest().host_permissions ?? []);
  } catch {
    return new Set();
  }
}

function pageHost(url: string): string | null {
  try {
    const { protocol, host } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? host.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * The site access card's state: which supported sites Voyager can reach, the
 * features on there, revoking a site with an undo, and Prompt Manager's row on
 * the open site, which reuses a site's existing grant instead of asking again.
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
  const [checks, setChecks] = useState(0);
  const [revoking, setRevoking] = useState<string | null>(null);
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
    void Promise.all(
      CATALOG_SITES.map(async (site) => [site.id, await holdsAny(site.origins)] as const),
    ).then((answers) => {
      if (active) setGranted(new Set(answers.filter(([, held]) => held).map(([id]) => id)));
    });
    return () => {
      active = false;
    };
  }, [checks]);

  const { pluginManifests, pluginState, legacySettings } = plugins;
  const rows = useMemo(
    (): readonly CatalogSiteRow[] =>
      CATALOG_SITES.map((site) => {
        const urls = site.hosts.map((host) => `https://${host}/`);
        const on = pluginManifests.filter(
          (plugin) =>
            !OFFICIAL_IDS.has(plugin.id) &&
            urls.some((url) => matchesAnyPattern(url, plugin.matches)) &&
            effectivePluginView(plugin, pluginState, legacySettings).enabled,
        );
        return {
          site,
          access: granted === null ? 'unknown' : granted.has(site.id) ? 'granted' : 'none',
          features: [
            ...(siteCoverageOn(coverage.customWebsites, site) ? [t('promptManagerOptions')] : []),
            ...on.map((plugin) => displayName(pickLocalized(plugin, 'name', language))),
          ],
        };
      }),
    [coverage.customWebsites, granted, language, legacySettings, pluginManifests, pluginState, t],
  );

  const otherWebsites = useMemo(
    () => otherWebsiteEntries(coverage.customWebsites),
    [coverage.customWebsites],
  );

  const host = pageHost(activeUrl);
  const { customWebsites, setHostCoverage } = coverage;
  const activeSite = useMemo((): ActiveSitePrompt | null => {
    if (!host) return null;
    const site = catalogSiteForUrl(activeUrl);
    return {
      enabled: customWebsitesIncludeHost(customWebsites, host),
      setEnabled: async (enabled) => {
        // Firefox keeps the gesture only for a request made before any other await.
        const reachable =
          enabled && site !== undefined
            ? isFirefox()
              ? granted?.has(site.id) === true
              : await holdsAny(site.origins)
            : false;
        const refusal = await setHostCoverage(host, enabled, reachable);
        recheck();
        return refusal;
      },
    };
  }, [activeUrl, customWebsites, granted, host, recheck, setHostCoverage]);

  /** Gives the site back its grants and coverage, from the revoke's undo button. */
  const restore = useCallback(
    (origins: readonly string[], entries: readonly string[]): void => {
      if (origins.length === 0 || !browser.permissions?.request) {
        void coverage.restoreEntries(entries);
        return;
      }
      const ask = (): Promise<boolean> =>
        browser.permissions.request({ origins: [...origins] }).catch(() => false);
      const finish = async (regranted: boolean): Promise<void> => {
        if (regranted) void requestPluginContentScriptSync();
        else await coverage.removeEntries(entries);
        recheck();
      };
      if (isFirefox()) {
        void ask().then(async (regranted) => {
          if (regranted) await coverage.restoreEntries(entries);
          await finish(regranted);
        });
        return;
      }
      void (async () => {
        // Saved first: the browser's prompt may close the popup before it answers.
        await coverage.restoreEntries(entries);
        await finish(await ask());
      })();
    },
    [coverage, recheck],
  );

  /** Removes every grant that reaches the site and turns off its Prompt Manager entries. */
  const revoke = useCallback(
    async (site: AccessSite, returnFocus?: () => HTMLElement | null): Promise<void> => {
      setRevoking(site.id);
      try {
        const entries = siteCoverageEntries(coverage.customWebsites, site);
        const grants = await Promise.resolve()
          .then(() => browser.permissions.getAll())
          .then((all) => all.origins ?? [])
          .catch(() => null);
        const required = requiredHostPermissions();
        const origins = siteGrantsToRemove(site, grants, entries).filter(
          (origin) => !required.has(origin),
        );
        await coverage.removeEntries(entries);
        if (origins.length > 0) {
          try {
            await browser.permissions.remove({ origins });
          } catch (error) {
            logger.warn('Could not remove site access', { site: site.id, error: String(error) });
            await coverage.restoreEntries(entries);
            return;
          }
        }
        onUndoOffer({
          message: t('siteAccessRemoved').replace('{site}', () => site.label),
          undo: () => restore(origins, entries),
          returnFocus,
        });
      } finally {
        setRevoking(null);
        recheck();
      }
    },
    [coverage, onUndoOffer, recheck, restore, t],
  );

  /** Removes an added website; the undo adds it back through the usual access request. */
  const removeWebsite = useCallback(
    async (website: string, returnFocus?: () => HTMLElement | null): Promise<void> => {
      await coverage.handleRemoveWebsite(website);
      onUndoOffer({
        message: t('siteAccessRemoved').replace('{site}', () => website),
        undo: () => void coverage.toggleQuickWebsite(website, false),
        returnFocus,
      });
    },
    [coverage, onUndoOffer, t],
  );

  return { rows, otherWebsites, activeSite, revoking, revoke, removeWebsite };
}

export type SiteAccess = ReturnType<typeof useSiteAccess>;
