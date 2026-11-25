/** The permanent Gemini selection services and their official admission floor. */
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CleanupPositions } from '@/core/types/cleanupPositions';
import { StorageKeys } from '@/core/types/common';
import { CleanupManager } from '@/core/utils/cleanupManager';
import { createOfficialAdmission } from '@/features/plugins/runtime/officialAdmission';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';

import type { NativeFeature } from '../featureLifecycle';
import { NATIVE_FEATURES } from '../nativeFeatures';
import { createSelectionStartup } from '../selectionStartup';

let teardowns: Array<() => void> = [];

function page() {
  const cleanupManager = new CleanupManager();
  const lifetime = new AbortController();
  const admission = createOfficialAdmission();
  const startup = createSelectionStartup(admission, cleanupManager, lifetime.signal);
  teardowns.push(() => cleanupManager.executeCleanups());
  return {
    cleanupManager,
    lifetime,
    admission,
    startup,
    unload: () => cleanupManager.executeCleanups(),
    retire: () => {
      lifetime.abort();
      cleanupManager.executeCleanups();
    },
  };
}

async function flushPromises(): Promise<void> {
  for (let round = 0; round < 10; round += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML =
    '<main><user-query><p class="query-text-line">&gt; Sent quote</p></user-query></main>';
  (chrome.storage.sync.get as unknown as Mock).mockResolvedValue({
    [StorageKeys.QUOTE_REPLY_ENABLED]: false,
    [StorageKeys.HIGHLIGHT_ENABLED]: false,
  });
});

afterEach(() => {
  teardowns.splice(0).forEach((teardown) => teardown());
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('the Gemini selection start point', () => {
  it('starts the toolbar and sent-quote styling even while both actions are off', async () => {
    const { startup, admission, unload } = page();
    await startup.start();
    expect(document.getElementById('gemini-voyager-quote-reply-style')).not.toBeNull();
    expect(document.querySelector('.gv-rendered-quote-line')?.textContent).toBe('> Sent quote');
    expect(admission.stateOf(OFFICIAL_PLUGIN_IDS.geminiQuoteReply)).toBe('admitted');
    expect(admission.stateOf(OFFICIAL_PLUGIN_IDS.geminiHighlight)).toBe('admitted');
    unload();
    expect(document.getElementById('gemini-voyager-quote-reply-style')).toBeNull();
    expect(document.querySelector('.gv-rendered-quote-line')).toBeNull();
    expect(document.querySelector('.query-text-line')?.textContent).toBe('> Sent quote');
  });

  it('startup cleanup runs before the permanent services and plugin consumers stop before them', async () => {
    const { cleanupManager, startup } = page();
    await startup.start();
    const positions = cleanupManager.list().map(({ pos }) => pos);
    expect(Math.min(...positions)).toBe(CleanupPositions.CleanupSelectionStartup);
    expect(positions).toEqual(
      expect.arrayContaining([
        CleanupPositions.CleanupRenderedQuoteStyling,
        CleanupPositions.CleanupSelectionToolbarHost,
      ]),
    );
    expect(CleanupPositions.CleanupPluginHost).toBeLessThan(
      CleanupPositions.CleanupRenderedQuoteStyling,
    );
    expect(CleanupPositions.CleanupRenderedQuoteStyling).toBeLessThan(
      CleanupPositions.CleanupSelectionToolbarHost,
    );
  });

  it('waits for the toolbar, then styling, then admits Quote and Highlight in order', async () => {
    const { startup, admission, unload } = page();
    let finishHost!: (stop: () => void) => void;
    let finishStyling!: (stop: () => void) => void;
    const host: NativeFeature = NATIVE_FEATURES.selectionToolbarHost;
    const styling: NativeFeature = NATIVE_FEATURES.renderedQuoteStyling;
    const hostStart = vi.spyOn(host, 'start').mockReturnValue(
      new Promise((resolve) => {
        finishHost = resolve;
      }),
    );
    const stylingStart = vi.spyOn(styling, 'start').mockReturnValue(
      new Promise((resolve) => {
        finishStyling = resolve;
      }),
    );
    const stopped: string[] = [];
    const admitted: string[] = [];
    admission.subscribe(() => {
      for (const id of [
        OFFICIAL_PLUGIN_IDS.geminiQuoteReply,
        OFFICIAL_PLUGIN_IDS.geminiHighlight,
      ]) {
        if (admission.stateOf(id) === 'admitted' && !admitted.includes(id)) admitted.push(id);
      }
    });
    const starting = startup.start();
    expect(hostStart).toHaveBeenCalledOnce();
    expect(stylingStart).not.toHaveBeenCalled();
    finishHost(() => {
      stopped.push('host');
    });
    await flushPromises();
    expect(stylingStart).toHaveBeenCalledOnce();
    expect(admitted).toEqual([]);
    finishStyling(() => {
      stopped.push('styling');
    });
    await starting;
    expect(admitted).toEqual([
      OFFICIAL_PLUGIN_IDS.geminiQuoteReply,
      OFFICIAL_PLUGIN_IDS.geminiHighlight,
    ]);
    unload();
    expect(stopped).toEqual(['styling', 'host']);
  });

  it.each(['selectionToolbarHost', 'renderedQuoteStyling'] as const)(
    'admits neither plugin when teardown lands during %s startup',
    async (service) => {
      const { startup, admission, unload } = page();
      let finish!: (stop: () => void) => void;
      const feature: NativeFeature = NATIVE_FEATURES[service];
      vi.spyOn(feature, 'start').mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const starting = startup.start();
      await flushPromises();
      unload();
      finish(() => {});
      await starting;
      admission.close();
      expect(admission.stateOf(OFFICIAL_PLUGIN_IDS.geminiQuoteReply)).toBe('denied');
      expect(admission.stateOf(OFFICIAL_PLUGIN_IDS.geminiHighlight)).toBe('denied');
      expect(document.getElementById('gemini-voyager-quote-reply-style')).toBeNull();
      expect(document.querySelector('.gv-rendered-quote-line')).toBeNull();
    },
  );

  it('stops a late permanent service once after retirement and admits no action', async () => {
    const { startup, admission, cleanupManager, retire } = page();
    let finish!: (stop: () => void) => void;
    const stop = vi.fn();
    const styling: NativeFeature = NATIVE_FEATURES.renderedQuoteStyling;
    vi.spyOn(styling, 'start').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const starting = startup.start();
    await flushPromises();
    retire();
    finish(stop);
    await starting;
    admission.close();
    expect(stop).toHaveBeenCalledOnce();
    expect(cleanupManager.list()).toEqual([]);
    expect(admission.stateOf(OFFICIAL_PLUGIN_IDS.geminiQuoteReply)).toBe('denied');
    expect(admission.stateOf(OFFICIAL_PLUGIN_IDS.geminiHighlight)).toBe('denied');
  });

  it('starts no core service or action after the lifetime aborts before cleanup', async () => {
    const { startup, admission, lifetime } = page();
    lifetime.abort();
    await startup.start();
    admission.close();
    expect(document.getElementById('gemini-voyager-quote-reply-style')).toBeNull();
    expect(document.querySelector('.gv-rendered-quote-line')).toBeNull();
    expect(admission.stateOf(OFFICIAL_PLUGIN_IDS.geminiQuoteReply)).toBe('denied');
    expect(admission.stateOf(OFFICIAL_PLUGIN_IDS.geminiHighlight)).toBe('denied');
  });
});
