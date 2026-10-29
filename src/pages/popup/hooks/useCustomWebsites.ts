import { useCallback, useRef, useState } from 'react';

import browser from 'webextension-polyfill';

import { StorageKeys } from '@/core/types/common';
import { isFirefox, supportsOptionalHostPermissions } from '@/core/utils/browser';
import {
  customWebsiteOriginPatterns,
  normalizeCustomWebsite,
  sanitizeCustomWebsites,
} from '@/core/utils/customWebsites';
import { pluginsToOriginPatterns } from '@/features/plugins/runtime/siteRegistration';
import { matchesAnyPattern, patternWithinAny } from '@/features/plugins/sites/matchPattern';
import {
  type PromptCoverageBinding,
  setPromptCoverageEnabled,
} from '@/features/plugins/storage/promptCoverageBinding';
import type { PluginManifest } from '@/features/plugins/types';
import type { TranslationKey } from '@/utils/translations';

import {
  type PlacedEntry,
  removedEntries,
  withEntriesRestored,
  withoutEntries,
} from '../utils/coverageEntries';
import { promptManagerHostsCoveredBy } from '../utils/siteAccessSites';
import { listGrants } from '../utils/sitePermissions';

export interface CustomWebsitesOptions {
  t: (key: TranslationKey) => string;
  /** The complete catalog, including disabled plugins and plugins on other sites. */
  pluginManifests: readonly Pick<PluginManifest, 'matches'>[];
  refreshActiveTabContext: () => Promise<void>;
  writeSyncStorage: (payload: Record<string, unknown>) => Promise<void>;
}

/** Why coverage did not change: the browser refused or could not grant access, or storage failed. */
export type CoverageRefusal = 'invalid' | 'failed' | 'unsupported' | 'denied' | 'unsaved';

export const COVERAGE_REFUSAL_MESSAGES: Readonly<Record<CoverageRefusal, TranslationKey>> = {
  invalid: 'invalidUrl',
  failed: 'permissionRequestFailed',
  unsupported: 'pluginUnsupportedPlatform',
  denied: 'permissionDenied',
  unsaved: 'watermarkNotice_error',
};

/** What removing an added website took away, so its undo gives back exactly that. */
export interface RemovedWebsite {
  readonly entries: readonly PlacedEntry[];
  /** The grants removed with it: none when another website or a plugin still uses them. */
  readonly origins: readonly string[];
  /** The browser kept a grant it was asked to remove, so the website stays listed. */
  readonly failed: boolean;
}

export interface PromptCoverageResult {
  readonly refusal: CoverageRefusal | null;
  /** What switching off removed, at the positions it held. */
  readonly removed: readonly PlacedEntry[];
}

function originPatternsForDomain(domain: string): string[] | null {
  try {
    return customWebsiteOriginPatterns(domain);
  } catch {
    return null;
  }
}

/** The patterns of `origins` the browser holds as such, so an undo asks for exactly those again. */
async function heldPatterns(origins: readonly string[]): Promise<string[]> {
  const listed = await listGrants();
  if (listed) return origins.filter((origin) => listed.includes(origin));
  const held = await Promise.all(
    origins.map(async (origin) => {
      try {
        return await browser.permissions.contains({ origins: [origin] });
      } catch {
        return true;
      }
    }),
  );
  return origins.filter((_, index) => held[index]);
}

/**
 * Prompt Manager website coverage (`gvPromptCustomWebsites`) and its shared
 * optional host permissions. Every coverage read and write in the popup goes
 * through here; a supported site's switch writes through its coverage binding.
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

  /** Takes entries out, leaving access alone, and says where each one stood. */
  const removeEntries = useCallback(
    async (entries: readonly string[]): Promise<PlacedEntry[]> => {
      const { next, removed } = withoutEntries(current.current, entries);
      if (removed.length) await commit(next);
      return removed;
    },
    [commit],
  );

  /** Puts removed entries back where they stood. */
  const restoreEntries = useCallback(
    async (entries: readonly PlacedEntry[]): Promise<void> => {
      const next = withEntriesRestored(current.current, entries);
      if (next.length !== current.current.length) await commit(next);
    },
    [commit],
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
        const holds = async (origin: string) => browser.permissions.contains({ origins: [origin] });
        const hasAnyPermission = async (domain: string) => {
          try {
            const origins = customWebsiteOriginPatterns(domain);
            if (!origins) return false;
            for (const origin of origins) if (await holds(origin)) return true;
            // A supported page's own grant, as a plugin there asks for it, runs
            // Prompt Manager's catalog plugin on that page (the background
            // registers it by coverage); a grant for another page does not.
            for (const host of promptManagerHostsCoveredBy(domain)) {
              if (await holds(`https://${host}/*`)) return true;
            }
            return false;
          } catch {
            return true; // Avoid destructive cleanup on unexpected permission API errors.
          }
        };
        const answers = await Promise.all(loaded.map(hasAnyPermission));
        const unreachable = loaded.filter((_, index) => !answers[index]);
        if (unreachable.length) await removeEntries(unreachable);
      })();
    },
    [removeEntries, show, writeSyncStorage],
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
   * Saves an entry and asks for its access in the order each browser needs:
   * Firefox asks first, inside the gesture; the others save first because the
   * prompt may close the popup, and take the entry back if access is refused.
   */
  const addWithAccess = useCallback(
    async (
      domain: string,
      save: () => Promise<unknown>,
      takeBack: () => Promise<unknown>,
      onSaved?: () => void,
    ): Promise<CoverageRefusal | null> => {
      if (isFirefox()) {
        const refusal = await requestAccess(domain);
        if (refusal) return refusal;
        await save();
        onSaved?.();
        return null;
      }
      await save();
      onSaved?.();
      const refusal = await requestAccess(domain);
      if (refusal) await takeBack();
      return refusal;
    },
    [requestAccess],
  );

  const addEntry = useCallback(
    (domain: string, onSaved?: () => void) =>
      addWithAccess(
        domain,
        () => commit([...current.current, domain]),
        () => removeEntries([domain]),
        onSaved,
      ),
    [addWithAccess, commit, removeEntries],
  );

  /** Removes the grants only this entry used; `failed` when the browser kept them. */
  const revokeCustomWebsitePermission = useCallback(
    async (
      domain: string,
      remainingWebsites: readonly string[],
    ): Promise<{ origins: string[]; failed: boolean }> => {
      const kept = { origins: [], failed: false };
      const origins = originPatternsForDomain(domain);
      if (!origins || !browser.permissions?.remove) return kept;
      const normalized = domain
        .trim()
        .toLowerCase()
        .replace(/^www\./, '');
      // A host a plugin asks a grant for keeps it, even while that plugin is off.
      // A plugin for every website (`<all_urls>`, Visual effects) asks for none.
      if (
        normalized &&
        matchesAnyPattern(`https://${normalized}/`, pluginsToOriginPatterns(pluginManifests))
      )
        return kept;
      // A `*.deepseek.com` grant also serves `chat.deepseek.com` plugins and remaining subdomain sites.
      const stillNeeded = [
        ...pluginsToOriginPatterns(pluginManifests),
        ...remainingWebsites.flatMap((website) => originPatternsForDomain(website) ?? []),
      ];
      if (stillNeeded.some((pattern) => patternWithinAny(pattern, origins))) return kept;
      const held = await heldPatterns(origins);
      if (!held.length) return kept;
      try {
        if ((await browser.permissions.remove({ origins: held })) !== false) {
          return { origins: held, failed: false };
        }
      } catch (error) {
        console.warn('[Gemini Voyager] Failed to revoke permission for', domain, error);
      }
      return { origins: [], failed: true };
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
    const refusal = await addEntry(normalized, () => setNewWebsiteInput(''));
    if (refusal) setWebsiteError(t(COVERAGE_REFUSAL_MESSAGES[refusal]));
  }, [newWebsiteInput, t, addEntry]);

  const handleRemoveWebsite = useCallback(
    async (website: string): Promise<RemovedWebsite> => {
      const removed = await removeEntries([website]);
      const revoked = await revokeCustomWebsitePermission(website, current.current);
      if (!revoked.failed) return { entries: removed, origins: revoked.origins, failed: false };
      // The browser kept the access, so the website stays listed, as before.
      await restoreEntries(removed);
      return { entries: [], origins: [], failed: true };
    },
    [removeEntries, restoreEntries, revokeCustomWebsitePermission],
  );

  const toggleQuickWebsite = useCallback(
    async (domain: string, isEnabled: boolean): Promise<void> => {
      if (isEnabled) {
        await handleRemoveWebsite(domain);
        return;
      }
      const refusal = await addEntry(domain);
      if (refusal) setWebsiteError(t(COVERAGE_REFUSAL_MESSAGES[refusal]));
    },
    [addEntry, handleRemoveWebsite, t],
  );

  /** Writes a supported site's switch through its binding, and shows the stored result. */
  const writeBinding = useCallback(
    async (binding: PromptCoverageBinding, enabled: boolean) => {
      const change = await setPromptCoverageEnabled(binding, enabled);
      show(change.after);
      return change;
    },
    [show],
  );

  /**
   * Prompt Manager on a supported site's page, as its plugin row switches it:
   * the binding of that page's own host (an alias keeps its own entry). On
   * asks for the host's coverage access unless the page is already granted
   * (`accessGranted`); off removes every entry covering the host and returns
   * them, so an undo can restore a parent domain's entry exactly.
   */
  const setPromptCoverage = useCallback(
    async (
      binding: PromptCoverageBinding,
      enabled: boolean,
      accessGranted: boolean,
    ): Promise<PromptCoverageResult> => {
      try {
        if (!enabled) {
          const { before, after } = await writeBinding(binding, false);
          return { refusal: null, removed: removedEntries(before, after) };
        }
        if (binding.read(current.current)) return { refusal: null, removed: [] };
        const entry = normalizeCustomWebsite(binding.host);
        if (!entry) return { refusal: 'invalid', removed: [] };
        if (accessGranted) {
          await writeBinding(binding, true);
          await refreshActiveTabContext();
          return { refusal: null, removed: [] };
        }
        const refusal = await addWithAccess(
          entry,
          () => writeBinding(binding, true),
          () => writeBinding(binding, false),
        );
        return { refusal, removed: [] };
      } catch {
        return { refusal: 'unsaved', removed: [] };
      }
    },
    [addWithAccess, refreshActiveTabContext, writeBinding],
  );

  /**
   * Gives back removed entries and exactly the grants removed with them; false
   * when the browser refused or failed the grant, in which case the entries
   * stay out. The entries are saved before the browser answers: its prompt may
   * close the popup, and the background, hearing of the grant, must find them
   * rather than add a broader entry of its own (`example.org` for `example.org:3000`).
   */
  const restoreAccess = useCallback(
    async (origins: readonly string[], entries: readonly PlacedEntry[]): Promise<boolean> => {
      if (origins.length === 0) {
        await restoreEntries(entries);
        return true;
      }
      if (!browser.permissions?.request) return false;
      const ask = async (): Promise<boolean> => {
        try {
          return (await browser.permissions.request({ origins: [...origins] })) === true;
        } catch {
          return false;
        }
      };
      // Firefox keeps the gesture only for a request made before any other await.
      const answer = isFirefox() ? ask() : null;
      await restoreEntries(entries);
      if (!(await (answer ?? ask()))) {
        await removeEntries(entries.map(({ entry }) => entry));
        return false;
      }
      await refreshActiveTabContext();
      return true;
    },
    [refreshActiveTabContext, removeEntries, restoreEntries],
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
    setPromptCoverage,
    removeEntries,
    restoreEntries,
    restoreAccess,
  };
}
