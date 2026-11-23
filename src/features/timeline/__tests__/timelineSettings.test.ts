import { describe, expect, it } from 'vitest';

import { readTimelineSettings } from '../timelineSettings';

const STORED_CATALOG = {
  'gvTimeline:claude:ScrollMode': 'jump',
  'gvTimeline:claude:HideContainer': true,
  'gvTimeline:claude:PreviewPinned': true,
};

describe('readTimelineSettings', () => {
  it('takes the knobs a plugin declares from its settings, not from the same sync keys', () => {
    expect(
      readTimelineSettings({
        siteId: 'gemini',
        pluginSettings: {
          timelineStyle: 'ruler',
          scrollMode: 'flow',
          hideContainer: false,
          draggable: false,
          previewPinned: false,
          markerLevel: true,
        },
        stored: {
          geminiTimelineStyle: 'compact',
          geminiTimelineScrollMode: 'jump',
          geminiTimelineHideContainer: true,
          geminiTimelineDraggable: true,
          geminiTimelinePreviewPinned: true,
          geminiTimelineMarkerLevel: false,
        },
      }),
    ).toEqual({
      style: 'ruler',
      scrollMode: 'flow',
      hideContainer: false,
      draggable: false,
      previewPinned: false,
      markerLevel: true,
    });
  });

  it('keeps a catalog rail on its per-site sync value for the knobs its plugin does not declare', () => {
    expect(
      readTimelineSettings({
        siteId: 'claude',
        pluginSettings: { timelineStyle: 'dots' },
        stored: STORED_CATALOG,
      }),
    ).toEqual({
      style: 'dots',
      scrollMode: 'jump',
      hideContainer: true,
      // Catalog rails have always been draggable unless a plugin turns it off.
      draggable: true,
      previewPinned: true,
      markerLevel: false,
    });
  });
});
