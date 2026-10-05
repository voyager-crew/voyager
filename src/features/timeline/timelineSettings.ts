import { type TimelineStyle, isTimelineStyle } from '@/core/types/common';

/** Gemini keeps its pre-plugin sync key names; a native timeline runs only there. */
const NATIVE_TIMELINE_SITE_ID = 'gemini';

/** Sync-storage fields the timeline keeps per site: behaviour knobs and rail placement. */
export type TimelineSettingField =
  | 'ScrollMode'
  | 'Style'
  | 'HideContainer'
  | 'BarWidth'
  | 'Draggable'
  | 'MarkerLevel'
  | 'Position'
  | 'PreviewPinned';

export type TimelineScrollMode = 'flow' | 'jump';

/** The behaviour knobs one rail runs with, whichever site and storage they came from. */
export interface TimelineSettings {
  readonly style: TimelineStyle;
  readonly scrollMode: TimelineScrollMode;
  readonly hideContainer: boolean;
  readonly draggable: boolean;
  readonly markerLevel: boolean;
  readonly previewPinned: boolean;
}

/** Prefix of a site's timeline sync keys: `geminiTimeline<Field>` or `gvTimeline:<site>:<Field>`. */
export function timelineSettingsPrefix(siteId: string): string {
  return siteId === NATIVE_TIMELINE_SITE_ID ? 'geminiTimeline' : `gvTimeline:${siteId}:`;
}

export function timelineSettingKey(siteId: string, field: TimelineSettingField): string {
  return `${timelineSettingsPrefix(siteId)}${field}`;
}

const isScrollMode = (value: unknown): value is TimelineScrollMode =>
  value === 'flow' || value === 'jump';

/** The style a timeline plugin's settings choose; `compactView` is the pre-style boolean. */
function pluginStyle(settings: Readonly<Record<string, unknown>>): TimelineStyle {
  if (isTimelineStyle(settings.timelineStyle)) return settings.timelineStyle;
  return settings.compactView === true ? 'compact' : 'dots';
}

export interface ReadTimelineSettingsInput {
  readonly siteId: string;
  /**
   * The timeline plugin's resolved settings on a catalog site, or null on Gemini, whose knobs are
   * its own sync keys. A plugin owns the style, draggable and level switches; the knobs it does not
   * declare keep their per-site sync value.
   */
  readonly pluginSettings: Readonly<Record<string, unknown>> | null;
  /** Sync values under `timelineSettingKey(siteId, …)`; missing keys fall back to defaults. */
  readonly stored: Readonly<Record<string, unknown>>;
}

/** One reading of timeline settings for every site, for the rail and the popup alike. */
export function readTimelineSettings({
  siteId,
  pluginSettings,
  stored,
}: ReadTimelineSettingsInput): TimelineSettings {
  const read = (field: TimelineSettingField) => stored[timelineSettingKey(siteId, field)];
  const storedMode = read('ScrollMode');
  const storedStyle = read('Style');
  const fromStorage: TimelineSettings = {
    style: isTimelineStyle(storedStyle) ? storedStyle : 'dots',
    scrollMode: isScrollMode(storedMode) ? storedMode : 'flow',
    hideContainer: !!read('HideContainer'),
    draggable: !!read('Draggable'),
    markerLevel: !!read('MarkerLevel'),
    previewPinned: read('PreviewPinned') === true,
  };
  if (!pluginSettings) return fromStorage;
  return {
    ...fromStorage,
    style: pluginStyle(pluginSettings),
    // Catalog rails have always been draggable unless a plugin turns it off.
    draggable: pluginSettings.draggable !== false,
    markerLevel: pluginSettings.markerLevel === true,
  };
}
