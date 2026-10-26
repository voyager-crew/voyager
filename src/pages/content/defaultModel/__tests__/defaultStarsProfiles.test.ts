import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { createToaster } from '@/core/ui/toast/toaster';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { DefaultStars } from '../defaultStars';
import { ModelPicker } from '../modelPicker';
import { DefaultModelPreferences } from '../preferences';
import { OCT_2026_MODEL_IDS } from './geminiOct2026Menu';
import { PICKER_ALIASES, pickerScene } from './modelPickerProfileFixture';

let retire = () => {};
const cleanups: Array<() => void> = [];

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
  retire();
  retire = () => {};
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function mountStars(scene: ReturnType<typeof pickerScene>) {
  const preferences = new DefaultModelPreferences();
  const toaster = createToaster();
  const stars = new DefaultStars(preferences, new ModelPicker(preferences), toaster);
  const stop = () => {
    stars.stop();
    toaster.destroy();
  };
  cleanups.push(stop);
  scene.rows.popover.remove();
  stars.start();
  scene.host.appendChild(scene.rows.popover);
  await vi.advanceTimersByTimeAsync(500);
  return stop;
}

function star(row: HTMLElement): HTMLButtonElement {
  const button = row.querySelector<HTMLButtonElement>('.gv-default-star-btn');
  expect(button).not.toBeNull();
  return button!;
}

function preferenceBytes(): string[] {
  return vi
    .mocked(chrome.storage.sync.set)
    .mock.calls.map(([value]) => value)
    .filter(
      (value) => StorageKeys.DEFAULT_MODEL in value || StorageKeys.DEFAULT_THINKING_LEVEL in value,
    )
    .map((value) => JSON.stringify(value));
}

describe('default-model stars through online locator profiles', () => {
  it('preserves star owners and exact stored model and thinking bytes across both profiles', async () => {
    const scene = pickerScene();
    const stop = await mountStars(scene);
    const owners = scene.items.map((item) => star(item).dataset.gvDefaultKind);
    star(scene.rows.pro).click();
    star(scene.rows.high).click();
    await vi.advanceTimersByTimeAsync(0);
    const bundled = preferenceBytes();
    expect(bundled).toEqual([
      JSON.stringify({
        [StorageKeys.DEFAULT_MODEL]: { id: OCT_2026_MODEL_IDS.pro, name: '3.1 Pro' },
      }),
      JSON.stringify({
        [StorageKeys.DEFAULT_THINKING_LEVEL]: { index: 2, label: 'High', mode: 'extended' },
      }),
    ]);
    stop();
    vi.mocked(chrome.storage.sync.set).mockClear();
    retire = await installGeminiSelectorPatch(PICKER_ALIASES);
    await mountStars(scene);
    expect(scene.items.map((item) => star(item).dataset.gvDefaultKind)).toEqual(owners);
    star(scene.rows.pro).click();
    star(scene.rows.high).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(preferenceBytes()).toEqual(bundled);
  });

  it('a remote description-as-title match recovers the native label before saving a default', async () => {
    const scene = pickerScene();
    retire = await installGeminiSelectorPatch({
      ...PICKER_ALIASES,
      'modelPicker.modelLabel': ['.sublabel'],
    });
    await mountStars(scene);
    star(scene.rows.pro).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(preferenceBytes()).toEqual([
      JSON.stringify({
        [StorageKeys.DEFAULT_MODEL]: { id: OCT_2026_MODEL_IDS.pro, name: '3.1 Pro' },
      }),
    ]);
  });

  it('an equally labelled nested button cannot become the star anchor for the outer model', async () => {
    const scene = pickerScene();
    const nested = document.createElement('button');
    nested.innerHTML = '<span class="foreign-label">3.1 Pro</span>';
    scene.rows.pro.prepend(nested);
    retire = await installGeminiSelectorPatch({
      ...PICKER_ALIASES,
      'modelPicker.modelLabel': ['.foreign-label, [data-fixture-label]'],
    });
    await mountStars(scene);
    const button = star(scene.rows.pro);
    expect(nested.contains(button)).toBe(false);
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(preferenceBytes()).toEqual([
      JSON.stringify({
        [StorageKeys.DEFAULT_MODEL]: { id: OCT_2026_MODEL_IDS.pro, name: '3.1 Pro' },
      }),
    ]);
  });

  it('an existing wrapper inside another button cannot receive the model star', async () => {
    const scene = pickerScene();
    const nested = document.createElement('button');
    nested.innerHTML = '<div class="gv-title-wrapper">Another control</div>';
    scene.rows.pro.querySelector('.label-container')!.prepend(nested);
    retire = await installGeminiSelectorPatch(PICKER_ALIASES);
    await mountStars(scene);
    const button = star(scene.rows.pro);
    expect(nested.contains(button)).toBe(false);
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(preferenceBytes()).toEqual([
      JSON.stringify({
        [StorageKeys.DEFAULT_MODEL]: { id: OCT_2026_MODEL_IDS.pro, name: '3.1 Pro' },
      }),
    ]);
  });

  it('a star moved to another row cannot change its captured owner and the real row still saves', async () => {
    const scene = pickerScene();
    retire = await installGeminiSelectorPatch(PICKER_ALIASES);
    await mountStars(scene);
    const stale = star(scene.rows.pro);
    const realFlashStar = star(scene.rows.flash);
    scene.rows.flash.appendChild(stale);
    stale.click();
    realFlashStar.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(preferenceBytes()).toEqual([
      JSON.stringify({
        [StorageKeys.DEFAULT_MODEL]: { id: OCT_2026_MODEL_IDS.flash, name: '3.8 Flash' },
      }),
    ]);
  });

  it('a reordered thinking row rejects its old index while a fresh menu saves the new choice', async () => {
    const scene = pickerScene();
    retire = await installGeminiSelectorPatch(PICKER_ALIASES);
    const stop = await mountStars(scene);
    const staleHigh = star(scene.rows.high);
    scene.rows.menu.insertBefore(scene.rows.high, scene.rows.low);
    staleHigh.click();
    stop();
    await mountStars(scene);
    star(scene.rows.medium).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(preferenceBytes()).toEqual([
      JSON.stringify({
        [StorageKeys.DEFAULT_THINKING_LEVEL]: { index: 2, label: 'Medium', mode: 'extended' },
      }),
    ]);
  });
});
