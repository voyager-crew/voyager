import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';

import {
  byId,
  click,
  container,
  en,
  local,
  mount,
  rowSwitch,
  sync,
  writeElsewhere,
} from './panelHarness';

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./panelBrowserApi')).extensionApi,
}));

const more = (id: string) =>
  container.querySelector<HTMLButtonElement>(`[data-row="${id}"] button.more`);
/** The open options area of a row, found through its button as assistive tech would. */
const area = (id: string) => {
  const controls = more(id)?.getAttribute('aria-controls');
  return controls ? byId(controls) : null;
};

/** Settings a row's slider and chip leave out open under it, from the manifest declaration. */
describe('a row with more declared settings than its slider and chip', () => {
  it('opens a boolean as a switch that writes its legacy key, and rests while the row is off', async () => {
    const id = OFFICIAL_PLUGIN_IDS.geminiInputCollapse;
    sync[StorageKeys.INPUT_COLLAPSE_ENABLED] = true;
    await mount();
    const name = container.querySelector(`[data-row="${id}"] .rn`)!.textContent!;
    expect(more(id)!.getAttribute('aria-label')).toBe(
      en.pluginRowOptionsFor.replace('{name}', name),
    );
    expect(more(id)!.getAttribute('aria-expanded')).toBe('false');
    expect(area(id)).toBeNull();

    await click(more(id));
    expect(more(id)!.getAttribute('aria-expanded')).toBe('true');
    const option = area(id)!.querySelector<HTMLButtonElement>('[role="switch"]')!;
    // The manifest names the extension's own message for it, as the popup row shows it.
    expect(option.getAttribute('aria-label')).toBe(en.allowCollapseWhenNotEmpty);
    expect(option.getAttribute('aria-checked')).toBe('false');

    await click(option);
    expect(sync[StorageKeys.INPUT_COLLAPSE_WHEN_NOT_EMPTY]).toBe(true);
    expect(local[StorageKeys.PLUGINS_STATE]).toBeUndefined();
    expect(option.getAttribute('aria-checked')).toBe('true');
    await writeElsewhere('sync', { [StorageKeys.INPUT_COLLAPSE_WHEN_NOT_EMPTY]: false });
    expect(area(id)!.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('false');

    await click(rowSwitch(id));
    expect(area(id)).toBeNull();
    expect(more(id)!.disabled).toBe(true);
    expect(sync[StorageKeys.INPUT_COLLAPSE_WHEN_NOT_EMPTY]).toBe(false);
  });

  it('opens a second number as its own slider beside the row slider', async () => {
    const id = OFFICIAL_PLUGIN_IDS.geminiChatLineHeight;
    sync[StorageKeys.CHAT_LINE_HEIGHT_ENABLED] = true;
    sync[StorageKeys.CHAT_PARAGRAPH_SPACING] = 14;
    await mount();
    expect(container.querySelectorAll(`[data-row="${id}"] input[type="range"]`)).toHaveLength(1);
    await click(more(id));
    const spacing = area(id)!.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(spacing.getAttribute('aria-label')).toBe(en.chatParagraphSpacing);
    expect(spacing.value).toBe('14');
  });

  it('gives a row whose settings all fit inline no options button', async () => {
    sync[StorageKeys.USAGE_STATUS_ENABLED] = true;
    await mount();
    expect(more(OFFICIAL_PLUGIN_IDS.geminiUsageStatus)).toBeNull();
    expect(more(OFFICIAL_PLUGIN_IDS.geminiChatWidth)).toBeNull();
  });
});
