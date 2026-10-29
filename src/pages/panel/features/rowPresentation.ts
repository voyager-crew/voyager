import {
  ALargeSmall,
  Activity,
  ArrowDownToLine,
  Baseline,
  Bell,
  Brain,
  ChartLine,
  ChevronsDownUp,
  Clock,
  Copy,
  CornerDownLeft,
  Eraser,
  FileDown,
  FilePenLine,
  FoldVertical,
  Folder,
  Gauge,
  Gem,
  GitFork,
  Hash,
  Highlighter,
  History,
  ImageOff,
  Keyboard,
  Languages,
  ListCollapse,
  Lock,
  type LucideIcon,
  MessageSquareText,
  Milestone,
  MoveHorizontal,
  Package,
  PanelLeft,
  PanelLeftClose,
  PanelLeftDashed,
  Plug,
  Puzzle,
  RefreshCw,
  Shapes,
  Sigma,
  Snowflake,
  Sparkles,
  SquareCode,
  Stethoscope,
  Table,
  Telescope,
  TextCursorInput,
  TextQuote,
  Timer,
  Trash2,
  Type,
  WandSparkles,
  Workflow,
  WrapText,
} from 'lucide-react';

import type { PluginManifest } from '@/features/plugins/types';
import type { OfficialPluginTopicId } from '@/pages/popup/officialPlugins/officialPluginRegistry';

interface RowPresentation {
  readonly icon: LucideIcon;
  /** The group a plugin without an official entry joins; official rows keep their entry's topic. */
  readonly topic: OfficialPluginTopicId;
}

const row = (icon: LucideIcon, topic: OfficialPluginTopicId): RowPresentation => ({ icon, topic });

/**
 * Presentation only, keyed by the feature part of a plugin id, so
 * `voyager.<site>-reading-width` shares one entry on every site. Manifests
 * stay as they are; an id this table does not know gets the default icon and
 * a group from its category, so a newly installed plugin still gets a row.
 */
const PRESENTATION: Readonly<Record<string, RowPresentation>> = {
  'chat-width': row(MoveHorizontal, 'pluginsLayout'),
  'reading-width': row(MoveHorizontal, 'pluginsLayout'),
  'edit-input-width': row(TextCursorInput, 'pluginsLayout'),
  'chat-font-size': row(ALargeSmall, 'pluginsLayout'),
  'chat-line-height': row(Baseline, 'pluginsLayout'),
  'reading-typography': row(Type, 'pluginsLayout'),
  'hide-input-halo': row(Sparkles, 'pluginsLayout'),
  'visual-effects': row(Snowflake, 'pluginsLayout'),
  'sidebar-width': row(PanelLeft, 'pluginsSidebar'),
  'sidebar-auto-hide': row(PanelLeftDashed, 'pluginsSidebar'),
  'sidebar-full-hide': row(PanelLeftClose, 'pluginsSidebar'),
  'gems-sidebar': row(Gem, 'pluginsSidebar'),
  folders: row(Folder, 'pluginsSidebar'),
  timeline: row(Milestone, 'pluginsTimeline'),
  'message-timestamps': row(Clock, 'pluginsTimeline'),
  'prevent-auto-scroll': row(ArrowDownToLine, 'pluginsTimeline'),
  highlight: row(Highlighter, 'pluginsTimeline'),
  'code-collapse': row(FoldVertical, 'pluginsContent'),
  'collapse-long-messages': row(ListCollapse, 'pluginsContent'),
  'wrap-code': row(WrapText, 'pluginsContent'),
  'user-latex': row(SquareCode, 'pluginsContent'),
  'formula-copy': row(Sigma, 'pluginsContent'),
  'markdown-fix': row(WandSparkles, 'pluginsContent'),
  'cjk-render-fix': row(Languages, 'pluginsContent'),
  'table-copy': row(Table, 'pluginsContent'),
  'copy-thinking': row(Brain, 'pluginsContent'),
  mermaid: row(Workflow, 'pluginsCharts'),
  echarts: row(ChartLine, 'pluginsCharts'),
  wavedrom: row(Activity, 'pluginsCharts'),
  'diagram-rendering': row(Shapes, 'pluginsCharts'),
  export: row(FileDown, 'pluginsExport'),
  'deep-research-export': row(Telescope, 'pluginsExport'),
  'canvas-copy': row(Copy, 'pluginsExport'),
  'watermark-download': row(Eraser, 'pluginsExport'),
  'watermark-preview': row(ImageOff, 'pluginsExport'),
  'prompt-manager': row(MessageSquareText, 'pluginsInput'),
  'ctrl-enter-send': row(CornerDownLeft, 'pluginsInput'),
  'enter-send': row(CornerDownLeft, 'pluginsInput'),
  'safari-enter-fix': row(CornerDownLeft, 'pluginsInput'),
  'vim-input': row(Keyboard, 'pluginsInput'),
  'input-vim': row(Keyboard, 'pluginsInput'),
  'input-collapse': row(ChevronsDownUp, 'pluginsInput'),
  'prompt-history': row(History, 'pluginsInput'),
  'draft-save': row(FilePenLine, 'pluginsInput'),
  'quote-reply': row(TextQuote, 'pluginsInput'),
  'composer-counter': row(Hash, 'pluginsInput'),
  fork: row(GitFork, 'pluginsConversations'),
  'batch-delete': row(Trash2, 'pluginsConversations'),
  'default-model': row(Lock, 'pluginsConversations'),
  'research-pack': row(Package, 'pluginsConversations'),
  'usage-status': row(Gauge, 'pluginsConversations'),
  'pro-usage': row(Gauge, 'pluginsConversations'),
  'response-notification': row(Bell, 'pluginsConversations'),
  'context-sync': row(RefreshCw, 'pluginsConversations'),
  'local-bridge': row(Plug, 'pluginsConversations'),
  'temporary-handoff': row(Timer, 'pluginsConversations'),
  'site-check': row(Stethoscope, 'pluginsConversations'),
};

export const DEFAULT_ROW_ICON: LucideIcon = Puzzle;

/** `voyager.chatgpt-local-bridge` tries `chatgpt-local-bridge`, then `local-bridge`, then `bridge`. */
function presentationFor(pluginId: string): RowPresentation | undefined {
  const parts = pluginId.slice(pluginId.indexOf('.') + 1).split('-');
  for (let start = 0; start < parts.length; start += 1) {
    const found = PRESENTATION[parts.slice(start).join('-')];
    if (found) return found;
  }
  return undefined;
}

export function rowIcon(pluginId: string): LucideIcon {
  return presentationFor(pluginId)?.icon ?? DEFAULT_ROW_ICON;
}

const CATEGORY_TOPICS: Readonly<Record<string, OfficialPluginTopicId>> = {
  layout: 'pluginsLayout',
  theme: 'pluginsLayout',
  readability: 'pluginsContent',
  'render-fix': 'pluginsContent',
  input: 'pluginsInput',
  productivity: 'pluginsInput',
};

/** The group of a plugin row that has no official entry. */
export function rowTopic(plugin: Pick<PluginManifest, 'id' | 'category'>): OfficialPluginTopicId {
  return (
    presentationFor(plugin.id)?.topic ?? CATEGORY_TOPICS[plugin.category] ?? 'pluginsConversations'
  );
}
