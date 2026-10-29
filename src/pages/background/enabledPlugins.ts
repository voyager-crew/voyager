import { StorageKeys } from '@/core/types/common';
import { isPluginEnabled } from '@/features/plugins/storage/pluginDefaults';
import { promptCoverageBindingFor } from '@/features/plugins/storage/promptCoverageBinding';
import type { PluginManifest } from '@/features/plugins/types';

/** A page pattern's host, unless it is a wildcard (a companion frame such as Claude's artifacts). */
function pageHost(pattern: string): string | null {
  return /^https?:\/\/([^/*]+)\//i.exec(pattern)?.[1] ?? null;
}

/**
 * Prompt Manager's catalog plugin, cut to the pages its coverage entries cover,
 * or null where none is. Its switch is the coverage list, not a plugin-state
 * entry, so registration follows the list the way the page decides it; it runs
 * only in the top frame, so companion frames stay out.
 */
function coveredPromptManager(plugin: PluginManifest, coverage: unknown): PluginManifest | null {
  const matches = plugin.matches.filter((pattern) => {
    const host = pageHost(pattern);
    return host !== null && promptCoverageBindingFor(plugin.id, `https://${host}/`)?.read(coverage);
  });
  return matches.length > 0 ? { ...plugin, matches } : null;
}

/** The coverage list, or none when it cannot be read: Prompt Manager then registers nothing. */
async function loadPromptCoverage(): Promise<unknown> {
  try {
    const stored = await chrome.storage.sync.get({ [StorageKeys.PROMPT_CUSTOM_WEBSITES]: [] });
    return stored?.[StorageKeys.PROMPT_CUSTOM_WEBSITES];
  } catch {
    return [];
  }
}

/**
 * The plugins that are on, from the catalog `loadCatalog` returns: the ones the
 * user turned on, plus default-on builtins the user has not turned off.
 * Plugin enable state (storage.local) is the single source of truth; content
 * script registrations and permissions are derived from it. Prompt Manager's
 * catalog plugin is the exception: it is on where the coverage list covers its
 * host, whatever plugin state says, so it runs there with no other plugin on.
 */
export async function loadEnabledPlugins(
  loadCatalog: () => Promise<readonly PluginManifest[]>,
): Promise<PluginManifest[]> {
  let state: unknown = {};
  try {
    const stored = await chrome.storage.local.get({ [StorageKeys.PLUGINS_STATE]: {} });
    state = stored?.[StorageKeys.PLUGINS_STATE];
  } catch {
    return [];
  }
  const entries =
    state && typeof state === 'object' && !Array.isArray(state)
      ? (state as Record<string, { enabled?: unknown } | undefined>)
      : {};
  const coverage = await loadPromptCoverage();
  const catalog = await loadCatalog();
  return catalog.flatMap((plugin) => {
    if (promptCoverageBindingFor(plugin.id)) {
      const covered = coveredPromptManager(plugin, coverage);
      return covered ? [covered] : [];
    }
    return isPluginEnabled(entries, plugin.id) ? [plugin] : [];
  });
}
