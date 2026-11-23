import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';

import { byId, click, container, en, local, mount, sync, writeElsewhere } from './panelHarness';

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./panelBrowserApi')).extensionApi,
}));

const ID = OFFICIAL_PLUGIN_IDS.geminiHighlight;
const markers = () => {
  const more = container.querySelector(`[data-row="${ID}"] button.more`);
  const controls = more?.getAttribute('aria-controls');
  return controls
    ? byId(controls)!.querySelector<HTMLButtonElement>(
        `[role="switch"][aria-label="${en.showHighlightTimelineMarkers}"]`,
      )
    : null;
};

describe('highlights in the floating panel', () => {
  it('offers the timeline-markers switch under the row and writes its synced key', async () => {
    sync[StorageKeys.HIGHLIGHT_ENABLED] = true;
    await mount();
    expect(markers()).toBeNull();
    await click(container.querySelector(`[data-row="${ID}"] button.more`));
    // Never stored reads on, as the highlight runtime has always read it.
    expect(markers()!.getAttribute('aria-checked')).toBe('true');

    await click(markers());
    expect(sync[StorageKeys.HIGHLIGHT_TIMELINE_MARKERS_ENABLED]).toBe(false);
    expect(local[StorageKeys.PLUGINS_STATE]).toBeUndefined();
    await writeElsewhere('sync', { [StorageKeys.HIGHLIGHT_TIMELINE_MARKERS_ENABLED]: true });
    expect(markers()!.getAttribute('aria-checked')).toBe('true');
  });
});
