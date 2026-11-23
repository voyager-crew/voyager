import browser from 'webextension-polyfill';

import { createHighlighterIcon } from '@/core/icons/highlighterIcon';
import { StorageKeys } from '@/core/types/common';
import { type HighlightColor, isHighlightColor } from '@/core/types/highlight';
import { getTranslationSync } from '@/utils/i18n';

import type { StopNativeFeature } from '../featureLifecycle';
import { createHighlightColorPicker } from '../quoteReply/highlightColorPicker';
import {
  markSelectionToolbarInternalClick,
  registerSelectionAction,
  restoreSelectionToolbarRange,
} from '../selectionToolbar/host';
import { HighlightManager } from './manager';

/**
 * Sub-settings the caller already read; omitted, the action reads the colors
 * itself. Timeline markers are the plugin's `timelineMarkers` setting: on unless
 * given off here, then changed through `setHighlightTimelineMarkersEnabled`.
 */
export interface HighlightActionOptions {
  readonly defaultColor?: HighlightColor;
  readonly colorPalette?: readonly HighlightColor[];
  readonly timelineMarkersEnabled?: boolean;
}

const SUB_SETTING_KEYS = [
  StorageKeys.HIGHLIGHT_DEFAULT_COLOR,
  StorageKeys.HIGHLIGHT_COLOR_PALETTE,
] as const;

/** The running action's marker switch; null while none runs. */
let applyTimelineMarkers: ((enabled: boolean) => void) | null = null;

/**
 * Show or hide saved highlights on the timeline for the running action, in
 * place. The plugin host calls this when the highlight plugin's
 * `timelineMarkers` setting changes; with no action running it does nothing.
 */
export function setHighlightTimelineMarkersEnabled(enabled: boolean): void {
  applyTimelineMarkers?.(enabled);
}

/**
 * Run saved highlights and the toolbar's Highlight action. Stop is synchronous: it unregisters the
 * action and destroys the manager even while its first load is still pending.
 */
export function startHighlightAction(options?: HighlightActionOptions): StopNativeFeature {
  const manager = new HighlightManager();
  const picker = createHighlightColorPicker(
    {
      highlightDefaultColor: options?.defaultColor,
      highlightColorPalette: options?.colorPalette,
    },
    {
      onInternalClick: markSelectionToolbarInternalClick,
      restoreSelection: restoreSelectionToolbarRange,
      onPaletteChange: (colors) => manager.setColorPalette(colors),
    },
  );
  manager.setColorPalette(picker.colors);
  manager.setTimelineMarkersEnabled(options?.timelineMarkersEnabled !== false);
  const setMarkers = (enabled: boolean): void => manager.setTimelineMarkersEnabled(enabled);
  applyTimelineMarkers = setMarkers;
  let stopped = false;
  // Per key: a live change to one sub-setting must not discard the initial read of the others.
  const changedLive = new Set<string>();

  const onStorageChanged = (
    changes: Record<string, browser.Storage.StorageChange>,
    areaName: string,
  ): void => {
    if (areaName !== 'sync') return;
    for (const key of SUB_SETTING_KEYS) if (key in changes) changedLive.add(key);
    picker.applyStorageChanges(changes);
  };

  async function readSubSettings(): Promise<void> {
    let stored: Record<string, unknown>;
    try {
      stored = await browser.storage.sync.get({
        [StorageKeys.HIGHLIGHT_DEFAULT_COLOR]: 'yellow',
        [StorageKeys.HIGHLIGHT_COLOR_PALETTE]: null,
      });
    } catch {
      return;
    }
    if (stopped) return;
    // A key changed while reading is newer than the read; every other key takes the read.
    const fresh = (key: string): boolean => !changedLive.has(key);
    const storedColor = stored[StorageKeys.HIGHLIGHT_DEFAULT_COLOR];
    const initial: Record<string, browser.Storage.StorageChange> = {};
    if (fresh(StorageKeys.HIGHLIGHT_COLOR_PALETTE)) {
      initial[StorageKeys.HIGHLIGHT_COLOR_PALETTE] = {
        newValue: stored[StorageKeys.HIGHLIGHT_COLOR_PALETTE],
      };
    }
    if (fresh(StorageKeys.HIGHLIGHT_DEFAULT_COLOR)) {
      initial[StorageKeys.HIGHLIGHT_DEFAULT_COLOR] = {
        newValue: isHighlightColor(storedColor) ? storedColor : 'yellow',
      };
    }
    picker.applyStorageChanges(initial);
  }

  browser.storage.onChanged.addListener(onStorageChanged);
  const unregister = registerSelectionAction({
    id: 'highlight',
    order: 20,
    className: 'gv-highlight-action',
    label: () => getTranslationSync('highlightAction'),
    createIcon: () => createHighlighterIcon(16),
    isAvailable: (range) => manager.canCreateFromRange(range),
    run: (range) => manager.createFromRange(range, picker.color),
    controls: picker,
  });
  if (!options) void readSubSettings();
  void manager.init();

  return () => {
    if (stopped) return;
    stopped = true;
    if (applyTimelineMarkers === setMarkers) applyTimelineMarkers = null;
    browser.storage.onChanged.removeListener(onStorageChanged);
    unregister();
    manager.destroy();
    picker.hide();
    picker.unmount();
  };
}
