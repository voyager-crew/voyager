import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { createToaster } from '@/core/ui/toast/toaster';

import { DefaultStars } from '../defaultStars';
import { ModelPicker, type PickerInteraction } from '../modelPicker';
import { DefaultModelPreferences } from '../preferences';
import { OCT_2026_MODEL_IDS } from './geminiOct2026Menu';
import { pickerScene } from './modelPickerProfileFixture';

// With online fixes off, these flows must behave as they did before the locators moved to data.
const cleanups: Array<() => void> = [];

function interaction() {
  const failed = vi.fn<() => void>();
  const pick: PickerInteraction = {
    isCurrent: () => true,
    shouldYield: () => false,
    stop: vi.fn(),
    failed,
    resetFailures: vi.fn(),
    focusInput: vi.fn(),
  };
  return { ...pick, failed };
}

/** Gemini re-renders the picker button when its menu opens; the old node leaves the page. */
function repaintTriggerOnOpen(scene: ReturnType<typeof pickerScene>): void {
  scene.trigger.click.mockImplementation(() => {
    scene.trigger.replaceWith(scene.trigger.cloneNode(true));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  history.replaceState({}, '', '/u/2/app');
  vi.mocked(chrome.storage.sync.set).mockClear();
  vi.mocked(chrome.storage.sync.set).mockImplementation(
    (_items: Record<string, unknown>, callback?: () => void) => {
      callback?.();
      return Promise.resolve();
    },
  );
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('packaged model picker with online fixes off', () => {
  it('switches the model when Gemini repaints the picker button while its menu opens', async () => {
    const scene = pickerScene();
    repaintTriggerOnOpen(scene);
    const picker = new ModelPicker(new DefaultModelPreferences());
    const pick = interaction();

    const result = picker.selectModel(
      { kind: 'id', id: OCT_2026_MODEL_IDS.pro, name: '3.1 Pro' },
      pick,
    );
    await vi.advanceTimersByTimeAsync(1600);

    expect(await result).toBe('switched');
    expect(scene.rows.pro.click).toHaveBeenCalledTimes(1);
    expect(pick.failed).not.toHaveBeenCalled();
  });

  it('sets the thinking level when Gemini repaints the picker button while its menu opens', async () => {
    const scene = pickerScene();
    repaintTriggerOnOpen(scene);
    const picker = new ModelPicker(new DefaultModelPreferences());
    const pick = interaction();

    const result = picker.selectThinking({ index: 2, label: 'High', mode: 'extended' }, pick);
    await vi.advanceTimersByTimeAsync(1600);

    expect(await result).toBe('switched');
    expect(scene.rows.high.click).toHaveBeenCalledTimes(1);
    expect(pick.failed).not.toHaveBeenCalled();
  });

  it('saves the clicked model star while another mode menu is listed first on the page', async () => {
    const other = document.createElement('mat-action-list');
    other.className = 'gds-mode-switch-menu-list';
    document.body.appendChild(other);
    const scene = pickerScene();
    scene.rows.popover.remove();
    const preferences = new DefaultModelPreferences();
    const toaster = createToaster();
    const stars = new DefaultStars(preferences, new ModelPicker(preferences), toaster);
    cleanups.push(() => {
      stars.stop();
      toaster.destroy();
    });
    stars.start();
    scene.host.appendChild(scene.rows.popover);
    await vi.advanceTimersByTimeAsync(500);

    scene.rows.pro.querySelector<HTMLButtonElement>('.gv-default-star-btn')!.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(
      vi.mocked(chrome.storage.sync.set).mock.calls.map(([value]) => JSON.stringify(value)),
    ).toContain(
      JSON.stringify({
        [StorageKeys.DEFAULT_MODEL]: { id: OCT_2026_MODEL_IDS.pro, name: '3.1 Pro' },
      }),
    );
  });
});
