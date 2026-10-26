/**
 * When the Prompt Manager and its composer features run on a page.
 *
 * The content entry decides which of these a page gets; this module owns the
 * lifetimes from there on: what mounts, what follows a popup setting without a
 * reload, and what page teardown stops. The site's own facts come from its
 * `PromptSiteAdapter`.
 */
import { logger } from '@/core/services/LoggerService';
import { promptStorageService } from '@/core/services/StorageService';
import { CleanupPositions } from '@/core/types/cleanupPositions';
import { StorageKeys } from '@/core/types/common';
import type { CleanupManager } from '@/core/utils/cleanupManager';
import { customWebsitesIncludeHost } from '@/core/utils/customWebsites';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';
import type { PromptSiteAdapter } from '@/features/prompt/PromptSiteAdapter';
import type { PromptIdentity } from '@/features/prompt/model/promptTextMatch';

import {
  type NativeFeature,
  type NativeFeatureToggle,
  type NativeFeatureToggleController,
  createNativeFeatureToggle,
  mountNativeFeature,
} from '../featureLifecycle';
import { type SentPromptChipsController, startSentPromptChips } from './SentPromptChips';
import { startPromptManager } from './index';
import { startStoredPromptSlashCommand } from './slashPrompt';

const engineLogger = logger.createChild('PromptManagerEngine');

export interface PromptManagerEngine {
  /**
   * Slash completion, following its popup setting, and sent-prompt chips.
   * Does nothing on a site without slash completion.
   */
  startComposerFeatures(beforeMount?: () => void): Promise<void>;
  /** Mounts the panel for the rest of the page. */
  startPanel(): Promise<void>;
  /**
   * Mounts the panel while the custom-website list covers `host` and follows
   * that list live: removing a site only stops future injections, so the page
   * that is already open has to unmount itself.
   */
  followCoverage(host: string): Promise<void>;
}

type StorageChanges = Record<string, chrome.storage.StorageChange>;

const SLASH_TOGGLE: NativeFeatureToggle = {
  key: StorageKeys.SLASH_PROMPT_ENABLED,
  // A removed setting is the enabled default again.
  isEnabled: (value) => value !== false,
  areas: ['sync'],
};

/** Whether the custom-website list covers `host`, a `location.host`-shaped value. */
export async function readPromptCoverage(host: string): Promise<boolean> {
  try {
    const result = await chrome.storage.sync.get({ [StorageKeys.PROMPT_CUSTOM_WEBSITES]: [] });
    return customWebsitesIncludeHost(result?.[StorageKeys.PROMPT_CUSTOM_WEBSITES], host);
  } catch (error) {
    warnUnlessInvalidated('Failed to read the custom-website list', error);
    return false;
  }
}

async function readSlashEnabled(): Promise<boolean> {
  try {
    const result = await chrome.storage.sync.get({ [StorageKeys.SLASH_PROMPT_ENABLED]: true });
    return SLASH_TOGGLE.isEnabled(result?.[StorageKeys.SLASH_PROMPT_ENABLED]);
  } catch (error) {
    warnUnlessInvalidated('Failed to read the slash setting; keeping it on', error);
    return true;
  }
}

function toIdentities(value: unknown): PromptIdentity[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const { id, name, text } = item as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string' || typeof text !== 'string') return [];
    return [{ id, name, text }];
  });
}

async function readPromptIdentities(): Promise<PromptIdentity[]> {
  try {
    const stored = await promptStorageService.get<unknown>(StorageKeys.PROMPT_ITEMS);
    return stored.success ? toIdentities(stored.data) : [];
  } catch (error) {
    warnUnlessInvalidated('Failed to read saved prompts; sent prompts stay expanded', error);
    return [];
  }
}

function warnUnlessInvalidated(message: string, error: unknown): void {
  if (!isExtensionContextInvalidatedError(error)) engineLogger.warn(message, { error });
}

/**
 * `lifetime` is the content script's page lifetime: once a newer copy retired
 * this one, a start still in flight mounts nothing and registers nothing.
 */
export function createPromptManagerEngine(
  adapter: PromptSiteAdapter,
  cleanup: CleanupManager,
  lifetime?: AbortSignal,
): PromptManagerEngine {
  const retired = (): boolean => lifetime?.aborted === true;
  const slash: NativeFeature = {
    id: 'slashPrompt',
    position: CleanupPositions.DestroySlashPromptFeatureInstance,
    start: async () => (await startStoredPromptSlashCommand(() => adapter.scheme())).destroy,
    toggle: SLASH_TOGGLE,
  };
  const panel: NativeFeature = {
    id: 'promptManager',
    position: CleanupPositions.DestroyPromptManagerInstance,
    start: async () => (await startPromptManager(adapter)).destroy,
  };
  const toggles: NativeFeatureToggleController[] = [];
  let chips: SentPromptChipsController | null = null;
  let listening = false;

  const onStorageChanged = (changes: StorageChanges, areaName: string): void => {
    for (const toggle of toggles) toggle.handleChange(changes, areaName);
    const items = changes[StorageKeys.PROMPT_ITEMS];
    // Replaced wholesale: a renamed or deleted prompt must stop labelling turns.
    if (chips && items && areaName === 'local') chips.setPrompts(toIdentities(items.newValue));
  };

  const dispose = (): void => {
    chrome.storage.onChanged.removeListener(onStorageChanged);
    for (const toggle of toggles) toggle.destroy();
  };

  /**
   * Its own listener rather than the content entry's: that one serves only
   * gemini.google.com, and catalog and custom pages never install it.
   */
  function follow(toggle: NativeFeatureToggleController): void {
    toggles.push(toggle);
    if (listening) return;
    listening = true;
    chrome.storage.onChanged.addListener(onStorageChanged);
    cleanup.registerCleanupFunction(dispose, CleanupPositions.RemoveStorageOnChangedListener);
  }

  /** A feature that fails to start is lost alone; the page's other features still start. */
  async function applyInitial(
    toggle: NativeFeatureToggleController,
    enabled: boolean,
    what: string,
  ): Promise<void> {
    try {
      await toggle.applyInitial(enabled);
    } catch (error) {
      warnUnlessInvalidated(`Failed to start ${what}`, error);
    }
  }

  return {
    async startComposerFeatures(beforeMount) {
      if (!adapter.slash) return;
      const slashToggle = createNativeFeatureToggle(cleanup, {
        ...slash,
        start: () => {
          beforeMount?.();
          return slash.start();
        },
      });
      follow(slashToggle);
      const enabled = await readSlashEnabled();
      // Reuse the existing setting wait; native startup must not wait for catalog storage too.
      beforeMount?.();
      await applyInitial(slashToggle, enabled, 'slash completion');

      // Chips restore what a sent slash token looked like. They follow the
      // site, never the slash setting: turning slash off must not re-expand
      // turns that were already sent.
      const prompts = await readPromptIdentities();
      // Retired during the reads: teardown already ran and would never stop them.
      if (retired()) return;
      chips = startSentPromptChips({ prompts, scheme: () => adapter.scheme() });
      cleanup.registerCleanupFunction(chips.destroy, CleanupPositions.DestroySentPromptChips);
    },

    async startPanel() {
      await mountNativeFeature(cleanup, panel, lifetime);
    },

    async followCoverage(host) {
      const coverage = createNativeFeatureToggle(cleanup, {
        ...panel,
        toggle: {
          key: StorageKeys.PROMPT_CUSTOM_WEBSITES,
          isEnabled: (value) => customWebsitesIncludeHost(value, host),
          areas: ['sync'],
        },
      });
      follow(coverage);
      await applyInitial(coverage, await readPromptCoverage(host), 'the Prompt Manager');
    },
  };
}
