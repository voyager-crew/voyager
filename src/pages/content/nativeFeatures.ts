import { CleanupPositions } from '@/core/types/cleanupPositions';

import { startAccountContextBridge } from './accountContext';
import { startChatGptJump } from './chatGptJump';
import { startDefaultModelStarCleanupPageService } from './defaultModel/starCleanupPageService';
import { startEdgeFinalVersionNotice } from './edgeFinalVersionNotice';
import type { NativeFeature } from './featureLifecycle';
import { startForkLinkFinisher } from './fork/linkFinisher';
import { startNativeHealth } from './nativeHealth/index';
import { startPanelShell } from './panelShell/index';
import { startBrandTheme } from './platformTheme';
import { startPreventAutoScrollBridge } from './preventAutoScroll/index';
import { startRenderedQuoteStyling } from './quoteReply/renderedQuotes';
import { startRemoteAnnouncements } from './remoteAnnouncements/index';
import { startResearchPackReceiver } from './researchPack/receiver';
import { startSelectionToolbarHost } from './selectionToolbar/host';
import { startStorageQuotaWarningToast } from './storageQuotaWarning';
import { startHistoryTimestampPageService } from './timestamp/historyTimestampPageService';
import { startWatermarkImageHealth } from './watermarkRemover';

/** Permanent page services and unmigrated native features; optional migrated features belong to PluginHost. */
export const NATIVE_FEATURES = {
  accountContextBridge: {
    id: 'account-context-bridge',
    position: CleanupPositions.CleanupAccountContextBridge,
    start: startAccountContextBridge,
  },
  chatGptJump: {
    id: 'chatgpt-jump',
    position: CleanupPositions.CleanupChatGptJump,
    start: startChatGptJump,
    inertReason:
      'Only top-level ChatGPT pages answer account checks and show inaccessible-star hints.',
  },
  brandTheme: {
    id: 'brand-theme',
    position: CleanupPositions.CleanupBrandTheme,
    start: () => startBrandTheme(),
    inertReason:
      'Brand accent is inert where no adapter declares one; the light/dark bridge always runs.',
  },
  edgeFinalVersionNotice: {
    id: 'edge-final-version-notice',
    position: CleanupPositions.CleanupEdgeFinalVersionNotice,
    start: () => startEdgeFinalVersionNotice(),
    inertReason: 'Only the Edge release channel schedules the notice.',
  },
  remoteAnnouncements: {
    id: 'remote-announcements',
    position: CleanupPositions.CleanupRemoteAnnouncements,
    start: startRemoteAnnouncements,
  },
  storageQuotaWarning: {
    id: 'storage-quota-warning',
    position: CleanupPositions.CleanupStorageQuotaWarning,
    start: startStorageQuotaWarningToast,
  },
  /** Page-resident: the MAIN script cannot be uninstalled, so the optional plugin claim only flips its flag. */
  preventAutoScrollBridge: {
    id: 'prevent-auto-scroll-bridge',
    position: CleanupPositions.CleanupPreventAutoScrollBridge,
    start: startPreventAutoScrollBridge,
  },
  /** The one selection toolbar Quote and Highlight register with; it stops after them. */
  selectionToolbarHost: {
    id: 'selection-toolbar-host',
    position: CleanupPositions.CleanupSelectionToolbarHost,
    start: startSelectionToolbarHost,
  },
  /** Styles quotes already sent, whether or not Quote or Highlight runs. */
  renderedQuoteStyling: {
    id: 'rendered-quote-styling',
    position: CleanupPositions.CleanupRenderedQuoteStyling,
    start: startRenderedQuoteStyling,
  },
  /** Removes stale menu UI while default-model selection is off; never selects a model. */
  defaultModelStarCleanup: {
    id: 'default-model-star-cleanup',
    position: CleanupPositions.CleanupDefaultModel,
    start: startDefaultModelStarCleanupPageService,
  },
  /** Read-only image health and the permanent MAIN bridge outlive either removal switch. */
  watermarkImageHealth: {
    id: 'watermark-image-health',
    position: CleanupPositions.StopWatermarkRemover,
    start: startWatermarkImageHealth,
  },
  nativeHealth: {
    id: 'native-health',
    position: CleanupPositions.CleanupNativeHealth,
    start: startNativeHealth,
  },
  /** The only page owner of the history timestamp store; timeline, folders and highlights read it. */
  historyTimestampPageService: {
    id: 'history-timestamp-page-service',
    position: CleanupPositions.CleanupHistoryTimestampPageService,
    start: startHistoryTimestampPageService,
  },
  /** Finishes an accepted first-send handoff even after the fork switch turns off. */
  forkLinkFinisher: {
    id: 'fork-link-finisher',
    position: CleanupPositions.CleanupForkLinkFinisher,
    start: startForkLinkFinisher,
    inertReason: 'First-send observers exist only while a pasted or uploaded fork is pending.',
  },
  researchPackReceiver: {
    id: 'research-pack-receiver',
    position: CleanupPositions.CleanupResearchPackReceiver,
    start: () => startResearchPackReceiver(),
    inertReason: 'Receives a research pack only on ChatGPT and Claude, never on Gemini.',
  },
  /** The Voyager panel's host side: it must exist with every plugin off, so it is no plugin. */
  panelShell: {
    id: 'panel-shell',
    position: CleanupPositions.CleanupPanelShell,
    start: startPanelShell,
  },
} as const satisfies Record<string, NativeFeature>;

export const NATIVE_FEATURE_LIST: readonly NativeFeature[] = Object.values(NATIVE_FEATURES);
