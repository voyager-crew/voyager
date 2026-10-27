/**
 * Conversation Fork Feature
 *
 * Allows users to fork/branch a conversation at any user message.
 * When forking, the conversation up to that point is exported as markdown
 * and pasted into a new Gemini conversation. Both conversations are linked
 * via fork indicators for easy navigation between branches.
 */
import browser from 'webextension-polyfill';

import { GEMINI_PACKAGED_FORK } from '@/core/gemini/content/packaged';
import { StorageKeys } from '@/core/types/common';

import { historyTimestampStore } from '../timestamp/historyTimestamps';
import { createForkControls } from './forkControls';
import { createForkIndicators } from './forkIndicators';
import { createForkLauncher } from './forkLaunch';
import { startPendingFork } from './pendingFork';
import { makeTurnId, normalizeTurnId } from './turnId';

const OBSERVER_DEBOUNCE_MS = 500;

function extractConversationIdFromUrl(): string | null {
  const appMatch = window.location.pathname.match(/\/app\/([^/?#]+)/);
  if (appMatch?.[1]) return appMatch[1];
  const gemMatch = window.location.pathname.match(/\/gem\/[^/]+\/([^/?#]+)/);
  return gemMatch?.[1] || null;
}

function resolveCurrentConversationTurnId(turnId: string): string | null {
  const conversationId = extractConversationIdFromUrl();
  if (!conversationId) return normalizeTurnId(turnId);
  return historyTimestampStore.resolveCanonicalTurnId(conversationId, turnId);
}

function resolveConversationTurnId(conversationId: string, turnId: string): string | null {
  return historyTimestampStore.resolveCanonicalTurnId(conversationId, turnId);
}

function getNewConversationUrlForCurrentAccount(): string {
  const accountPrefix = window.location.pathname.match(/^\/u\/\d+(?=\/)/)?.[0] || '';
  return `${window.location.origin}${accountPrefix}/app`;
}

function getConversationTitle(): string {
  const conversationId = extractConversationIdFromUrl();
  if (conversationId) {
    const escapedId = conversationId.replace(/"/g, '\\"');
    const link = document.querySelector<HTMLAnchorElement>(
      `[data-test-id="conversation"][jslog*="c_${escapedId}"] a, a[href*="/app/${escapedId}"]`,
    );
    if (link?.textContent?.trim()) return link.textContent.trim();
  }
  return document.title || 'Untitled';
}

function ensureTurnId(el: HTMLElement, index: number): string {
  const stableId = makeTurnId(el, index);
  const current = el.dataset?.turnId || '';
  if (normalizeTurnId(current) !== stableId) {
    el.dataset.turnId = stableId;
  }
  return stableId;
}

function resolveUserMessageHost(userEl: HTMLElement): HTMLElement {
  for (const selector of GEMINI_PACKAGED_FORK['fork.userHost']) {
    const preferred = userEl.querySelector<HTMLElement>(selector);
    if (preferred) return preferred;
  }
  return userEl;
}

export function startFork(): () => void {
  const indicators = createForkIndicators({
    getConversationId: extractConversationIdFromUrl,
    resolveTurnId: resolveCurrentConversationTurnId,
    ensureTurnId,
    resolveUserMessageHost,
  });
  const executeFork = createForkLauncher({
    getConversationId: extractConversationIdFromUrl,
    getConversationTitle,
    getNewConversationUrl: getNewConversationUrlForCurrentAccount,
    ensureTurnId,
    resolveTurnId: resolveConversationTurnId,
  });
  const controls = createForkControls({
    ensureTurnId,
    resolveUserMessageHost,
    getConversationId: extractConversationIdFromUrl,
    onFork: executeFork,
  });

  // Check for pending fork data (new conversation paste)
  const stopPendingFork = startPendingFork({
    getConversationId: extractConversationIdFromUrl,
    getConversationTitle,
    onLinked: indicators.inject,
  });

  // Inject fork buttons and indicators
  const setup = () => {
    controls.inject();
    void indicators.inject();
  };

  // Initial injection with delay to let DOM settle. Cleared on stop: a stopped
  // run's setup would otherwise inject buttons wired to its dead controls.
  const setupTimer = setTimeout(setup, 1000);

  // MutationObserver for dynamically loaded messages. Owned by this run: a run that
  // stops late must not disconnect the observer of the run that replaced it.
  let observerDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver(() => {
    if (observerDebounceTimer) clearTimeout(observerDebounceTimer);
    observerDebounceTimer = setTimeout(() => {
      controls.inject();
      void indicators.inject();
    }, OBSERVER_DEBOUNCE_MS);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Language change listener
  const onStorageChanged = (
    changes: Record<string, browser.Storage.StorageChange>,
    areaName: string,
  ) => {
    if ((areaName === 'sync' || areaName === 'local') && changes[StorageKeys.LANGUAGE]) {
      controls.updateLanguage();
      indicators.updateLanguage();
    }
    if (areaName === 'local' && changes[StorageKeys.FORK_NODES]) {
      indicators.refresh();
    }
  };
  browser.storage.onChanged.addListener(onStorageChanged);

  // Cleanup function
  return () => {
    clearTimeout(setupTimer);
    observer.disconnect();
    if (observerDebounceTimer) {
      clearTimeout(observerDebounceTimer);
      observerDebounceTimer = null;
    }
    stopPendingFork();
    controls.stop();
    browser.storage.onChanged.removeListener(onStorageChanged);

    indicators.stop();
  };
}
