import { useCallback, useRef, useState } from 'react';

import browser from 'webextension-polyfill';

import { StorageKeys } from '@/core/types/common';
import { isFirefox, supportsOptionalHostPermissions } from '@/core/utils/browser';
import {
  customWebsiteOriginPatterns,
  customWebsitesIncludeHost,
  normalizeCustomWebsite,
  sanitizeCustomWebsites,
} from '@/core/utils/customWebsites';
import { pluginsToOriginPatterns } from '@/features/plugins/runtime/siteRegistration';
import { matchesAnyPattern, patternWithinAny } from '@/features/plugins/sites/matchPattern';
import type { PluginManifest } from '@/features/plugins/types';
import type { TranslationKey } from '@/utils/translations';

import { catalogSiteForEntry } from '../utils/siteAccessSites';

export interface CustomWebsitesOptions {
  t: (key: TranslationKey) => string;
  /** The complete catalog, including disabled plugins and plugins on other sites. */
  pluginManifests: readonly Pick<PluginManifest, 'matches'>[];
  refreshActiveTabContext: () => Promise<void>;
  writeSyncStorage: (payload: Record<string, unknown>) => Promise<void>;
}

/** Why a site's coverage entry was not added: the browser refused or could not grant access. */
export type CoverageRefusal = 'invalid' | 'failed' | 'unsupported' | 'denied';

export const COVERAGE_REFUSAL_MESSAGES: Readonly<Record<CoverageRefusal, TranslationKey>> = {
  invalid: 'invalidUrl',
  failed: 'permissionRequestFailed',
  unsupported: 'pluginUnsupportedPlatform',
  denied: 'permissionDenied',
};

function originPatternsForDomain(domain: string): string[] | null {
  try {
    return customWebsiteOriginPatterns(domain);
  } catch {
    return null;
  }
}

/**
 * Prompt Manager website coverage (`gvPromptCustomWebsites`) and its shared
 * optional host permissions. Every coverage read and write goes through here.
 */
export function useCustomWebsites({
  t,
  pluginManifests,
  refreshActiveTabContext,
  writeSyncStorage,
}: CustomWebsitesOptions) {
  const [customWebsites, setCustomWebsites] = useState<string[]>([]);
  // The list as last set, for an action that runs after a later render (an undo offer).
  const current = useRef<string[]>([]);
  const [newWebsiteInput, setNewWebsiteInput] = useState('');
  const [websiteError, setWebsiteError] = useState('');

  const show = useCallback((list: string[]): void => {
    current.current = list;
    setCustomWebsites(list);
  }, []);

  const commit = useCallback(
    async (list: string[]): Promise<void> => {
      show(list);
      await writeSyncStorage({ [StorageKeys.PROMPT_CUSTOM_WEBSITES]: list });
    },
    [show, writeSyncStorage],
  );

  const hydrateFromStorage = useCallback(
    (raw: Record<string, unknown>): void => {
      const storedWebsites = raw[StorageKeys.PROMPT_CUSTOM_WEBSITES];
      const rawWebsites: unknown[] = Array.isArray(storedWebsites) ? storedWebsites : [];
      const loaded = sanitizeCustomWebsites(rawWebsites);
      show(loaded);
      if (
        rawWebsites.length !== loaded.length ||
        rawWebsites.some((website, index) => website !== loaded[index])
      ) {
        void writeSyncStorage({ [StorageKeys.PROMPT_CUSTOM_WEBSITES]: loaded });
      }

      // A denied prompt may close the popup before its optimistic write is rolled back.
      void (async () => {
        if (!loaded.length || !browser.permissions?.contains) return;
        const hasAnyPermission = async (domain: string) => {
          try {
            const origins = customWebsiteOriginPatterns(domain);
            if (!origins) return false;
            // A supported site's own grant (made by one of its plugins) runs Prompt Manager too.
            for (const origin of [...origins, ...(catalogSiteForEntry(domain)?.origins ?? [])]) {
              if (await browser.permissions.contains({ origins: [origin] })) return true;
            }
            return false;
          } catch {
            return true; // Avoid destructive cleanup on unexpected permission API errors.
          }
        };
        const filtered = (
          await Promise.all(
            loaded.map(async (domain) => ({ domain, ok: await hasAnyPermission(domain) })),
          )
        )
          .filter((item) => item.ok)
          .map((item) => item.domain);
        if (filtered.length !== loaded.length) await commit(filtered);
      })();
    },
    [commit, show, writeSyncStorage],
  );

  const requestAccess = useCallback(
    async (domain: string): Promise<CoverageRefusal | null> => {
      const origins = originPatternsForDomain(domain);
      if (!origins) return 'invalid';
      if (!browser.permissions?.request || !browser.permissions?.contains) return 'failed';
      if (!supportsOptionalHostPermissions()) return 'unsupported';
      try {
        // Firefox must request directly in the user gesture, before any awaited API.
        if (!isFirefox()) {
          const alreadyGranted = await browser.permissions.contains({ origins });
          if (alreadyGranted) {
            await refreshActiveTabContext();
            return null;
          }
        }
        const granted = await browser.permissions.request({ origins });
        if (!granted) return 'denied';
        await refreshActiveTabContext();
        return null;
      } catch (error) {
        console.error('[Gemini Voyager] Failed to request permissions for custom website:', error);
        return 'failed';
      }
    },
    [refreshActiveTabContext],
  );

  /**
   * Adds one entry and asks for its access in the order each browser needs:
   * Firefox asks first, inside the gesture; the others save first because the
   * prompt may close the popup, and take the entry back out if access is refused.
   */
  const addWithAccess = useCallback(
    async (domain: string, onSaved?: () => void): Promise<CoverageRefusal | null> => {
      if (isFirefox()) {
        const refusal = await requestAccess(domain);
        if (refusal) return refusal;
        await commit([...current.current, domain]);
        onSaved?.();
        return null;
      }
      const previous = current.current;
      await commit([...previous, domain]);
      onSaved?.();
      const refusal = await requestAccess(domain);
      if (refusal) await commit(previous);
      return refusal;
    },
    [commit, requestAccess],
  );

  const revokeCustomWebsitePermission = useCallback(
    async (domain: string, remainingWebsites: readonly string[]): Promise<void> => {
      const origins = originPatternsForDomain(domain);
      if (!origins || !browser.permissions?.remove) return;
      const normalized = domain
        .trim()
        .toLowerCase()
        .replace(/^www\./, '');
      // Shared domains keep their grant even if the matching plugin is disabled.
      if (
        normalized &&
        pluginManifests.some((plugin) =>
          matchesAnyPattern(`https://${normalized}/`, plugin.matches),
        )
      )
        return;
      // A `*.deepseek.com` grant also serves `chat.deepseek.com` plugins and remaining subdomain sites.
      const stillNeeded = [
        ...pluginsToOriginPatterns(pluginManifests),
        ...remainingWebsites.flatMap((website) => originPatternsForDomain(website) ?? []),
      ];
      if (stillNeeded.some((pattern) => patternWithinAny(pattern, origins))) return;
      try {
        await browser.permissions.remove({ origins });
      } catch (error) {
        console.warn('[Gemini Voyager] Failed to revoke permission for', domain, error);
      }
    },
    [pluginManifests],
  );

  const onWebsiteInputChange = useCallback((value: string): void => {
    setNewWebsiteInput(value);
    setWebsiteError('');
  }, []);

  const handleAddWebsite = useCallback(async (): Promise<void> => {
    setWebsiteError('');
    if (!newWebsiteInput.trim()) return;
    const normalized = normalizeCustomWebsite(newWebsiteInput);
    if (!normalized || current.current.includes(normalized)) {
      setWebsiteError(t('invalidUrl'));
      return;
    }
    const refusal = await addWithAccess(normalized, () => setNewWebsiteInput(''));
    if (refusal) setWebsiteError(t(COVERAGE_REFUSAL_MESSAGES[refusal]));
  }, [newWebsiteInput, t, addWithAccess]);

  const handleRemoveWebsite = useCallback(
    async (website: string): Promise<void> => {
      const updated = current.current.filter((entry) => entry !== website);
      await commit(updated);
      await revokeCustomWebsitePermission(website, updated);
    },
    [commit, revokeCustomWebsitePermission],
  );

  const toggleQuickWebsite = useCallback(
    async (domain: string, isEnabled: boolean): Promise<void> => {
      if (isEnabled) {
        await handleRemoveWebsite(domain);
        return;
      }
      const refusal = await addWithAccess(domain);
      if (refusal) setWebsiteError(t(COVERAGE_REFUSAL_MESSAGES[refusal]));
    },
    [addWithAccess, handleRemoveWebsite, t],
  );

  /**
   * Prompt Manager on the open site's host, as its row switches it: on while
   * any entry covers the host, and off by removing every entry that does. A
   * site Voyager can already reach (`accessGranted`) is not asked again.
   */
  const setHostCoverage = useCallback(
    async (
      host: string,
      enabled: boolean,
      accessGranted: boolean,
    ): Promise<CoverageRefusal | null> => {
      if (!enabled) {
        const covering = current.current.filter((entry) =>
          customWebsitesIncludeHost([entry], host),
        );
        if (covering.length === 0) return null;
        const updated = current.current.filter((entry) => !covering.includes(entry));
        await commit(updated);
        for (const entry of covering) await revokeCustomWebsitePermission(entry, updated);
        return null;
      }
      if (customWebsitesIncludeHost(current.current, host)) return null;
      const entry = normalizeCustomWebsite(host);
      if (!entry) return 'invalid';
      if (!accessGranted) return addWithAccess(entry);
      await commit([...current.current, entry]);
      await refreshActiveTabContext();
      return null;
    },
    [addWithAccess, commit, refreshActiveTabContext, revokeCustomWebsitePermission],
  );

  /** Takes entries out and leaves access alone: revoking a site removes its grants itself. */
  const removeEntries = useCallback(
    async (entries: readonly string[]): Promise<void> => {
      const updated = current.current.filter((entry) => !entries.includes(entry));
      if (updated.length !== current.current.length) await commit(updated);
    },
    [commit],
  );

  /** Puts entries back, as an undone revoke does around its own access request. */
  const restoreEntries = useCallback(
    async (entries: readonly string[]): Promise<void> => {
      const missing = entries.filter((entry) => !current.current.includes(entry));
      if (missing.length) await commit([...current.current, ...missing]);
    },
    [commit],
  );

  return {
    customWebsites,
    newWebsiteInput,
    websiteError,
    hydrateFromStorage,
    onWebsiteInputChange,
    handleAddWebsite,
    handleRemoveWebsite,
    toggleQuickWebsite,
    setHostCoverage,
    removeEntries,
    restoreEntries,
  };
}
