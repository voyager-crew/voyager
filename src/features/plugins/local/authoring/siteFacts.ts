/**
 * What an author needs to know about one target site, read from its adapter:
 * the URL patterns `matches` may use, the semantic anchors it declares, and
 * what a local plugin may and may not bring there. Anchors are listed by
 * meaning only: the selectors behind them change with every site fix, and a
 * plugin names the anchor, not its selector.
 */
import { handlerResources } from '../../runtime/resourceClaims';
import { FEATURE_OWNERS, type OwnedFeatureId } from '../../sites/featureOwners';
import {
  allowedPrimitivesForSite,
  allowsPluginThemeForSite,
  packagedSitesForPatterns,
} from '../../sites/hostPolicy';
import { FOLDERS_HANDLER } from '../../sites/packagedFoldersPolicy';
import {
  SEMANTIC_KEY_DESCRIPTIONS,
  SEMANTIC_SELECTOR_KEYS,
  type SemanticSelectorKey,
} from '../../sites/semanticKeys';
import type { SiteAdapter } from '../../types';

/**
 * Caveats no adapter field carries, keyed by site id; a site without notes
 * needs none. `primitives` notes matter only to a plugin that calls one, so a
 * short page can leave them to the site file.
 */
const SITE_NOTES: Readonly<
  Record<string, { readonly page: readonly string[]; readonly primitives: readonly string[] }>
> = {
  gemini: {
    page: [
      'The `sidebar` anchor also matches Voyager’s own folder panel (`.gv-folder-container`). To change only Gemini’s navigation rail, target `bard-sidenav` with a CSS selector.',
    ],
    primitives: [
      '`draftSave` keys drafts as `gvDraft_` plus the full pathname, including `/u/<index>/` and Gem routes. Different account slots have different keys; changing email within the same slot still shares stored drafts.',
      'On consumer gemini.google.com, `turnNavigator` requires literal `params: { "dataBackend": "shared" }` and the engine version shown in its primitive reference. All matches must stay on that host: no Business or mixed catalog sites. It shares Voyager’s existing stars, levels, collapse state and native account/turn identity; do not set turn, turnItem, conversationIdPattern, conversationIdAttribute or accountIdAttributes. Enterprise and custom-website coverage still refuse this rail at the native start point.',
    ],
  },
  aistudio: {
    page: [
      'The `sidebar` anchor is Voyager’s own folder panel on AI Studio, not AI Studio’s navigation. Use a CSS selector for AI Studio’s own panels.',
      'Voyager’s AI Studio switch governs plugins too: while Voyager is off on AI Studio, nothing mounts.',
    ],
    primitives: [
      'On AI Studio, `sendShortcut` requires `params: { "mode": "enterSends" }`: Enter sends, Ctrl/Cmd+Enter inserts a newline, and Shift/Alt+Enter keep the host behavior.',
    ],
  },
};

/** The popup setting behind each feature a packaged official plugin runs. */
const OWNED_FEATURE_SETTINGS: Readonly<Record<OwnedFeatureId, string>> = {
  ctrlEnterSend: 'Ctrl/Cmd+Enter send',
  safariEnterFix: 'Safari Enter fix',
  enterSend: 'AI Studio Enter send',
  draftSave: 'Draft auto-save',
  formulaCopy: 'Formula copy',
  vimInput: 'Input Vim mode',
  hideInputHalo: 'Hide input box halo',
  chatFontSize: 'Chat font size',
  chatLineHeight: 'Chat spacing',
  chatWidth: 'Chat width',
  editInputWidth: 'Edit input width',
  sidebarWidth: 'Sidebar width',
  aistudioSidebarWidth: 'AI Studio sidebar width',
  batchDelete: 'Batch delete',
  sidebarAutoHide: 'Auto-hide sidebar',
  sidebarFullHide: 'Fully hide sidebar',
  markdownFix: 'Markdown rendering fix',
  messageTimestamps: 'Message timestamps',
  watermarkDownload: 'Remove watermark on download',
  watermarkPreview: 'Remove watermark in preview',
  canvasCopy: 'Canvas copy as Markdown',
  deepResearchExport: 'Deep Research export',
  conversationExport: 'Conversation export',
  gemsSidebar: 'Recent Gems in sidebar',
  contextSync: 'Context Sync',
  userLatex: 'Render LaTeX in my messages',
  codeCollapse: 'Collapse long code blocks',
  waveDrom: 'WaveDrom timing diagram rendering',
  echarts: 'ECharts rendering',
  mermaid: 'Mermaid diagram rendering',
  promptHistory: 'Prompt history',
  inputCollapse: 'Input collapse',
  researchPack: 'Research Pack',
  defaultModel: 'Auto-apply default model on new chats',
  fork: 'Conversation fork',
  usageStatus: 'Usage status',
  quoteReply: 'Quote Reply',
  highlight: 'Highlight',
  preventAutoScroll: 'Prevent auto-scroll to bottom',
  responseNotification: 'Response completion notifications',
  timeline: 'Show Timeline',
  folders: 'Folders',
  siteCheck: 'Site check',
};

type SharedRuntimePolicy = 'onePerPage' | 'perElement' | 'sharedDrafts';

const SHARED_RUNTIME_POLICY_TEXT: Readonly<Record<SharedRuntimePolicy, string>> = {
  onePerPage:
    'only the setting or the plugin runs on a page. When the page loads, or while neither is running, the setting goes first: with it on, the plugin stays paused. Whichever is already running keeps running, and turning on the other leaves that one paused (the popup says why). Turn one off to hand the feature to the other.',
  perElement:
    'both can run on one page: each claims the elements it works on, and an element the other already holds is left to it.',
  sharedDrafts:
    'the official and a local draft plugin may run together and share the same `gvDraft_` full-path data. Their writes and pruning are coordinated on this page. Turning either off keeps stored drafts.',
};

const SHARED_RUNTIME_ORDER: readonly SharedRuntimePolicy[] = [
  'onePerPage',
  'perElement',
  'sharedDrafts',
];

/**
 * On a site where only some primitives are open, the ones that also run one
 * of Voyager's own settings, grouped by how the two share a page. A primitive
 * with an exclusive runtime (`runtime/resourceClaims.ts`) runs once per page:
 * the setting goes first on a fresh page or a free runtime, and a running one
 * keeps it (`runtime/resourceArbiter.ts`). Gemini drafts instead share
 * page-coordinated data; element primitives claim each element, so the
 * setting and a plugin run side by side.
 */
function sharedRuntimeLines(site: SiteAdapter, open: ReadonlySet<string>): string[] {
  const packaged = new Set<string>(packagedSitesForPatterns(site.matches));
  const settings = new Map<string, string>();
  for (const owned of FEATURE_OWNERS) {
    if (!packaged.has(owned.site)) continue;
    for (const handler of owned.handlers) {
      if (open.has(handler)) settings.set(handler, OWNED_FEATURE_SETTINGS[owned.feature]);
    }
  }
  if (settings.size === 0) return [];
  const policyOf = (handler: string): SharedRuntimePolicy =>
    handler === 'draftSave' && site.id === 'gemini'
      ? 'sharedDrafts'
      : handlerResources(handler).length > 0
        ? 'onePerPage'
        : 'perElement';
  const groups = SHARED_RUNTIME_ORDER.map((policy) => ({
    policy,
    entries: [...settings].filter(([handler]) => policyOf(handler) === policy),
  })).filter((group) => group.entries.length > 0);
  return [
    '',
    'These primitives run the same code as one of Voyager’s own settings (named in parentheses):',
    ...groups.map(
      ({ policy, entries }) =>
        `- ${entries.map(([handler, setting]) => `\`${handler}\` (${setting})`).join(', ')}: ${SHARED_RUNTIME_POLICY_TEXT[policy]}`,
    ),
  ];
}

/** Semantic keys the site declares, in vocabulary order. */
export function siteAnchors(site: SiteAdapter): readonly SemanticSelectorKey[] {
  return SEMANTIC_SELECTOR_KEYS.filter((key) => typeof site.selectors[key] === 'string');
}

/** Gemini and AI Studio keep Voyager’s own accent: a plugin brings no `theme` there. */
export function forbidsTheme(site: SiteAdapter): boolean {
  return !allowsPluginThemeForSite(site);
}

/**
 * The primitives a local plugin may call on `site`. A packaged site's folders
 * are its official plugin's alone (`packagedFoldersPolicy.ts`), though the
 * host policy opens `folders` there to that plugin.
 */
function localPrimitives(site: SiteAdapter): ReadonlySet<string> | 'all' {
  const allowed = allowedPrimitivesForSite(site);
  if (allowed === 'all') return allowed;
  return new Set([...allowed].filter((handler) => handler !== FOLDERS_HANDLER));
}

/** Whether a plugin on `site` may call any primitive at all (a `native` op). */
export function allowsAnyPrimitive(site: SiteAdapter): boolean {
  const allowed = localPrimitives(site);
  return allowed === 'all' || allowed.size > 0;
}

/** Whether a plugin on `site` may call the `handler` primitive. */
export function allowsPrimitive(site: SiteAdapter, handler: string): boolean {
  const allowed = localPrimitives(site);
  return allowed === 'all' || allowed.has(handler);
}

/** Whether a plugin on `site` may call only some primitives (or none). */
export function restrictsPrimitives(site: SiteAdapter): boolean {
  return allowedPrimitivesForSite(site) !== 'all';
}

/** A site with no restriction from the packaged host policy: any primitive, and a theme. */
export function isUnrestrictedSite(site: SiteAdapter): boolean {
  return !forbidsTheme(site) && allowedPrimitivesForSite(site) === 'all';
}

/** One bullet per declared anchor: what it names. */
export function anchorLines(site: SiteAdapter): string[] {
  const anchors = siteAnchors(site);
  if (anchors.length === 0) return ['- (none: use a CSS selector string as the target)'];
  return anchors.map((key) => `- ${key}: ${SEMANTIC_KEY_DESCRIPTIONS[key]}`);
}

/**
 * What only a plugin that calls a primitive on `site` needs: how each shares
 * the page with Voyager's own setting, and the site's caveats for them.
 */
export function primitiveDetailLines(site: SiteAdapter): string[] {
  const allowed = localPrimitives(site);
  const notes = SITE_NOTES[site.id]?.primitives ?? [];
  return [
    ...(allowed === 'all' ? [] : sharedRuntimeLines(site, allowed)),
    ...(notes.length > 0 ? ['', ...notes.map((note) => `- ${note}`)] : []),
  ];
}

interface SiteFactOptions {
  readonly primitives: boolean;
  readonly theme: boolean;
  /**
   * `false` leaves out the allowed-primitive list and `primitiveDetailLines`,
   * for a document that lists the primitives itself and points at the site
   * file for the rest.
   */
  readonly primitiveDetails?: boolean;
}

/** What the site allows beyond CSS and the four page changes: primitives and a theme. */
function allowanceLines(site: SiteAdapter, options: SiteFactOptions): string[] {
  if (forbidsTheme(site) && !allowsAnyPrimitive(site)) {
    return [
      '',
      `No "theme" and no "native" op on ${site.label}: CSS and the four page changes only.`,
    ];
  }
  if (!options.primitives) return [];
  const allowed = localPrimitives(site);
  const noTheme = forbidsTheme(site) ? ' No "theme".' : '';
  if (allowed !== 'all') {
    if (options.primitiveDetails === false) {
      return forbidsTheme(site) ? ['', `No "theme" on ${site.label}.`] : [];
    }
    return [
      '',
      `${site.label} allows only these primitives (native ops): ${[...allowed].sort().join(', ')}.${noTheme}`,
    ];
  }
  return [
    '',
    options.theme
      ? `Primitives (native ops) and an optional "theme" accent are allowed on ${site.label}.`
      : `Primitives (native ops) are allowed on ${site.label}.`,
  ];
}

/** The facts section body for one site. */
export function siteFactLines(site: SiteAdapter, options: SiteFactOptions): string[] {
  const missing = SEMANTIC_SELECTOR_KEYS.filter((key) => typeof site.selectors[key] !== 'string');
  const notes = SITE_NOTES[site.id]?.page ?? [];
  return [
    '"matches" must use these URL patterns (all of them, or a subset):',
    ...site.matches.map((pattern) => `- ${pattern}`),
    '',
    `Semantic anchors ${site.label} declares (use them as { "kind": "semantic", "key": … }):`,
    ...anchorLines(site),
    ...(missing.length > 0
      ? [
          '',
          `${site.label} does not declare ${missing.join(', ')}: a plugin that relies on one of these is refused. Use a CSS selector instead.`,
        ]
      : []),
    ...allowanceLines(site, options),
    ...(notes.length > 0 ? ['', ...notes.map((note) => `- ${note}`)] : []),
    ...(options.primitives && options.primitiveDetails !== false ? primitiveDetailLines(site) : []),
  ];
}
