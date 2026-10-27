import { namedSelectorSite, selectorImportOwner } from './selectorImportOwners';

/** Existing generic readers of packaged protocols or per-site maps, not open barrel exemptions. */
const SHARED_DATA_READS: readonly {
  readonly files: readonly string[];
  readonly module: string;
  readonly names: readonly string[];
  readonly sites: readonly string[];
  readonly reason: string;
}[] = [
  {
    files: ['src/core/selectors/bundle.ts'],
    module: 'src/core/selectors/contracts/aistudioSurfaces',
    names: ['AISTUDIO_SURFACE_PROFILES'],
    sites: ['aistudio'],
    reason:
      'The site loader selects the AI Studio map; publication/loader parity verifies the result.',
  },
  {
    files: ['src/core/selectors/bundle.ts'],
    module: 'src/core/selectors/contracts/chatgptActions',
    names: ['CHATGPT_ACTION_PROFILES'],
    sites: ['chatgpt'],
    reason:
      'The site loader selects the ChatGPT action map; publication/loader parity verifies the result.',
  },
  {
    files: ['src/core/selectors/bundle.ts'],
    module: 'src/core/selectors/contracts/chatgptExport',
    names: ['CHATGPT_EXPORT_PROFILES'],
    sites: ['chatgpt'],
    reason:
      'The site loader selects the ChatGPT export map; publication/loader parity verifies the result.',
  },
  {
    files: ['src/core/selectors/bundle.ts', 'src/features/export/services/exportContentRoots.ts'],
    module: 'src/core/selectors/contracts/export',
    names: ['EXPORT_PROFILES'],
    sites: ['chatgpt', 'claude', 'deepseek', 'kimi'],
    reason:
      'Shared bundle/export readers select the current site entry and keep generic data separate.',
  },
  {
    files: ['src/core/selectors/bundle.ts'],
    module: 'src/core/selectors/contracts/inputSurfaces',
    names: ['INPUT_SITE_PROFILES'],
    sites: ['aistudio', 'chatgpt', 'claude', 'deepseek', 'kimi'],
    reason:
      'The site loader selects its own input map; publication/loader parity verifies the result.',
  },
  ...['placement', 'timeline'].map((contract) => ({
    files: ['src/core/selectors/bundle.ts', 'src/core/gemini/selectors/bundle.ts'],
    module: `src/core/selectors/contracts/${contract}`,
    names: [contract === 'placement' ? 'PLACEMENT_PROFILES' : 'TIMELINE_TEXT_PROFILES'],
    sites: ['gemini', 'aistudio', 'chatgpt', 'claude', 'deepseek', 'kimi'],
    reason: 'Per-site bundle assembly selects only its own map entry, checked against publication.',
  })),
  {
    files: [
      'src/core/services/composer/sendKeys/sendKeyCoordinator.ts',
      'src/features/plugins/verbs/sendShortcut/index.ts',
      'src/pages/content/fork/linkFinisher.ts',
    ],
    module: 'src/core/services/composer/sendKeys/sendSitePolicies',
    names: ['SEND_SITE_POLICIES', 'SendSiteId'],
    sites: ['gemini', 'aistudio'],
    reason:
      '§6 native send/IME/event policies stay packaged and dispatch by the current send site.',
  },
  {
    files: [
      'src/core/utils/quotedText.ts',
      'src/features/formulaCopy/FormulaInteraction.ts',
      'src/features/formulaCopy/formulaSource.ts',
    ],
    module: 'src/core/gemini/math/formula',
    names: ['GEMINI_FORMULA_PACKAGED', 'GEMINI_FORMULA_CONTAINER_SELECTOR'],
    sites: ['gemini'],
    reason:
      '§6 standard MathML/KaTeX source attributes and serialization are packaged grammar shared by math consumers.',
  },
];

/** Native modules without a site in their name still have one reviewed page owner. */
const NATIVE_SITE_READERS: Readonly<Record<string, string>> = {
  'src/pages/content/codeBlockCollapse/geminiSite.ts': 'gemini',
  'src/pages/content/export/conversationDom.ts': 'gemini',
  'src/pages/content/fork/forkControls.ts': 'gemini',
  'src/pages/content/fork/index.ts': 'gemini',
  'src/pages/content/fork/linkFinisher.ts': 'gemini',
  'src/pages/content/gemsSidebar/catalog.ts': 'gemini',
  'src/pages/content/gemsSidebar/location.ts': 'gemini',
  'src/pages/content/gemsSidebar/section.ts': 'gemini',
  'src/pages/content/highlight/dom.ts': 'gemini',
  'src/pages/content/timeline/TimelineTurns.ts': 'gemini',
  'src/pages/content/usageStatus/usageParsing.ts': 'gemini',
  'src/pages/content/watermarkRemover/imageHealth.ts': 'gemini',
  'src/pages/content/watermarkRemover/previewRuntime.ts': 'gemini',
};

export function selectorReexportOwner(
  file: string,
  site: string,
  module: string,
  names: readonly string[],
  binding?: string,
): boolean {
  if (
    selectorImportOwner(file, site, binding) ||
    namedSelectorSite(file) === site ||
    NATIVE_SITE_READERS[file] === site
  )
    return true;
  return SHARED_DATA_READS.some(
    (entry) =>
      entry.files.includes(file) &&
      entry.module === module &&
      entry.sites.includes(site) &&
      names.every((name) => entry.names.includes(name)),
  );
}
