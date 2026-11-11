// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/" }
/**
 * A scheduled task's later runs share their prompt's turn item, so the
 * prompt's send time must stay on the prompt: never on a run's marker or
 * above a run in the thread.
 */
import './testSetup';
import { describe, expect, it, vi } from 'vitest';

import { requireBundledSiteAdapter } from '@/features/plugins/catalog/sites';
import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { turnNavigatorPrimitive } from '@/features/plugins/verbs/turnNavigator';

import {
  SENT_LABEL,
  exchange,
  inlineTimes,
  installChatGPTSendTimes,
  saveFromAnotherTab,
  scope,
  thread,
  tooltipOf,
} from './sendTimestampsHarness';

vi.mock('@/utils/i18n', () => ({
  onCachedLanguageChange: () => () => {},
  initI18n: vi.fn().mockResolvedValue(undefined),
  getTranslationSync: (key: string) => key,
}));
vi.mock('@/features/timeline/timelineStyleCoachmark', () => ({
  showTimelineStyleCoachmark: vi.fn().mockResolvedValue(undefined),
}));

installChatGPTSendTimes();

describe('send times on a scheduled task', () => {
  it('a scheduled run shows no send time; its prompt keeps one', async () => {
    await scope.dispose();
    const item = exchange('turn-2', 'Daily brief', 'Task created.');
    const runs = item.querySelector('[data-markdown-text-style]')!;
    for (const text of ['Task created.', 'Brief for Monday']) {
      const run = document.createElement('div');
      run.setAttribute('data-dil-source-message-id', text);
      run.textContent = text;
      runs.append(run);
    }
    thread.append(item);
    await saveFromAnotherTab('turn-2', new Date(2026, 9, 5, 12, 34, 56).getTime());

    const rail = new PluginScope();
    turnNavigatorPrimitive.activate(
      rail,
      { reply: '[data-dil-source-message-id]' },
      {
        doc: document,
        adapter: requireBundledSiteAdapter('chatgpt'),
        pluginId: 'voyager.chatgpt-timeline',
        settings: {},
        setTargetCounter: () => {},
      },
    );

    await vi.waitFor(() => expect(inlineTimes('turn-2')).toEqual([SENT_LABEL]));
    expect(await tooltipOf('Daily brief')).toContain(SENT_LABEL);
    expect(await tooltipOf('Brief for Monday')).not.toContain(SENT_LABEL);
    expect(inlineTimes('turn-2')).toEqual([SENT_LABEL]);
    expect(item.querySelector('.gv-timestamp')!.nextElementSibling).toBe(
      item.querySelector('[data-user-message-bubble]'),
    );
    await rail.dispose();
  });
});
