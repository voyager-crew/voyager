import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';

import { byId, click, container, en, local, mount, sync, writeElsewhere } from './panelHarness';

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./panelBrowserApi')).extensionApi,
}));

const ID = OFFICIAL_PLUGIN_IDS.geminiTimeline;
const more = () => container.querySelector(`[data-row="${ID}"] button.more`);
const area = () => byId(more()!.getAttribute('aria-controls')!)!;
const styleChip = () =>
  container.querySelector<HTMLButtonElement>(`[data-row="${ID}"] button.chip`);
const modeChip = () => area().querySelector<HTMLButtonElement>('button.chip');
const switchOf = (label: string) =>
  area().querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${label}"]`);
/** The items of the open chip menu (every row's menu stays in the document, hidden). */
const items = () =>
  Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      '[role="menu"]:not([hidden]) [role="menuitemradio"]',
    ),
  );
const item = (label: string) => items().find((entry) => entry.textContent === label) ?? null;

describe('the timeline in the floating panel', () => {
  it('shows the style on the row and the other options under it, each on its synced key', async () => {
    sync[StorageKeys.TIMELINE_STYLE] = 'compact';
    sync[StorageKeys.TIMELINE_SCROLL_MODE] = 'jump';
    await mount();
    expect(styleChip()!.getAttribute('aria-label')).toBe(
      `${en.timelineStyle}: ${en.timelineStyleCompact}`,
    );
    await click(styleChip());
    await click(item(en.timelineStyleRuler));
    expect(sync[StorageKeys.TIMELINE_STYLE]).toBe('ruler');

    await click(more());
    expect(modeChip()!.getAttribute('aria-label')).toBe(`${en.scrollMode}: ${en.jump}`);
    await click(modeChip());
    await click(item(en.flow));
    expect(sync[StorageKeys.TIMELINE_SCROLL_MODE]).toBe('flow');

    for (const [label, key] of [
      [en.hideOuterContainer, StorageKeys.TIMELINE_HIDE_CONTAINER],
      [en.draggableTimeline, StorageKeys.TIMELINE_DRAGGABLE],
      [en.pinTimelinePreview, StorageKeys.TIMELINE_PREVIEW_PINNED],
    ] as const) {
      expect(switchOf(label)!.getAttribute('aria-checked'), label).toBe('false');
      await click(switchOf(label));
      expect(sync[key], label).toBe(true);
    }
    expect(local[StorageKeys.PLUGINS_STATE]).toBeUndefined();

    await writeElsewhere('sync', { [StorageKeys.TIMELINE_DRAGGABLE]: false });
    expect(switchOf(en.draggableTimeline)!.getAttribute('aria-checked')).toBe('false');
  });

  it('turning node levels on writes dots with them and leaves only dots to pick', async () => {
    sync[StorageKeys.TIMELINE_STYLE] = 'ruler';
    await mount();
    await click(more());
    await click(switchOf(en.enableMarkerLevel));
    expect(sync[StorageKeys.TIMELINE_MARKER_LEVEL]).toBe(true);
    expect(sync[StorageKeys.TIMELINE_STYLE]).toBe('dots');

    await click(styleChip());
    expect(items().map((entry) => [entry.textContent, entry.disabled])).toEqual([
      [en.timelineStyleDots, false],
      [en.timelineStyleRuler, true],
      [en.timelineStyleCompact, true],
    ]);
  });
});
