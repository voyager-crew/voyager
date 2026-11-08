import { getCurrentLanguage } from '@/utils/languagePreference';

import { getTranslation } from './allTranslations';
import { type RefreshPromptText, showRefreshPromptCard } from './refreshPromptCard';

/**
 * After an update, ask the tabs still running the previous Voyager to refresh.
 *
 * Chrome does not put the new content script into tabs that were already open:
 * their old script is cut off from the extension, so Voyager quietly stops
 * working there until the page reloads. The background asks each tab on a
 * Voyager site whether a live script answers (`gv.content.ping`, answered in
 * `src/pages/content/index.tsx`); a tab that stays silent gets a small card
 * offering to refresh. Nothing reloads until the person clicks.
 */

/** Gives the plugin and custom-site sync, which re-inject some open tabs, time to land first. */
const SETTLE_MS = 4000;

export interface RefreshPromptDeps {
  /** URL patterns of every page Voyager's content script runs on. */
  readonly voyagerMatches: () => Promise<string[]>;
  readonly queryTabs: (urls: string[]) => Promise<chrome.tabs.Tab[]>;
  readonly isLive: (tabId: number) => Promise<boolean>;
  readonly showCard: (tabId: number, text: RefreshPromptText) => Promise<void>;
  readonly text: () => Promise<RefreshPromptText>;
  readonly wait: (ms: number) => Promise<void>;
}

/** Offer a refresh in every open Voyager tab whose script predates this update. */
export async function promptStaleTabsToRefresh(deps: RefreshPromptDeps): Promise<number> {
  await deps.wait(SETTLE_MS);
  const matches = await deps.voyagerMatches();
  if (!matches.length) return 0;
  let tabs: chrome.tabs.Tab[];
  try {
    tabs = await deps.queryTabs(matches);
  } catch {
    return 0;
  }
  let text: RefreshPromptText | null = null;
  let shown = 0;
  for (const tab of tabs) {
    // A discarded tab reloads with the new script when it is next opened.
    if (typeof tab.id !== 'number' || tab.discarded) continue;
    if (await deps.isLive(tab.id)) continue;
    text ??= await deps.text();
    try {
      await deps.showCard(tab.id, text);
      shown++;
    } catch {
      // The tab closed, navigated, or refuses injection; its next load is current anyway.
    }
  }
  return shown;
}

/** The main content script's own patterns, from the manifest and the plugin and custom-site registrations. */
async function voyagerMatches(): Promise<string[]> {
  const main = chrome.runtime.getManifest().content_scripts?.[0];
  const entry = main?.js?.[0];
  const patterns = new Set(main?.matches ?? []);
  try {
    const registered = (await chrome.scripting?.getRegisteredContentScripts?.()) ?? [];
    for (const script of registered) {
      if (!entry || !script.js?.some((file) => file.endsWith(entry))) continue;
      for (const pattern of script.matches ?? []) patterns.add(pattern);
    }
  } catch {
    // The manifest's own sites still get the prompt.
  }
  return [...patterns];
}

async function isLive(tabId: number): Promise<boolean> {
  try {
    const response = (await chrome.tabs.sendMessage(
      tabId,
      { type: 'gv.content.ping' },
      { frameId: 0 },
    )) as { ok?: boolean } | undefined;
    return response?.ok === true;
  } catch {
    return false;
  }
}

async function promptText(): Promise<RefreshPromptText> {
  const [title, body, reload, later, language] = await Promise.all([
    getTranslation('update_refresh_title'),
    getTranslation('update_refresh_body'),
    getTranslation('update_refresh_reload'),
    getTranslation('update_refresh_later'),
    getCurrentLanguage(),
  ]);
  return { title, body, reload, later, rtl: language === 'ar' };
}

export function registerUpdateRefreshPrompt(): void {
  chrome.runtime?.onInstalled?.addListener?.((details) => {
    if (details.reason !== 'update' || !chrome.scripting?.executeScript) return;
    void promptStaleTabsToRefresh({
      voyagerMatches,
      queryTabs: (urls) => chrome.tabs.query({ url: urls }),
      isLive,
      showCard: async (tabId, text) => {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: showRefreshPromptCard,
          args: [text],
        });
      },
      text: promptText,
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
  });
}
