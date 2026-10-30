/**
 * The wiring tables between builtin plugin manifests (BUILTIN_PLUGINS)
 * and their first-party native handlers. Kept as data so a test can compare
 * their keys against NATIVE_BUILTIN_PLUGIN_IDS — adding a manifest without a
 * handler (or vice versa) fails the suite instead of shipping a dead toggle.
 */
import { NATIVE_BUILTIN_PLUGIN_IDS } from '@/features/plugins/builtin';
import { activateChatGptLocalBridge } from '@/features/plugins/builtin/chatgptLocalBridge';
import { activateChatGptProUsage } from '@/features/plugins/builtin/chatgptProUsage';
import { isChatGptProUsageSupported } from '@/features/plugins/builtin/chatgptProUsage/manifest';
import { activateChatGptResponseNotification } from '@/features/plugins/builtin/chatgptResponseNotification';
import { activateChatGptTemporaryHandoff } from '@/features/plugins/builtin/chatgptTemporaryHandoff';
import {
  type NativeHandler,
  registerNativeHandler,
  verifyNativeHandlerBindings,
} from '@/features/plugins/runtime/nativeHandlers';

import {
  activateAIStudioSidebarWidth,
  updateAIStudioSidebarWidthSettings,
} from './aistudioSidebarWidth/pluginHandler';
import {
  activateAIStudioBatchDelete,
  activateGeminiBatchDelete,
} from './batchDelete/pluginHandler';
import { activateGeminiCanvasCopy } from './canvasExport/pluginHandler';
import { activateGeminiChatWidth, updateGeminiChatWidthSettings } from './chatWidth/pluginHandler';
import { activateGeminiContextSync } from './contextSync/pluginHandler';
import { activateGeminiDeepResearchExport } from './deepResearch/pluginHandler';
import { activateGeminiDefaultModel } from './defaultModel/pluginHandler';
import {
  activateGeminiEditInputWidth,
  updateGeminiEditInputWidthSettings,
} from './editInputWidth/pluginHandler';
import { activateGeminiFork } from './fork/pluginHandler';
import {
  activateGeminiGemsSidebar,
  updateGeminiGemsSidebarSettings,
} from './gemsSidebar/pluginHandler';
import { activateGeminiHighlight } from './highlight/pluginHandler';
import {
  activateGeminiInputCollapse,
  updateGeminiInputCollapseSettings,
} from './inputCollapse/pluginHandler';
import { activateGeminiMarkdownFix } from './markdownPatcher/pluginHandler';
import { activateGeminiPreventAutoScroll } from './preventAutoScroll/pluginHandler';
import { activateGeminiPromptHistory } from './promptHistory/pluginHandler';
import { activateGeminiQuoteReply } from './quoteReply/pluginHandler';
import { activateGeminiResearchPack } from './researchPack/pluginHandler';
import { activateGeminiResponseNotification } from './responseNotification/pluginHandler';
import { activateGeminiSafariEnterFix } from './sendBehavior/pluginHandler';
import {
  activateGeminiSidebarAutoHide,
  activateGeminiSidebarFullHide,
} from './sidebarAutoHide/pluginHandler';
import {
  activateGeminiSidebarWidth,
  updateGeminiSidebarWidthSettings,
} from './sidebarWidth/pluginHandler';
import { activateGeminiTimeline } from './timeline/pluginHandler';
import { activateGeminiMessageTimestamps } from './timestamp/pluginHandler';
import { activateGeminiUsageStatus } from './usageStatus/pluginHandler';
import { createVisualEffectsRuntime } from './visualEffects';
import {
  activateGeminiWatermarkDownload,
  activateGeminiWatermarkPreview,
} from './watermarkRemover/pluginHandler';

/** Page-owned runtimes may outlive an activation while their particles drain. */
export const NATIVE_HANDLER_FACTORIES = {
  'voyager.visual-effects': createVisualEffectsRuntime,
} as const;

export const NATIVE_HANDLER_BINDINGS: Readonly<Record<string, NativeHandler>> = {
  'voyager.gemini-batch-delete': { activate: activateGeminiBatchDelete },
  'voyager.aistudio-batch-delete': { activate: activateAIStudioBatchDelete },
  'voyager.gemini-watermark-download': { activate: activateGeminiWatermarkDownload },
  'voyager.gemini-watermark-preview': { activate: activateGeminiWatermarkPreview },
  'voyager.gemini-context-sync': { activate: activateGeminiContextSync },
  'voyager.gemini-gems-sidebar': {
    activate: activateGeminiGemsSidebar,
    updateSettings: updateGeminiGemsSidebarSettings,
  },
  'voyager.gemini-sidebar-width': {
    activate: activateGeminiSidebarWidth,
    updateSettings: updateGeminiSidebarWidthSettings,
  },
  'voyager.aistudio-sidebar-width': {
    activate: activateAIStudioSidebarWidth,
    updateSettings: updateAIStudioSidebarWidthSettings,
  },
  'voyager.gemini-sidebar-auto-hide': { activate: activateGeminiSidebarAutoHide },
  'voyager.gemini-sidebar-full-hide': { activate: activateGeminiSidebarFullHide },
  'voyager.gemini-timeline': { activate: activateGeminiTimeline },
  'voyager.gemini-safari-enter-fix': { activate: activateGeminiSafariEnterFix },
  // formula-copy, input-vim, claude-timeline and conversation export invoke primitives
  // through a `native` op in their manifests (see verbs/); they need no binding here.
  'voyager.chatgpt-temporary-handoff': {
    activate: activateChatGptTemporaryHandoff,
  },
  'voyager.chatgpt-response-notification': {
    activate: activateChatGptResponseNotification,
  },
  'voyager.chatgpt-local-bridge': {
    activate: activateChatGptLocalBridge,
  },
  // Bound only where its manifest is listed, or the binding check reports a stray handler.
  ...(isChatGptProUsageSupported()
    ? { 'voyager.chatgpt-pro-usage': { activate: activateChatGptProUsage } }
    : {}),
  // Owned by `sites/featureOwners.ts`: mounted only once the plugin owns Gemini's chat width.
  'voyager.gemini-chat-width': {
    activate: activateGeminiChatWidth,
    updateSettings: updateGeminiChatWidthSettings,
  },
  'voyager.gemini-markdown-fix': { activate: activateGeminiMarkdownFix },
  'voyager.gemini-message-timestamps': { activate: activateGeminiMessageTimestamps },
  'voyager.gemini-canvas-copy': { activate: activateGeminiCanvasCopy },
  'voyager.gemini-deep-research-export': { activate: activateGeminiDeepResearchExport },
  'voyager.gemini-edit-input-width': {
    activate: activateGeminiEditInputWidth,
    updateSettings: updateGeminiEditInputWidthSettings,
  },
  // Owned by `sites/featureOwners.ts`: mounted only once the plugin owns Gemini's prompt history.
  'voyager.gemini-prompt-history': {
    activate: activateGeminiPromptHistory,
  },
  // Owned by `sites/featureOwners.ts`: mounted only once the plugin owns Gemini's input collapse.
  'voyager.gemini-input-collapse': {
    activate: activateGeminiInputCollapse,
    updateSettings: updateGeminiInputCollapseSettings,
  },
  // Owned by `sites/featureOwners.ts`: mounted only once the plugin owns Gemini's research pack.
  'voyager.gemini-research-pack': {
    activate: activateGeminiResearchPack,
  },
  // Owned by `sites/featureOwners.ts`: mounted only once the plugin owns Gemini's default model.
  'voyager.gemini-default-model': {
    activate: activateGeminiDefaultModel,
  },
  'voyager.gemini-fork': {
    activate: activateGeminiFork,
  },
  'voyager.gemini-usage-status': {
    activate: activateGeminiUsageStatus,
  },
  'voyager.gemini-quote-reply': {
    activate: activateGeminiQuoteReply,
  },
  'voyager.gemini-highlight': {
    activate: activateGeminiHighlight,
  },
  'voyager.gemini-prevent-auto-scroll': {
    activate: activateGeminiPreventAutoScroll,
  },
  'voyager.gemini-response-notification': {
    activate: activateGeminiResponseNotification,
  },
};

/**
 * Register every builtin native handler and verify the two-way manifest ↔
 * handler binding. Must run unconditionally, before `startPluginHost()`.
 */
export function registerBuiltinNativeHandlers(): () => void {
  const pageRuntimes = Object.entries(NATIVE_HANDLER_FACTORIES).map(([id, create]) => {
    const runtime = create();
    registerNativeHandler(id, runtime.handler);
    return runtime;
  });
  for (const [id, handler] of Object.entries(NATIVE_HANDLER_BINDINGS)) {
    registerNativeHandler(id, handler);
  }
  verifyNativeHandlerBindings(NATIVE_BUILTIN_PLUGIN_IDS);
  return () => {
    for (const runtime of pageRuntimes) runtime.destroy();
  };
}
