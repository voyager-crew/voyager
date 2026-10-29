import { useCallback, useEffect, useRef, useState } from 'react';

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
import { withPluginStorageLock } from '@/features/plugins/storage/pluginStorageLock';
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
  /**
   * Where the browser will not ask from this page (the request throws or
   * reports no gesture, as inside the Voyager panel's frame): hands the request
   * to a page that can ask and says whether that page opened. The popup has none.
   */
  askElsewhere?: () => Promise<boolean>;
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

/** A refusal, or the request handed to a page that can ask (`askElsewhere`), which reports for itself. */
type AccessAnswer = CoverageRefusal | 'elsewhere' | null;

const COVERAGE_KEY = StorageKeys.PROMPT_CUSTOM_WEBSITES;

/** Whether the stored value already reads as `list`, so there is nothing to write. */
function storedAs(raw: unknown, list: readonly string[]): boolean {
  if (!Array.isArray(raw)) return list.length === 0;
  return raw.length === list.length && raw.every((entry, index) => entry === list[index]);
}

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
 * optional host permissions. Every coverage read and write in the popup and
 * the panel goes through here; a supported site's switch writes through its
 * coverage binding. Either page may stay open while another changes the list,
 * so each write applies only its own change to the list as stored now, and
 * the shown list follows storage.
 */
export function useCustomWebsites({
  t,
  pluginManifests,
  refreshActiveTabContext,
  writeSyncStorage,
  askElsewhere,
}: CustomWebsitesOptions) {
  const [customWebsites, setCustomWebsites] = useState<string[]>([]);
  // The list as last shown, for an action that runs after a later render (an undo offer).
  const current = useRef<string[]>([]);
  const [newWebsiteInput, setNewWebsiteInput] = useState('');
  const [websiteError, setWebsiteError] = useState('');

  const show = useCallback((list: string[]): void => {
    current.current = list;
    setCustomWebsites(list);
  }, []);

  // Another popup, the panel, a tab or the background may change the list meanwhile.
  useEffect(() => {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'sync' && Object.hasOwn(changes, COVERAGE_KEY)) {
        show(sanitizeCustomWebsites(changes[COVERAGE_KEY].newValue));
      }
    };
    chrome.storage?.onChanged?.addListener(onChanged);
    return () => chrome.storage?.onChanged?.removeListener(onChanged);
  }, [show]);

  /**
   * One change to the list as stored now, read under the plugin-storage lock
   * as the coverage binding writes, so a website saved elsewhere since this
   * page read the list stays. A failed read throws and writes nothing.
   */
  const update = useCallback(
    async (change: (stored: string[]) => string[]): Promise<void> => {
      const next = await withPluginStorageLock(async () => {
        const stored: unknown = await chrome.storage.sync.get(COVERAGE_KEY);
        if (!stored || typeof stored !== 'object') throw new Error('Coverage read failed');
        const raw = (stored as Record<string, unknown>)[COVERAGE_KEY];
        const list = change(sanitizeCustomWebsites(raw));
        if (!storedAs(raw, list)) await writeSyncStorage({ [COVERAGE_KEY]: list });
        return list;
      });
      show(next);
    },
    [show, writeSyncStorage],
  );

  /** Takes entries out, leaving access alone, and says where each one stood. */
  const removeEntries = useCallback(
    async (entries: readonly string[]): Promise<PlacedEntry[]> => {
      let removed: PlacedEntry[] = [];
      await update((stored) => {
        const result = withoutEntries(stored, entries);
        removed = result.removed;
        return result.next;
      });
      return removed;
    },
    [update],
  );

  /** Puts removed entries back where they stood. */
  const restoreEntries = useCallback(
    (entries: readonly PlacedEntry[]): Promise<void> =>
      update((stored) => withEntriesRestored(stored, entries)),
    [update],
  );

  const hydrateFromStorage = useCallback(
    (raw: Record<string, unknown>): void => {
      const storedWebsites = raw[StorageKeys.PROMPT_CUSTOM_WEBSITES];
      const rawWebsites: unknown[] = Array.isArray(storedWebsites) ? storedWebsites : [];
      const loaded = sanitizeCustomWebsites(rawWebsites);
      show(loaded);
      if (!storedAs(rawWebsites, loaded)) {
        // Sanitizes the list as stored by then, in case another page changed it since.
        void update((stored) => stored).catch(() => undefined);
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
      })().catch(() => undefined);
    },
    [removeEntries, show, update],
  );

  const requestAccess = useCallback(
    async (domain: string): Promise<AccessAnswer> => {
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
        if (askElsewhere && (await askElsewhere())) return 'elsewhere';
        console.error('[Gemini Voyager] Failed to request permissions for custom website:', error);
        return 'failed';
      }
    },
    [askElsewhere, refreshActiveTabContext],
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
    ): Promise<AccessAnswer> => {
      const saved = async (): Promise<boolean> => {
        try {
          await save();
        } catch {
          return false;
        }
        onSaved?.();
        return true;
      };
      if (isFirefox()) {
        const answer = await requestAccess(domain);
        if (answer) return answer;
        return (await saved()) ? null : 'unsaved';
      }
      if (!(await saved())) return 'unsaved';
      const answer = await requestAccess(domain);
      // Left in place if this fails: the next popup's hydration drops an entry without access.
      if (answer) await takeBack().catch(() => undefined);
      return answer;
    },
    [requestAccess],
  );

  const addEntry = useCallback(
    (domain: string, onSaved?: () => void) => {
      // Only an entry this add put in is taken back; one saved elsewhere meanwhile stays.
      let added = false;
      return addWithAccess(
        domain,
        () =>
          update((stored) => {
            if (stored.includes(domain)) return stored;
            added = true;
            return [...stored, domain];
          }),
        () => (added ? removeEntries([domain]) : Promise.resolve()),
        onSaved,
      );
    },
    [addWithAccess, removeEntries, update],
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
    const typed = newWebsiteInput;
    if (!typed.trim()) return;
    const normalized = normalizeCustomWebsite(typed);
    if (!normalized || current.current.includes(normalized)) {
      setWebsiteError(t('invalidUrl'));
      return;
    }
    const answer = await addEntry(normalized, () => setNewWebsiteInput(''));
    // The page that asks instead starts empty, so the typed text stays here for another try.
    if (answer === 'elsewhere') setNewWebsiteInput(typed);
    else if (answer) setWebsiteError(t(COVERAGE_REFUSAL_MESSAGES[answer]));
  }, [newWebsiteInput, t, addEntry]);

  const handleRemoveWebsite = useCallback(
    async (website: string): Promise<RemovedWebsite> => {
      let removed: PlacedEntry[];
      try {
        removed = await removeEntries([website]);
      } catch {
        // The list could not be read, so nothing changed: the website and its access stay.
        return { entries: [], origins: [], failed: true };
      }
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
      const answer = await addEntry(domain);
      if (answer && answer !== 'elsewhere') setWebsiteError(t(COVERAGE_REFUSAL_MESSAGES[answer]));
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
        const answer = await addWithAccess(
          entry,
          () => writeBinding(binding, true),
          () => writeBinding(binding, false),
        );
        // Handed to a page that can ask, which reports for itself.
        return { refusal: answer === 'elsewhere' ? null : answer, removed: [] };
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
   * Where this page cannot ask, the request goes to a page that can
   * (`askElsewhere`), which reports for itself: the entries stay out and the
   * answer is true, as there is nothing to report here.
   */
  const restoreAccess = useCallback(
    async (origins: readonly string[], entries: readonly PlacedEntry[]): Promise<boolean> => {
      try {
        if (origins.length === 0) {
          await restoreEntries(entries);
          return true;
        }
        if (!browser.permissions?.request) return false;
        const ask = async (): Promise<AccessAnswer> => {
          try {
            const granted = await browser.permissions.request({ origins: [...origins] });
            return granted === true ? null : 'denied';
          } catch {
            return askElsewhere && (await askElsewhere()) ? 'elsewhere' : 'failed';
          }
        };
        // Firefox keeps the gesture only for a request made before any other await.
        const pending = isFirefox() ? ask() : null;
        await restoreEntries(entries);
        const answer = await (pending ?? ask());
        if (answer) {
          await removeEntries(entries.map(({ entry }) => entry));
          return answer === 'elsewhere';
        }
      } catch {
        // The list could not be read: nothing was given back.
        return false;
      }
      await refreshActiveTabContext();
      return true;
    },
    [askElsewhere, refreshActiveTabContext, removeEntries, restoreEntries],
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
