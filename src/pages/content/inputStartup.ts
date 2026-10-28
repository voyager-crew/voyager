/**
 * Gemini / AI Studio input start points. The page send-key coordinator exists
 * before plugins register; official input plugins are admitted at their
 * original positions in the content-script initialization chain.
 *
 * "Collapse with content" remains page state, including while the collapse
 * plugin is off, because the public `collapseInput()` reads it independently
 * of a mounted session. A live change beats the initial read, and a retired
 * page never applies a late read or admits another input plugin.
 */
import { startSendKeyCoordinator } from '@/core/services/composer/sendKeys/sendKeyCoordinator';
import type { SendSiteId } from '@/core/services/composer/sendKeys/sendSitePolicies';
import { CleanupPositions } from '@/core/types/cleanupPositions';
import { StorageKeys } from '@/core/types/common';
import type { CleanupManager } from '@/core/utils/cleanupManager';
import type { OfficialAdmissionController } from '@/features/plugins/runtime/officialAdmission';
import { nativeStartPointSiteForHost } from '@/features/plugins/sites/hostPolicy';

import { setCollapseWhenNotEmpty } from './inputCollapse/runtime';

type StorageChanges = Record<string, chrome.storage.StorageChange>;

/** Enterprise on its own host and catalog sites create no page send coordinator. */
export function sendKeySiteForHost(hostname: string): SendSiteId | null {
  return nativeStartPointSiteForHost(hostname);
}

/** Create before PluginHost and stop after every registrant has released its mode. */
export function startPageSendKeys(hostname: string, cleanupManager: CleanupManager): void {
  const site = sendKeySiteForHost(hostname);
  if (!site) return;
  cleanupManager.registerCleanupFunction(
    startSendKeyCoordinator(site).stop,
    CleanupPositions.CleanupSendKeyCoordinator,
  );
}

/** A missing, failed or invalidated read keeps the public collapse's historical default: off. */
async function readCollapseWhenNotEmpty(): Promise<boolean> {
  try {
    const sync = (globalThis as { chrome?: typeof chrome }).chrome?.storage?.sync;
    const stored = await sync?.get<Record<string, unknown>>([
      StorageKeys.INPUT_COLLAPSE_WHEN_NOT_EMPTY,
    ]);
    return stored?.[StorageKeys.INPUT_COLLAPSE_WHEN_NOT_EMPTY] === true;
  } catch {
    return false;
  }
}

export interface GeminiInputStartup {
  /** Admit collapse at its original start point and hydrate its independent page sub-setting. */
  startInputCollapse(): Promise<void>;
  /** Admit history in the parallel initialization slice. */
  startPromptHistory(): Promise<void>;
  /** Admit drafts in the same parallel slice. */
  startDraftSave(): Promise<void>;
  /** Only the independent collapse-with-content page setting belongs to this router. */
  handleStorageChange(changes: StorageChanges, areaName: string): void;
}

export function createGeminiInputStartup(
  admission: OfficialAdmissionController,
  cleanupManager: CleanupManager,
): GeminiInputStartup {
  let collapseStarted = false;
  let stopped = false;
  let whenNotEmptyChangedLive = false;
  cleanupManager.registerCleanupFunction(() => {
    stopped = true;
  }, CleanupPositions.CleanupInputStartup);

  return {
    async startInputCollapse() {
      if (stopped) return;
      collapseStarted = true;
      admission.admit('gemini', 'inputCollapse');
      const whenNotEmpty = await readCollapseWhenNotEmpty();
      // A popup change during hydration belongs to this page; an older read cannot undo it.
      if (!stopped && !whenNotEmptyChangedLive) setCollapseWhenNotEmpty(whenNotEmpty);
    },
    async startDraftSave() {
      if (!stopped) admission.admit('gemini', 'draftSave');
    },
    async startPromptHistory() {
      if (!stopped) admission.admit('gemini', 'promptHistory');
    },
    handleStorageChange(changes, areaName) {
      if (!collapseStarted || stopped || areaName !== 'sync') return;
      if (StorageKeys.INPUT_COLLAPSE_WHEN_NOT_EMPTY in changes) {
        whenNotEmptyChangedLive = true;
        setCollapseWhenNotEmpty(
          changes[StorageKeys.INPUT_COLLAPSE_WHEN_NOT_EMPTY]?.newValue === true,
        );
      }
    },
  };
}

/** Both Gemini send plugins register on the page coordinator at the same start point. */
export async function startGeminiSendKeys(admission: OfficialAdmissionController): Promise<void> {
  admission.admit('gemini', 'ctrlEnterSend');
  admission.admit('gemini', 'safariEnterFix');
}

/** Admission also happens while the master is off; PluginHost owns that live switch. */
export async function startAIStudioSendKeys(admission: OfficialAdmissionController): Promise<void> {
  admission.admit('aistudio', 'enterSend');
}
