/** Reviewed multi-site loaders; their output is checked against each site-owned publication. */
const SHARED_LOADERS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'src/core/selectors/contracts/export.ts': {
    chatgpt: 'chatgpt',
    claude: 'claude',
    deepseek: 'deepseek',
    kimi: 'kimi',
  },
  'src/core/selectors/contracts/inputSurfaces.ts': {
    aistudio: 'aistudio',
    chatgpt: 'chatgpt',
    claude: 'claude',
    deepseek: 'deepseek',
    kimi: 'kimi',
  },
  'src/core/selectors/contracts/placement.ts': {
    aistudio: 'aistudio',
    chatgpt: 'chatgpt',
    claude: 'claude',
    deepseek: 'deepseek',
    gemini: 'gemini',
    kimi: 'kimi',
  },
  'src/core/selectors/contracts/timeline.ts': {
    aistudio: 'aistudio',
    chatgpt: 'chatgpt',
    claude: 'claude',
    deepseek: 'deepseek',
    gemini: 'gemini',
    kimi: 'kimi',
  },
  'src/core/services/composer/sendKeys/sendSitePolicies.ts': {
    aistudioPackaged: 'aistudio',
    packaged: 'gemini',
  },
  'src/core/services/composer/siteInputData.ts': {
    aistudio: 'aistudio',
    chatgpt: 'chatgpt',
    claude: 'claude',
    deepseek: 'deepseek',
    geminiInput: 'gemini',
    geminiVim: 'gemini',
    kimi: 'kimi',
  },
  'src/features/timeline/siteTextData.ts': {
    aistudio: 'aistudio',
    chatgpt: 'chatgpt',
    claude: 'claude',
    deepseek: 'deepseek',
    gemini: 'gemini',
    kimi: 'kimi',
  },
  'src/pages/content/export/toolbarTargets.ts': {
    aistudio: 'aistudio',
    chatgpt: 'chatgpt',
    claude: 'claude',
    deepseek: 'deepseek',
    gemini: 'gemini',
    kimi: 'kimi',
  },
};

/** Site-specific modules outside a site-named directory. New modules need explicit ownership. */
const SITE_MODULES: Readonly<Record<string, string>> = {
  'src/core/gemini/code/hosts.ts': 'gemini',
  'src/core/gemini/composer/draft.ts': 'gemini',
  'src/core/gemini/composer/send.ts': 'gemini',
  'src/core/gemini/content/conversation.ts': 'gemini',
  'src/core/gemini/content/packaged.ts': 'gemini',
  'src/core/gemini/math/formula.ts': 'gemini',
  'src/core/gemini/selectors/bundle.ts': 'gemini',
  'src/core/gemini/sidebar/actions.ts': 'gemini',
  'src/core/gemini/sidebar/packaged.ts': 'gemini',
  'src/core/selectors/contracts/aistudioSurfaces.ts': 'aistudio',
  'src/core/selectors/contracts/chatgptActions.ts': 'chatgpt',
  'src/core/selectors/contracts/chatgptExport.ts': 'chatgpt',
  'src/features/plugins/builtin/chatgptPageData.ts': 'chatgpt',
  'src/features/plugins/builtin/index.ts': 'chatgpt',
  'src/pages/content/canvasExport/canvasTargets.ts': 'gemini',
  'src/pages/content/canvasExport/documentTargets.ts': 'gemini',
  'src/pages/content/canvasExport/menuInjection.ts': 'gemini',
  'src/pages/content/canvasExport/menuTargets.ts': 'gemini',
  'src/pages/content/chatInput/vimGeminiComposer.ts': 'gemini',
  'src/pages/content/deepResearch/dom.ts': 'gemini',
  'src/pages/content/deepResearch/extractor.ts': 'gemini',
  'src/pages/content/deepResearch/menuButton.ts': 'gemini',
  'src/pages/content/deepResearch/pluginHandler.ts': 'gemini',
  'src/pages/content/deepResearch/reportExtractor.ts': 'gemini',
  'src/pages/content/draftSave/geminiDraftPolicy.ts': 'gemini',
  'src/pages/content/export/adapter/chatgptExportData.ts': 'chatgpt',
  'src/pages/content/export/adapter/platform/geminiImageRead.ts': 'gemini',
  'src/pages/content/export/adapter/platform/geminiImages.ts': 'gemini',
  'src/pages/content/export/canvasDocExtractor.ts': 'gemini',
  'src/pages/content/export/conversationMenuInjection.ts': 'gemini',
  'src/pages/content/export/exportLogoAnchor.ts': 'gemini',
  'src/pages/content/export/generatedUiScreenshots.ts': 'gemini',
  'src/pages/content/export/logoExportButton.ts': 'gemini',
  'src/pages/content/export/menuIdentity.ts': 'gemini',
  'src/pages/content/export/menuLifetime.ts': 'gemini',
  'src/pages/content/export/menuTargets.ts': 'gemini',
  'src/pages/content/folder/NativeConversationMenus.ts': 'gemini',
  'src/pages/content/folder/aistudioLocatorReads.ts': 'aistudio',
  'src/pages/content/folder/gemini/activitySelectors.ts': 'gemini',
  'src/pages/content/folderProject/index.ts': 'gemini',
  'src/pages/content/fork/forkComposer.ts': 'gemini',
  'src/pages/content/gemsSidebar/selectorQueries.ts': 'gemini',
  'src/pages/content/inputCollapse/dom.ts': 'gemini',
  'src/pages/content/inputCollapse/targets.ts': 'gemini',
  'src/pages/content/prompt/sentChipTargets.ts': 'gemini',
  'src/pages/content/researchPack/actionTargets.ts': 'gemini',
  'src/pages/content/researchPack/turnButtons.ts': 'gemini',
  'src/pages/content/researchPack/turnCapture.ts': 'gemini',
  'src/pages/content/responseNotification/pageSnapshot.ts': 'gemini',
  'src/pages/content/sidebarAutoHide/controller.ts': 'gemini',
  'src/pages/content/sidebarWidth/buttonTargets.ts': 'gemini',
  'src/pages/content/usageStatus/usageDom.ts': 'gemini',
  'src/pages/content/watermarkRemover/downloadButton.ts': 'gemini',
  'src/pages/content/watermarkRemover/generatedImageOwner.ts': 'gemini',
  'src/pages/content/watermarkRemover/generatedImageTargets.ts': 'gemini',
};

export function selectorImportOwner(file: string, site: string, binding?: string): boolean {
  if (Object.hasOwn(SHARED_LOADERS, file))
    return binding !== undefined && SHARED_LOADERS[file][binding] === site;
  if (
    file.startsWith(`src/core/${site}/`) ||
    file.startsWith(`src/features/plugins/catalog/sites/${site}/`) ||
    file.startsWith(`src/features/plugins/sites/adapters/${site}/`)
  )
    return true;
  return SITE_MODULES[file] === site;
}
