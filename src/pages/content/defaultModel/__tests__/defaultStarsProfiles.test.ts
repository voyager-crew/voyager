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

it('an equally labelled native description cannot replace the original star title', async () => {
  const scene = pickerScene();
  const native = scene.rows.pro.querySelector('.label')!;
  const preview = document.createElement('div');
  preview.className = 'native-preview';
  preview.innerHTML = '<span class="duplicate-label">3.1 Pro</span>';
  scene.rows.pro.querySelector('.label-container')!.prepend(preview);
  retire = await installGeminiSelectorPatch({
    ...PICKER_ALIASES,
    'modelPicker.modelLabel': ['.duplicate-label, [data-fixture-label]'],
  });
  await mountStars(scene);
  const button = star(scene.rows.pro);
  expect(preview.contains(button)).toBe(false);
  expect(native.parentElement!.contains(button)).toBe(true);
  button.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(preferenceBytes()).toEqual([
    JSON.stringify({
      [StorageKeys.DEFAULT_MODEL]: { id: OCT_2026_MODEL_IDS.pro, name: '3.1 Pro' },
    }),
  ]);
});

function renamedProTitle(scene: ReturnType<typeof pickerScene>) {
  const title = scene.rows.pro.querySelector<HTMLElement>('.label')!;
  title.classList.replace('label', 'renamed-label');
  scene.rows.pro.setAttribute('aria-label', '3.1 Pro');
  return title;
}
const RENAMED_LABEL = { 'modelPicker.modelLabel': ['.renamed-label, [data-fixture-label]'] };

it('an independently labelled renamed title keeps its star usable after Voyager wraps it', async () => {
  const scene = pickerScene();
  const title = renamedProTitle(scene);
  retire = await installGeminiSelectorPatch(RENAMED_LABEL);
  await mountStars(scene);
  const button = star(scene.rows.pro);
  expect(title.parentElement!.contains(button)).toBe(true);
  button.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(preferenceBytes()).toEqual([
    JSON.stringify({
      [StorageKeys.DEFAULT_MODEL]: { id: OCT_2026_MODEL_IDS.pro, name: '3.1 Pro' },
    }),
  ]);
  expect(star(scene.rows.pro)).toBe(button);
});

it('an aria-label match cannot make a Voyager preview the renamed native title', async () => {
  const scene = pickerScene();
  const title = renamedProTitle(scene);
  const preview = document.createElement('div');
  preview.className = 'gv-preview';
  preview.innerHTML = '<span class="fake-label">3.1 Pro</span>';
  scene.rows.pro.append(preview);
  retire = await installGeminiSelectorPatch({
    'modelPicker.modelLabel': ['.fake-label, [data-fixture-label]:not(.renamed-label)'],
  });
  const stop = await mountStars(scene);
  expect(scene.rows.pro.querySelector('.gv-default-star-btn')).toBeNull();
  expect(star(scene.rows.flash)).not.toBeNull();
  stop();
  retire();
  retire = await installGeminiSelectorPatch(RENAMED_LABEL);
  await mountStars(scene);
  expect(title.parentElement!.contains(star(scene.rows.pro))).toBe(true);
});

it('a pre-existing title-wrapper class cannot certify a repaired label as native', async () => {
  const scene = pickerScene();
  const title = renamedProTitle(scene);
  const unowned = document.createElement('div');
  unowned.className = 'gv-title-wrapper';
  title.before(unowned);
  unowned.append(title);
  retire = await installGeminiSelectorPatch(RENAMED_LABEL);
  const stop = await mountStars(scene);
  expect(scene.rows.pro.querySelector('.gv-default-star-btn')).toBeNull();
  expect(star(scene.rows.flash)).not.toBeNull();
  stop();
  unowned.replaceWith(title);
  await mountStars(scene);
  expect(star(scene.rows.pro).parentElement).toBe(title.parentElement);
});

it('a stopped star renderer cannot leave its old wrapper trusted by a new renderer', async () => {
  const scene = pickerScene();
  const title = renamedProTitle(scene);
  retire = await installGeminiSelectorPatch(RENAMED_LABEL);
  const stop = await mountStars(scene);
  const wrapper = title.parentElement!;
  expect(wrapper.contains(star(scene.rows.pro))).toBe(true);
  stop();
  title.before(wrapper);
  wrapper.append(title);
  const stopSecond = await mountStars(scene);
  expect(scene.rows.pro.querySelector('.gv-default-star-btn')).toBeNull();
  expect(star(scene.rows.flash)).not.toBeNull();
  stopSecond();
  wrapper.replaceWith(title);
  await mountStars(scene);
  expect(star(scene.rows.pro).parentElement).toBe(title.parentElement);
});

it('a remote label union cannot switch from the native title to Voyager’s new wrapper', async () => {
  const scene = pickerScene();
  renamedProTitle(scene);
  retire = await installGeminiSelectorPatch({
    'modelPicker.modelLabel': [
      '.renamed-label, .gv-title-wrapper:has(.renamed-label), [data-fixture-label]',
    ],
  });
  const stop = await mountStars(scene);
  star(scene.rows.pro).click();
  await vi.advanceTimersByTimeAsync(0);
  expect(preferenceBytes()).toEqual([]);
  stop();
  retire();
  retire = await installGeminiSelectorPatch(RENAMED_LABEL);
  await mountStars(scene);
  star(scene.rows.pro).click();
  await vi.advanceTimersByTimeAsync(0);
  expect(preferenceBytes()).toEqual([
    JSON.stringify({
      [StorageKeys.DEFAULT_MODEL]: { id: OCT_2026_MODEL_IDS.pro, name: '3.1 Pro' },
    }),
  ]);
});

it('a bundled fallback does not certify a pre-existing wrapper for a later remote-only label', async () => {
  const scene = pickerScene();
  const title = scene.rows.pro.querySelector<HTMLElement>('.label')!;
  scene.rows.pro.setAttribute('aria-label', '3.1 Pro');
  const wrapper = document.createElement('div');
  wrapper.className = 'gv-title-wrapper';
  title.before(wrapper);
  wrapper.append(title);
  retire = await installGeminiSelectorPatch(RENAMED_LABEL);
  const stop = await mountStars(scene);
  const button = star(scene.rows.pro);
  expect(wrapper.contains(button)).toBe(true);
  title.classList.replace('label', 'renamed-label');
  button.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(preferenceBytes()).toEqual([]);
  stop();
  await mountStars(scene);
  star(scene.rows.pro).click();
  await vi.advanceTimersByTimeAsync(0);
  expect(preferenceBytes()).toEqual([
    JSON.stringify({
      [StorageKeys.DEFAULT_MODEL]: { id: OCT_2026_MODEL_IDS.pro, name: '3.1 Pro' },
    }),
  ]);
});

it('a repaired star container cannot move a description when the row name still reads correctly', async () => {
  const scene = pickerScene();
  const native = scene.rows.pro.querySelector<HTMLElement>('.label')!;
  const preview = document.createElement('div');
  preview.className = 'description-container';
  preview.innerHTML = '<span class="duplicate-title">3.1 Pro</span>';
  const duplicate = preview.firstElementChild!;
  scene.rows.pro.append(preview);
  retire = await installGeminiSelectorPatch({
    'modelPicker.modelTitleContainer': ['.description-container'],
    'modelPicker.modelLabel': ['[data-fixture-label], .duplicate-title'],
  });
  await mountStars(scene);
  const button = star(scene.rows.pro);
  expect(duplicate.parentElement).toBe(preview);
  expect(button.parentElement).toBe(native.parentElement);
  button.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(preferenceBytes()).toEqual([
    JSON.stringify({
      [StorageKeys.DEFAULT_MODEL]: { id: OCT_2026_MODEL_IDS.pro, name: '3.1 Pro' },
    }),
  ]);
});
