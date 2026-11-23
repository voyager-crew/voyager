import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '@/contexts/LanguageContext';
import { StorageKeys } from '@/core/types/common';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { loadTranslations } from '@/utils/translations';

import Popup from '../../Popup';
import { emitSyncChange, extensionApi, popupRows, resetPopupBrowser } from './popupHarness';

const en = await loadTranslations('en');
const zh = await loadTranslations('zh');

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./popupHarness')).extensionApi,
}));

/** The rail's options come from the manifest settings, as every surface shows them. */
describe('the timeline row', () => {
  const id = OFFICIAL_PLUGIN_IDS.geminiTimeline;
  let container: HTMLDivElement;
  let root: Root;
  let local: Record<string, unknown>;
  let sync: Record<string, unknown>;

  beforeEach(() => {
    ({ local, sync } = resetPopupBrowser());
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const mount = async () => {
    await act(async () => {
      root.render(
        <LanguageProvider>
          <Popup />
        </LanguageProvider>,
      );
    });
  };
  const row = () => popupRows(container).row(id);
  const select = (label: string) =>
    [...(row()?.querySelectorAll('label') ?? [])]
      .find((candidate) => candidate.textContent?.includes(label))
      ?.querySelector('select') ?? null;
  const options = (label: string) =>
    [...select(label)!.options].map((option) => [option.value, option.text, option.disabled]);
  const toggleOf = (label: string) =>
    row()?.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`) ?? null;
  const pick = async (label: string, value: string) => {
    const element = select(label)!;
    await act(async () => {
      element.value = value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  const button = (label: string) =>
    [...row()!.querySelectorAll('button')].find((candidate) => candidate.textContent === label);
  const writes = () => extensionApi.storage.sync.set.mock.calls.map(([payload]) => payload);
  const SWITCHES = [
    en.hideOuterContainer,
    en.draggableTimeline,
    en.pinTimelinePreview,
    en.enableMarkerLevel,
  ];

  it('offers every option only while the timeline is on', async () => {
    sync[StorageKeys.GV_TIMELINE_ENABLED] = false;
    await mount();
    expect(select(en.timelineStyle)).toBeNull();
    for (const label of SWITCHES) expect(toggleOf(label), label).toBeNull();

    await act(async () => popupRows(container).toggle(id).click());
    expect(options(en.timelineStyle)).toEqual([
      ['dots', en.timelineStyleDots, false],
      ['ruler', en.timelineStyleRuler, false],
      ['compact', en.timelineStyleCompact, false],
    ]);
    expect(options(en.scrollMode)).toEqual([
      ['flow', en.flow, false],
      ['jump', en.jump, false],
    ]);
    for (const label of SWITCHES) expect(toggleOf(label), label).not.toBeNull();
    // Message times are a row of their own, so the timeline does not repeat them.
    expect(row()!.querySelector('#show-message-timestamps')).toBeNull();
  });

  it.each([
    ['nothing stored', {}, ['dots', 'flow'], [false, false, false, false]],
    [
      'every option set',
      {
        geminiTimelineStyle: 'compact',
        geminiTimelineScrollMode: 'jump',
        geminiTimelineHideContainer: true,
        geminiTimelineDraggable: true,
        geminiTimelinePreviewPinned: true,
        geminiTimelineMarkerLevel: true,
      },
      ['compact', 'jump'],
      [true, true, true, true],
    ],
    [
      'values the rail never accepted',
      {
        geminiTimelineStyle: 'grid',
        geminiTimelineScrollMode: 'smooth',
        geminiTimelineHideContainer: 1,
        geminiTimelineDraggable: 'yes',
        geminiTimelinePreviewPinned: 'true',
        geminiTimelineMarkerLevel: 0,
      },
      ['dots', 'flow'],
      [true, true, false, false],
    ],
  ] as const)('shows %s the way the rail reads it', async (_label, stored, picks, switches) => {
    Object.assign(sync, stored);
    await mount();
    expect([select(en.timelineStyle)!.value, select(en.scrollMode)!.value]).toEqual(picks);
    expect(SWITCHES.map((label) => toggleOf(label)!.checked)).toEqual(switches);
  });

  it('writes each option under its old sync key, never plugin state, and follows a change made elsewhere', async () => {
    await mount();
    await pick(en.timelineStyle, 'ruler');
    await pick(en.scrollMode, 'jump');
    for (const label of SWITCHES.slice(0, 3)) await act(async () => toggleOf(label)!.click());
    expect(writes()).toEqual([
      { [StorageKeys.TIMELINE_STYLE]: 'ruler' },
      { [StorageKeys.TIMELINE_SCROLL_MODE]: 'jump' },
      { [StorageKeys.TIMELINE_HIDE_CONTAINER]: true },
      { [StorageKeys.TIMELINE_DRAGGABLE]: true },
      { [StorageKeys.TIMELINE_PREVIEW_PINNED]: true },
    ]);
    expect(local[StorageKeys.PLUGINS_STATE]).toBeUndefined();

    await act(async () => emitSyncChange({ [StorageKeys.TIMELINE_STYLE]: 'compact' }));
    expect(select(en.timelineStyle)!.value).toBe('compact');
  });

  it('node levels allow only dots, and turning them on writes dots with them', async () => {
    sync[StorageKeys.TIMELINE_STYLE] = 'ruler';
    await mount();
    await act(async () => toggleOf(en.enableMarkerLevel)!.click());
    expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
      [StorageKeys.TIMELINE_STYLE]: 'dots',
      [StorageKeys.TIMELINE_MARKER_LEVEL]: true,
    });
    expect(options(en.timelineStyle).map(([value, , disabled]) => [value, disabled])).toEqual([
      ['dots', false],
      ['ruler', true],
      ['compact', true],
    ]);
  });

  it('resets only the saved position and opens the Saved Library', async () => {
    await mount();
    await act(async () => button(en.resetTimelinePosition)!.click());
    expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
      [StorageKeys.TIMELINE_POSITION]: null,
    });
    await act(async () => button(en.viewStarredHistory)!.click());
    expect(row()).toBeNull();
  });

  it.each(['ruler', '收藏', zh.timelineOptions])(
    'a search for "%s" lists the row with its options',
    async (query) => {
      local[StorageKeys.GV_POPUP_SETTINGS_SEARCH_QUERY] = query;
      await mount();
      expect(toggleOf(en.draggableTimeline)).not.toBeNull();
    },
  );
});
