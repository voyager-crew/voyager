export enum CleanupPositions {
  RemoveUnhandledRejectionEventListener,
  RemoveErrorEventListener,
  /** Synchronously retire image health and the bridge before any delayed engine continuation. */
  StopWatermarkRemover,
  DestroyFolderManagerInstance,
  DestroyPromptManagerInstance,
  DestroySlashPromptFeatureInstance,
  DestroySentPromptChips,
  /** Before the Quote and Highlight actions it starts: no late startup read may mount once teardown began. */
  CleanupSelectionStartup,
  /** Before the input collapse it starts: no late start may mount once teardown began. */
  CleanupInputStartup,
  /** Save the unsent tail before the draft plugin owners discard it. */
  FlushDraftsBeforeUnload,
  /** Before the features it starts: no late startup read may mount once teardown began. */
  CleanupGeminiBuiltinStartup,
  CleanupEdgeFinalVersionNotice,
  CleanupPluginHost,
  /** Page services the actions and claims above register with; they stop after them. */
  CleanupRenderedQuoteStyling,
  CleanupSelectionToolbarHost,
  CleanupPreventAutoScrollBridge,
  /** A handed-off fork link outlives the feature, but not its page or send-key coordinator. */
  CleanupForkLinkFinisher,
  /** After every send-key registrant: the send plugins dispose first. */
  CleanupSendKeyCoordinator,
  /** The panel window, its satellites and its shortcut lease; the ball's other holder stops on its own. */
  CleanupPanelShell,
  CleanupBrandTheme,
  CleanupRemoteAnnouncements,
  CleanupStorageQuotaWarning,
  CleanupAccountContextBridge,
  CleanupChatGptJump,
  /** Before the renderers it starts: no late start may mount once teardown began. */
  CleanupRendererStartup,
  CleanupDefaultModel,
  CleanupWatermarkNativeNotice,
  CleanupGemsHider,
  /** Abort pending and shown Gemini timeline guides before retiring their rail. */
  CleanupTimelineCoachmarks,
  CleanupNativeHealth,
  CleanupHistoryTimestampPageService,
  CleanupResearchPackReceiver,
  RemoveStorageOnChangedListener,
  CleanupVisualEffects,
  /** After native consumers release their nodes, before removing the page scheme. */
  CleanupPageSelectors,
  /** Last: every surface it styles is gone by now. */
  CleanupSchemeBridge,
}
