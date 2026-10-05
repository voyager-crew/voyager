import type { PluginLocalization, PluginManifest } from '../types';

/** Same experimental, default-off switch, wording and dots-only rule as Gemini's native timeline setting. */
const MARKER_LEVEL_SETTING = {
  type: 'boolean',
  label: 'Enable node levels',
  default: false,
  experimental: true,
  messageKeys: { label: 'enableMarkerLevel', hint: 'enableMarkerLevelHint' },
  // Levels have a shape only on the dots rail.
  requiresChoice: { setting: 'timelineStyle', value: 'dots' },
} as const;

/** Per-locale name, description and style labels; only the site name varies between builtins. */
const LOCALIZED: Readonly<
  Record<
    string,
    {
      name: (site: string) => string;
      description: (site: string) => string;
      styleLabel: string;
      styles: Readonly<Record<'dots' | 'compact' | 'ruler', string>>;
    }
  >
> = {
  zh: {
    name: (site) => `${site} · 时间线`,
    description: (site) => `为 ${site} 添加紧凑的对话时间线，支持星标消息和搜索。`,
    styleLabel: '时间线样式',
    styles: { dots: '节点', compact: '紧凑索引', ruler: '刻度' },
  },
  zh_TW: {
    name: (site) => `${site} · 時間線`,
    description: (site) => `為 ${site} 加入緊湊的對話時間線，支援星標訊息與搜尋。`,
    styleLabel: '時間軸樣式',
    styles: { dots: '節點', compact: '精簡索引', ruler: '刻度' },
  },
  ja: {
    name: (site) => `${site} · タイムライン`,
    description: (site) =>
      `${site} にコンパクトな会話タイムラインを追加し、スター付きメッセージと検索に対応します。`,
    styleLabel: 'タイムライン表示',
    styles: { dots: 'ノード', compact: 'コンパクト', ruler: '目盛り' },
  },
  ko: {
    name: (site) => `${site} · 타임라인`,
    description: (site) =>
      `${site}에 별표 메시지와 검색을 지원하는 간단한 대화 타임라인을 추가합니다.`,
    styleLabel: '타임라인 스타일',
    styles: { dots: '노드', compact: '컴팩트', ruler: '눈금' },
  },
  fr: {
    name: (site) => `${site} · Timeline`,
    description: (site) =>
      `Ajoute une timeline compacte à ${site} avec messages favoris et recherche.`,
    styleLabel: 'Style de la chronologie',
    styles: { dots: 'Nœuds', compact: 'Compact', ruler: 'Graduations' },
  },
  es: {
    name: (site) => `${site} · Línea de tiempo`,
    description: (site) =>
      `Añade a ${site} una línea de tiempo compacta con mensajes destacados y búsqueda.`,
    styleLabel: 'Estilo de cronología',
    styles: { dots: 'Nodos', compact: 'Compacto', ruler: 'Escala' },
  },
  pt: {
    name: (site) => `${site} · Linha do tempo`,
    description: (site) =>
      `Adiciona ao ${site} uma linha do tempo compacta com mensagens favoritas e busca.`,
    styleLabel: 'Estilo da linha do tempo',
    styles: { dots: 'Nós', compact: 'Compacto', ruler: 'Régua' },
  },
  ru: {
    name: (site) => `${site} · Таймлайн`,
    description: (site) => `Добавляет в ${site} компактную шкалу диалога со звёздами и поиском.`,
    styleLabel: 'Стиль временной шкалы',
    styles: { dots: 'Узлы', compact: 'Компактный', ruler: 'Шкала' },
  },
  ar: {
    name: (site) => `${site} · المخطط الزمني`,
    description: (site) => `يضيف إلى ${site} مخططًا زمنيًا موجزًا مع الرسائل المميزة والبحث.`,
    styleLabel: 'نمط الخط الزمني',
    styles: { dots: 'العُقد', compact: 'مضغوط', ruler: 'تدريج' },
  },
};

export interface TimelineManifestOptions {
  /** Stored in `gvPluginsState`; changing it drops the user's toggle and settings. */
  readonly id: string;
  readonly siteLabel: string;
  readonly version: string;
  readonly matches: readonly string[];
  /** `turnNavigator` params; selectors and the conversation id otherwise come from site.json. */
  readonly params: Readonly<Record<string, unknown>>;
}

/** A builtin site timeline: the `turnNavigator` primitive with the shared style and level settings. */
export function timelineManifest({
  id,
  siteLabel,
  version,
  matches,
  params,
}: TimelineManifestOptions): PluginManifest {
  const i18n: Record<string, PluginLocalization> = {};
  for (const [locale, copy] of Object.entries(LOCALIZED)) {
    i18n[locale] = {
      name: copy.name(siteLabel),
      description: copy.description(siteLabel),
      settings: { timelineStyle: { label: copy.styleLabel, options: { ...copy.styles } } },
    };
  }
  return {
    id,
    name: `${siteLabel} · Timeline`,
    version,
    description: `Adds a compact conversation timeline to ${siteLabel} with starred messages and search.`,
    i18n,
    author: 'voyager-official',
    category: 'productivity',
    license: 'GPL-3.0-or-later',
    engine: '>=1.6.0',
    tier: 'declarative',
    matches,
    requires: { handlers: ['turnNavigator'], semantic: ['userTurn'] },
    contributes: {
      settings: {
        timelineStyle: {
          type: 'select',
          label: 'Timeline style',
          default: 'dots',
          options: [
            { value: 'dots', label: 'Nodes' },
            { value: 'compact', label: 'Compact' },
            { value: 'ruler', label: 'Ruler' },
          ],
        },
        markerLevel: MARKER_LEVEL_SETTING,
      },
      domOps: [{ op: 'native', handler: 'turnNavigator', params }],
    },
  };
}
