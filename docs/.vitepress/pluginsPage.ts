/**
 * The guide's plugin page: one table of what Voyager adds to each site, a row
 * per feature and a tick per site. Built from the plugins the extension ships
 * (the builtins and every packaged catalog plugin), so a new plugin shows up
 * here without anyone editing the page.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLATFORM_LOGOS } from '../../src/core/icons/platformLogos';
import { BUILTIN_PLUGINS } from '../../src/features/plugins/builtin/index';
import { OFFICIAL_PLUGIN_IDS } from '../../src/features/plugins/sites/featureOwners';
import { DEFAULT_ENABLED_PLUGIN_IDS } from '../../src/features/plugins/storage/pluginDefaults';
import type { PluginManifest } from '../../src/features/plugins/types';
import { platformMarkSvg } from './changelog';

const DOCS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CATALOG_DIR = resolve(DOCS_ROOT, '../src/features/plugins/catalog');

/** Column order. */
export const PLUGIN_SITES = [
  'gemini',
  'aistudio',
  'chatgpt',
  'claude',
  'deepseek',
  'kimi',
] as const;
export type PluginSite = (typeof PLUGIN_SITES)[number];

/**
 * Which site's plugin names a row. Cross-site plugins carry generic names, while
 * Gemini's packaged plugins keep the names of the settings they replaced.
 */
const NAMING_SITES: readonly PluginSite[] = [
  'chatgpt',
  'claude',
  'deepseek',
  'kimi',
  'gemini',
  'aistudio',
];

const SITE_HOSTS: Readonly<Record<PluginSite, readonly string[]>> = {
  gemini: ['gemini.google.com'],
  aistudio: ['aistudio.google.com', 'aistudio.google.cn'],
  chatgpt: ['chatgpt.com', 'chat.openai.com'],
  claude: ['claude.ai'],
  deepseek: ['chat.deepseek.com'],
  kimi: ['www.kimi.com'],
};

/** Rows in reading order: the features people come for first. Unlisted ones follow. */
const FEATURE_ORDER = [
  'folders',
  'batch-delete',
  'gems-sidebar',
  'timeline',
  'message-timestamps',
  'export',
  'deep-research-export',
  'canvas-copy',
  'watermark-download',
  'watermark-preview',
  'response-notification',
  'quote-reply',
  'highlight',
  'formula-copy',
  'ctrl-enter-send',
  'enter-send',
  'draft-save',
  'prompt-history',
  'composer-counter',
  'reading-width',
  'edit-input-width',
  'sidebar-width',
  'sidebar-auto-hide',
  'sidebar-full-hide',
  'reading-typography',
  'input-vim',
  'input-collapse',
  'collapse-long-messages',
  'user-latex',
  'mermaid',
  'diagram-rendering',
  'fork',
  'research-pack',
  'context-sync',
  'default-model',
  'usage-status',
  'temporary-handoff',
  'prevent-auto-scroll',
  'table-copy',
  'code-collapse',
  'wrap-code',
  'copy-thinking',
  'hide-input-halo',
  'visual-effects',
  'markdown-fix',
  'cjk-render-fix',
];

/** One feature shipped under different names on different sites. */
const FEATURE_ALIASES: Readonly<Record<string, string>> = {
  'vim-input': 'input-vim',
  // Gemini splits reading typography into two plugins.
  'chat-font-size': 'reading-typography',
  'chat-line-height': 'reading-typography',
  'chat-width': 'reading-width',
  // ChatGPT's diagram rendering is Gemini's ECharts and WaveDrom in one plugin.
  echarts: 'diagram-rendering',
  wavedrom: 'diagram-rendering',
};

/**
 * Rows the table leaves out. Gemini's Safari Enter fix only undoes a Safari-specific
 * double-Enter bug.
 */
const SKIPPED_PLUGIN_IDS: ReadonlySet<string> = new Set([OFFICIAL_PLUGIN_IDS.geminiSafariEnterFix]);

/**
 * Features Voyager still runs natively (no plugin) on a site, ticked only on rows
 * a plugin already gives the table. None today: Gemini's and AI Studio's folders
 * are the `voyager.gemini-folders` and `voyager.aistudio-folders` plugins, on by
 * default through `geminiFolderEnabled`.
 */
const NATIVE_FEATURES: Readonly<Record<string, readonly PluginSite[]>> = {};

/**
 * Packaged Gemini and AI Studio plugins that run on a fresh install. Their switch
 * is the legacy setting they replaced (`storage/legacySettingBindings.ts`), which
 * this build cannot import; the tests check this list against those bindings.
 */
export const FRESH_INSTALL_ON: ReadonlySet<string> = new Set([
  OFFICIAL_PLUGIN_IDS.geminiBatchDelete,
  OFFICIAL_PLUGIN_IDS.aistudioBatchDelete,
  OFFICIAL_PLUGIN_IDS.aistudioFolders,
  OFFICIAL_PLUGIN_IDS.geminiFolders,
  OFFICIAL_PLUGIN_IDS.geminiTimeline,
  OFFICIAL_PLUGIN_IDS.geminiExport,
  OFFICIAL_PLUGIN_IDS.geminiCanvasCopy,
  OFFICIAL_PLUGIN_IDS.geminiMarkdownFix,
  OFFICIAL_PLUGIN_IDS.geminiDeepResearchExport,
  OFFICIAL_PLUGIN_IDS.geminiGemsSidebar,
  OFFICIAL_PLUGIN_IDS.geminiFormulaCopy,
  OFFICIAL_PLUGIN_IDS.aistudioFormulaCopy,
  OFFICIAL_PLUGIN_IDS.aistudioSidebarWidth,
  OFFICIAL_PLUGIN_IDS.geminiUserLatex,
  OFFICIAL_PLUGIN_IDS.geminiCodeCollapse,
  OFFICIAL_PLUGIN_IDS.geminiWaveDrom,
  OFFICIAL_PLUGIN_IDS.geminiECharts,
  OFFICIAL_PLUGIN_IDS.geminiMermaid,
  OFFICIAL_PLUGIN_IDS.geminiDefaultModel,
  ...DEFAULT_ENABLED_PLUGIN_IDS,
]);

/** Guide pages whose slug is not the row's key. */
const GUIDE_PAGES: Readonly<Record<string, string>> = {
  'watermark-download': 'nanobanana',
  'watermark-preview': 'nanobanana',
  'message-timestamps': 'timestamp',
  'deep-research-export': 'deep-research',
  'ctrl-enter-send': 'send-behavior',
  'enter-send': 'send-behavior',
  'reading-typography': 'chat-font-size',
  'edit-input-width': 'settings',
  'visual-effects': 'settings',
  'sidebar-width': 'sidebar',
  'sidebar-full-hide': 'sidebar-auto-hide',
};

interface PluginsLocale {
  /** The manifests' `i18n` key; English is the manifest's own text. */
  manifest: string;
  prefix: string;
  title: string;
  intro: string;
  feature: string;
  defaultOn: string;
  disclaimer: string;
}

export const PLUGINS_LOCALES: readonly PluginsLocale[] = [
  {
    manifest: 'zh',
    prefix: '',
    title: '插件一览',
    intro:
      '在对应网站上打开 Voyager 弹窗即可开启插件；Claude、ChatGPT、DeepSeek 和 Kimi 第一次开启时会请求访问该网站。',
    feature: '功能',
    defaultOn: '默认开启',
    disclaimer:
      'Gemini、AI Studio、ChatGPT、Claude、DeepSeek、Kimi 等名称与标志为其各自所有者的商标。Voyager 与 Google、OpenAI、Anthropic、DeepSeek、Moonshot AI 无关联，亦未获其背书。',
  },
  {
    manifest: 'zh_TW',
    prefix: 'zh_TW',
    title: '外掛一覽',
    intro:
      '在對應網站上打開 Voyager 彈出視窗即可開啟外掛；Claude、ChatGPT、DeepSeek 和 Kimi 第一次開啟時會要求存取該網站。',
    feature: '功能',
    defaultOn: '預設開啟',
    disclaimer:
      'Gemini、AI Studio、ChatGPT、Claude、DeepSeek、Kimi 等名稱與標誌為其各自所有者的商標。Voyager 與 Google、OpenAI、Anthropic、DeepSeek、Moonshot AI 無關聯，亦未獲其背書。',
  },
  {
    manifest: 'en',
    prefix: 'en',
    title: 'All plugins',
    intro:
      'Turn a plugin on from the Voyager popup while you are on the site. Claude, ChatGPT, DeepSeek and Kimi ask for access to the site the first time.',
    feature: 'Feature',
    defaultOn: 'On by default',
    disclaimer:
      'Gemini, AI Studio, ChatGPT, Claude, DeepSeek, Kimi and other names and logos are trademarks of their respective owners. Voyager is not affiliated with, or endorsed by, Google, OpenAI, Anthropic, DeepSeek or Moonshot AI.',
  },
  {
    manifest: 'ja',
    prefix: 'ja',
    title: 'プラグイン一覧',
    intro:
      '使いたいサイトで Voyager のポップアップを開き、プラグインをオンにします。Claude、ChatGPT、DeepSeek、Kimi では初回にサイトへのアクセス許可を求められます。',
    feature: '機能',
    defaultOn: '既定でオン',
    disclaimer:
      'Gemini、AI Studio、ChatGPT、Claude、DeepSeek、Kimi などの名称およびロゴは各所有者の商標です。Voyager は Google・OpenAI・Anthropic・DeepSeek・Moonshot AI とは関係なく、承認も受けていません。',
  },
  {
    manifest: 'ko',
    prefix: 'ko',
    title: '플러그인 목록',
    intro:
      '해당 사이트에서 Voyager 팝업을 열고 플러그인을 켜세요. Claude, ChatGPT, DeepSeek, Kimi에서는 처음 켤 때 사이트 접근 권한을 요청합니다.',
    feature: '기능',
    defaultOn: '기본 켜짐',
    disclaimer:
      'Gemini, AI Studio, ChatGPT, Claude, DeepSeek, Kimi 등의 이름과 로고는 각 소유자의 상표입니다. Voyager는 Google, OpenAI, Anthropic, DeepSeek 또는 Moonshot AI와 제휴하거나 보증받지 않았습니다.',
  },
  {
    manifest: 'fr',
    prefix: 'fr',
    title: 'Tous les plugins',
    intro:
      'Activez un plugin depuis la fenêtre de Voyager, sur le site concerné. Claude, ChatGPT, DeepSeek et Kimi vous demandent l’accès au site la première fois.',
    feature: 'Fonction',
    defaultOn: 'Activé par défaut',
    disclaimer:
      'Gemini, AI Studio, ChatGPT, Claude, DeepSeek, Kimi et les autres noms et logos sont des marques de leurs propriétaires respectifs. Voyager n’est ni affilié à Google, OpenAI, Anthropic, DeepSeek ou Moonshot AI, ni approuvé par eux.',
  },
  {
    manifest: 'es',
    prefix: 'es',
    title: 'Todos los plugins',
    intro:
      'Activa un plugin desde la ventana de Voyager mientras estás en el sitio. Claude, ChatGPT, DeepSeek y Kimi te piden acceso al sitio la primera vez.',
    feature: 'Función',
    defaultOn: 'Activado por defecto',
    disclaimer:
      'Gemini, AI Studio, ChatGPT, Claude, DeepSeek, Kimi y otros nombres y logotipos son marcas de sus respectivos propietarios. Voyager no está afiliado ni respaldado por Google, OpenAI, Anthropic, DeepSeek o Moonshot AI.',
  },
  {
    manifest: 'pt',
    prefix: 'pt',
    title: 'Todos os plugins',
    intro:
      'Ative um plugin na janela do Voyager enquanto está no site. O Claude, o ChatGPT, o DeepSeek e o Kimi pedem acesso ao site na primeira vez.',
    feature: 'Funcionalidade',
    defaultOn: 'Ativado por predefinição',
    disclaimer:
      'Gemini, AI Studio, ChatGPT, Claude, DeepSeek, Kimi e outros nomes e logótipos são marcas dos respetivos proprietários. O Voyager não tem qualquer afiliação ou aprovação da Google, da OpenAI, da Anthropic, da DeepSeek ou da Moonshot AI.',
  },
  {
    manifest: 'ar',
    prefix: 'ar',
    title: 'كل الإضافات',
    intro:
      'فعّل الإضافة من نافذة Voyager وأنت على الموقع. يطلب Claude وChatGPT وDeepSeek وKimi إذن الوصول إلى الموقع في المرة الأولى.',
    feature: 'الميزة',
    defaultOn: 'مفعّلة افتراضيًا',
    disclaimer:
      'أسماء وشعارات Gemini وAI Studio وChatGPT وClaude وDeepSeek وKimi وغيرها علامات تجارية لأصحابها. Voyager غير مرتبط بـ Google أو OpenAI أو Anthropic أو DeepSeek أو Moonshot AI ولا يحظى بموافقتها.',
  },
  {
    manifest: 'ru',
    prefix: 'ru',
    title: 'Все плагины',
    intro:
      'Включите плагин во всплывающем окне Voyager, открыв нужный сайт. Claude, ChatGPT, DeepSeek и Kimi в первый раз попросят доступ к сайту.',
    feature: 'Функция',
    defaultOn: 'Включено по умолчанию',
    disclaimer:
      'Gemini, AI Studio, ChatGPT, Claude, DeepSeek, Kimi и другие названия и логотипы являются товарными знаками их владельцев. Voyager не связан с Google, OpenAI, Anthropic, DeepSeek или Moonshot AI и не одобрен ими.',
  },
];

export interface SitePlugin {
  site: PluginSite;
  /** The same feature on another site shares this key (after `FEATURE_ALIASES`). */
  feature: string;
  manifest: PluginManifest;
}

export interface FeatureRow {
  feature: string;
  /** Every plugin of this feature, by site; Gemini may split one feature in two. */
  plugins: Partial<Record<PluginSite, PluginManifest[]>>;
  /** Sites where Voyager runs this feature natively, without a plugin. */
  native: PluginSite[];
}

function siteOf(manifest: PluginManifest): PluginSite[] {
  // This shared builtin also covers already-authorized custom sites. Its broad
  // runtime match grants no access; these are the six columns shown here.
  if (manifest.id === OFFICIAL_PLUGIN_IDS.visualEffects) return [...PLUGIN_SITES];
  return PLUGIN_SITES.filter((site) =>
    manifest.matches.some((match) => SITE_HOSTS[site].some((host) => match.includes(`//${host}/`))),
  );
}

/** Builtins named `voyager.<site>-<feature>` or `voyager.<feature>` for several sites. */
export function builtinPlugins(manifests: readonly PluginManifest[]): SitePlugin[] {
  return manifests.flatMap((manifest) =>
    siteOf(manifest).map((site) => ({
      site,
      feature: manifest.id.replace(/^voyager\./, '').replace(`${site}-`, ''),
      manifest,
    })),
  );
}

/**
 * Every packaged catalog plugin, at `sites/<site>/plugins/<feature>/plugin.json`.
 * Read from disk rather than `marketplace.json`, which leaves out Gemini's and
 * AI Studio's official plugins.
 */
export function catalogPlugins(): SitePlugin[] {
  return PLUGIN_SITES.flatMap((site) => {
    const dir = join(CATALOG_DIR, 'sites', site, 'plugins');
    if (!existsSync(dir)) return [];
    return readdirSync(dir).flatMap((feature) => {
      const file = join(dir, feature, 'plugin.json');
      if (!existsSync(file)) return [];
      const manifest = JSON.parse(readFileSync(file, 'utf8')) as PluginManifest;
      return [{ site, feature, manifest }];
    });
  });
}

export function featureRows(plugins: readonly SitePlugin[]): FeatureRow[] {
  const rows = new Map<string, FeatureRow>();
  for (const { site, feature, manifest } of plugins) {
    if (SKIPPED_PLUGIN_IDS.has(manifest.id)) continue;
    const key = FEATURE_ALIASES[feature] ?? feature;
    const row = rows.get(key) ?? { feature: key, plugins: {}, native: [] };
    (row.plugins[site] ??= []).push(manifest);
    rows.set(key, row);
  }
  for (const [feature, sites] of Object.entries(NATIVE_FEATURES)) {
    const row = rows.get(feature);
    if (row) row.native = sites.filter((site) => !row.plugins[site]);
  }
  const rank = (feature: string) => {
    const index = FEATURE_ORDER.indexOf(feature);
    return index === -1 ? FEATURE_ORDER.length : index;
  };
  return [...rows.values()].sort((a, b) => rank(a.feature) - rank(b.feature));
}

/** "ChatGPT · Quote replies" → "Quote replies": the site is the column. */
function featureName(row: FeatureRow, locale: string): string {
  const site = NAMING_SITES.find((candidate) => row.plugins[candidate]);
  const manifest = row.plugins[site!]![0];
  const name = manifest.i18n?.[locale]?.name ?? manifest.name;
  return name.replace(/^[^·]*·\s*/, '');
}

/** A site's cell counts as on by default only when the reader has nothing to switch on. */
export function onByDefault(
  row: FeatureRow,
  site: PluginSite,
  defaultEnabled: ReadonlySet<string>,
) {
  if (row.native.includes(site)) return true;
  return row.plugins[site]!.every((manifest) => defaultEnabled.has(manifest.id));
}

function guidePath(locale: PluginsLocale, feature: string): string {
  const slug = GUIDE_PAGES[feature] ?? feature;
  return `${locale.prefix ? `/${locale.prefix}` : ''}/guide/${slug}`;
}

export function renderPluginsPage(
  locale: PluginsLocale,
  rows: readonly FeatureRow[],
  defaultEnabled: ReadonlySet<string>,
  pageExists: (path: string) => boolean,
): string {
  const header = PLUGIN_SITES.map(
    (site) => `${platformMarkSvg(PLATFORM_LOGOS[site])}${PLATFORM_LOGOS[site].label}`,
  );
  const tick = '<span class="gv-plugins-tick">✓</span>';
  const tickOn = `<span class="gv-plugins-tick gv-plugins-on" title="${locale.defaultOn}">✓</span>`;
  const lines = rows.map((row) => {
    const name = featureName(row, locale.manifest);
    const path = guidePath(locale, row.feature);
    const label = pageExists(path) ? `[${name}](${path})` : name;
    const ticks = PLUGIN_SITES.map((site) => {
      if (!row.plugins[site] && !row.native.includes(site)) return '';
      return onByDefault(row, site, defaultEnabled) ? tickOn : tick;
    });
    return `| **${label}** | ${ticks.join(' | ')} |`;
  });
  return [
    `# ${locale.title}`,
    locale.intro,
    '<div class="gv-plugins-table">',
    [
      `| ${locale.feature} | ${header.join(' | ')} |`,
      `| :-- | ${PLUGIN_SITES.map(() => ':-:').join(' | ')} |`,
      ...lines,
    ].join('\n'),
    '</div>',
    `<p class="gv-plugins-legend">${tickOn} ${locale.defaultOn}</p>`,
    `<p class="gv-plugins-disclaimer">${locale.disclaimer}</p>`,
  ].join('\n\n');
}

/** Dynamic-route entries for the locales whose pages live under `prefix`. */
export function pluginsRoutes(rooted: boolean) {
  const rows = featureRows([...builtinPlugins(BUILTIN_PLUGINS), ...catalogPlugins()]);
  const pageExists = (path: string) => existsSync(join(DOCS_ROOT, `${path}.md`));
  return PLUGINS_LOCALES.filter((locale) => (locale.prefix === '') === rooted).map((locale) => ({
    params: rooted
      ? { page: 'plugins', description: locale.intro }
      : { lang: locale.prefix, description: locale.intro },
    content: renderPluginsPage(locale, rows, FRESH_INSTALL_ON, pageExists),
  }));
}
