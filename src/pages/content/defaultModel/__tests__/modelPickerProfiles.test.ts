import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { ModelPicker, type PickerInteraction } from '../modelPicker';
import { findModelFocusInput } from '../modelPickerSelectors';
import { DefaultModelPreferences, type DefaultModelSetting } from '../preferences';
import { OCT_2026_MODEL_IDS } from './geminiOct2026Menu';
import { PICKER_ALIASES, pickerScene } from './modelPickerProfileFixture';

const PRO: DefaultModelSetting = { kind: 'id', id: OCT_2026_MODEL_IDS.pro, name: '3.1 Pro' };
let retire = () => {};

function interaction(isCurrent: () => boolean = () => true): PickerInteraction {
  return {
    isCurrent,
    shouldYield: () => false,
    stop: vi.fn(),
    failed: vi.fn(),
    resetFailures: vi.fn(),
    focusInput: vi.fn(),
  };
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
  retire();
  retire = () => {};
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('model picker online locator behavior', () => {
  it('reads the same nodes, row order, IDs, labels and thinking rows through both profiles', async () => {
    const scene = pickerScene();
    const picker = new ModelPicker(new DefaultModelPreferences());
    const bundled = picker.describeMenu(scene.rows.pane);
    const bundledItems = bundled.items.map((item) => picker.describeItem(item, bundled.view));
    retire = await installGeminiSelectorPatch(PICKER_ALIASES);
    const online = picker.describeMenu(scene.rows.pane);
    expect(online.items).toEqual(bundled.items);
    online.items.forEach((item, index) => expect(item).toBe(bundled.items[index]));
    expect(online.inlineThinking).toEqual([scene.rows.low, scene.rows.medium, scene.rows.high]);
    expect(online.items.map((item) => picker.describeItem(item, online.view))).toEqual(
      bundledItems,
    );
    expect(picker.resolveAddedMenu(scene.rows.popover)).toBe(scene.rows.pane);
    expect(picker.getModeSwitchMenuPanel()).toBe(scene.rows.pane);
    expect(picker.readTriggerPillLines()).toEqual(['Flash']);
  });

  it('chooses the same model and Medium row with exactly one click through either profile', async () => {
    const scene = pickerScene();
    const picker = new ModelPicker(new DefaultModelPreferences());
    expect(await picker.selectModel(PRO, interaction())).toBe('switched');
    expect(await picker.selectThinking({ index: 1, label: 'Medium' }, interaction())).toBe(
      'switched',
    );
    expect(scene.rows.pro.click).toHaveBeenCalledTimes(1);
    expect(scene.rows.medium.click).toHaveBeenCalledTimes(1);
    scene.rows.pro.click.mockClear();
    scene.rows.medium.click.mockClear();
    scene.trigger.click.mockClear();
    retire = await installGeminiSelectorPatch(PICKER_ALIASES);
    expect(await picker.selectModel(PRO, interaction())).toBe('switched');
    expect(await picker.selectThinking({ index: 1, label: 'Medium' }, interaction())).toBe(
      'switched',
    );
    expect(scene.rows.pro.click).toHaveBeenCalledTimes(1);
    expect(scene.rows.medium.click).toHaveBeenCalledTimes(1);
    expect(scene.trigger.click).toHaveBeenCalledTimes(2);
    expect(scene.rows.flash.click).not.toHaveBeenCalled();
    expect(scene.rows.low.click).not.toHaveBeenCalled();
  });

  it('a remote delete-button match recovers the real picker and chooses the requested model', async () => {
    const scene = pickerScene();
    const deleteButton = document.createElement('button');
    deleteButton.id = 'delete-conversation';
    deleteButton.textContent = 'Delete';
    const deleteClick = vi.spyOn(deleteButton, 'click');
    document.body.prepend(deleteButton);
    retire = await installGeminiSelectorPatch({
      ...PICKER_ALIASES,
      'modelPicker.trigger': ['#delete-conversation'],
    });
    const picker = new ModelPicker(new DefaultModelPreferences());
    expect(await picker.selectModel(PRO, interaction())).toBe('switched');
    expect(scene.trigger.click).toHaveBeenCalledTimes(1);
    expect(scene.rows.pro.click).toHaveBeenCalledTimes(1);
    expect(deleteClick).not.toHaveBeenCalled();
  });

  it('an unrelated table menu recovers the complete native menu instead of borrowing its rows', async () => {
    const scene = pickerScene();
    const table = document.createElement('div');
    table.id = 'table-menu';
    table.className = 'mat-mdc-menu-panel';
    table.setAttribute('role', 'menu');
    table.innerHTML = '<button role="menuitem"><span class="label">Delete table</span></button>';
    document.body.prepend(table);
    retire = await installGeminiSelectorPatch({
      ...PICKER_ALIASES,
      'modelPicker.legacyPanels': ['#table-menu'],
    });
    const picker = new ModelPicker(new DefaultModelPreferences());
    expect(picker.getModeSwitchMenuPanel()).toBe(scene.rows.pane);
    expect(await picker.selectModel(PRO, interaction())).toBe('switched');
    expect(scene.rows.pro.click).toHaveBeenCalledTimes(1);
    expect(picker.describeMenu(scene.rows.pane).items).toEqual(scene.items);
  });

  it('a generic radio menu labelled Pro cannot steal a name-only model click', async () => {
    const scene = pickerScene();
    scene.trigger.removeAttribute('aria-controls');
    const table = document.createElement('div');
    table.id = 'pretend-model-menu';
    table.className = 'mat-mdc-menu-panel';
    table.setAttribute('role', 'menu');
    table.innerHTML = '<button role="menuitemradio"><span class="label">Pro</span></button>';
    const wrong = vi.spyOn(table.querySelector('button')!, 'click');
    document.body.prepend(table);
    retire = await installGeminiSelectorPatch({
      'modelPicker.legacyPanels': ['#pretend-model-menu'],
      'modelPicker.modelEvidence': ['.label'],
      'modelPicker.modelLabel': ['.label'],
    });
    const picker = new ModelPicker(new DefaultModelPreferences());
    expect(await picker.selectModel({ kind: 'name', name: 'Pro' }, interaction())).toBe('switched');
    expect(scene.rows.pro.click).toHaveBeenCalledTimes(1);
    expect(wrong).not.toHaveBeenCalled();
  });

  it('a body-wide panel alias cannot borrow an identically named model outside the controlled menu', async () => {
    const scene = pickerScene();
    const decoy = document.createElement('button');
    decoy.setAttribute('role', 'menuitem');
    decoy.setAttribute('data-mode-id', OCT_2026_MODEL_IDS.pro);
    decoy.innerHTML = '<span class="label">3.1 Pro</span>';
    const wrong = vi.spyOn(decoy, 'click');
    document.body.prepend(decoy);
    retire = await installGeminiSelectorPatch({ 'modelPicker.legacyPanels': ['body'] });
    const picker = new ModelPicker(new DefaultModelPreferences());
    expect(await picker.selectModel(PRO, interaction())).toBe('switched');
    expect(scene.rows.pro.click).toHaveBeenCalledTimes(1);
    expect(wrong).not.toHaveBeenCalled();
  });

  it('a partial controlled-menu wrapper cannot turn High into the only thinking option', async () => {
    const scene = pickerScene();
    const partial = document.createElement('section');
    partial.id = 'partial-picker';
    partial.append(scene.rows.pro, scene.rows.high);
    scene.rows.menu.appendChild(partial);
    retire = await installGeminiSelectorPatch({ 'modelPicker.legacyPanels': ['#partial-picker'] });
    const picker = new ModelPicker(new DefaultModelPreferences());
    expect(await picker.selectThinking({ index: 1, label: 'Medium' }, interaction())).toBe(
      'switched',
    );
    expect(scene.rows.medium.click).toHaveBeenCalledTimes(1);
    expect(scene.rows.high.click).not.toHaveBeenCalled();
  });

  it('a partial remote row list rereads all rows and preserves thinking indices', async () => {
    const scene = pickerScene();
    scene.rows.high.id = 'only-high';
    retire = await installGeminiSelectorPatch({
      ...PICKER_ALIASES,
      'modelPicker.items': ['#only-high'],
    });
    const picker = new ModelPicker(new DefaultModelPreferences());
    expect(picker.describeMenu(scene.rows.pane).items).toEqual(scene.items);
    expect(await picker.selectThinking({ index: 1, label: 'Medium' }, interaction())).toBe(
      'switched',
    );
    expect(scene.rows.medium.click).toHaveBeenCalledTimes(1);
    expect(scene.rows.high.click).not.toHaveBeenCalled();
  });

  it('a selected-state alias cannot treat an unselected model as confirmed', async () => {
    const scene = pickerScene();
    retire = await installGeminiSelectorPatch({
      ...PICKER_ALIASES,
      'modelPicker.selectedModel': ['[data-fixture-row]'],
    });
    const picker = new ModelPicker(new DefaultModelPreferences());
    expect(await picker.selectModel(PRO, interaction())).toBe('switched');
    expect(scene.rows.pro.click).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(chrome.storage.sync.set).mock.calls.map(([value]) => value),
    ).not.toContainEqual(
      expect.objectContaining({ [StorageKeys.DEFAULT_MODEL]: expect.anything() }),
    );
  });

  it('an empty remote model label rereads the bundle and still chooses Pro', async () => {
    const scene = pickerScene();
    retire = await installGeminiSelectorPatch({
      ...PICKER_ALIASES,
      'modelPicker.modelLabel': ['.unpainted-model-title'],
    });
    const picker = new ModelPicker(new DefaultModelPreferences());
    expect(await picker.selectModel(PRO, interaction())).toBe('switched');
    expect(scene.rows.pro.click).toHaveBeenCalledTimes(1);
    expect(picker.describeItem(scene.rows.pro).name).toBe('3.1 Pro');
  });

  it('a renamed model title remains readable through its native ARIA identity', async () => {
    const scene = pickerScene();
    const title = scene.rows.pro.querySelector('[data-fixture-label]')!;
    title.id = 'native-pro-title';
    title.classList.remove('label');
    scene.rows.pro.setAttribute('aria-labelledby', title.id);
    const picker = new ModelPicker(new DefaultModelPreferences());
    expect(picker.describeItem(scene.rows.pro).name).toBe('');
    retire = await installGeminiSelectorPatch({
      'modelPicker.modelLabel': ['[data-fixture-label]'],
    });
    expect(picker.describeItem(scene.rows.pro)).toMatchObject({
      id: OCT_2026_MODEL_IDS.pro,
      name: '3.1 Pro',
    });
    expect(await picker.selectModel(PRO, interaction())).toBe('switched');
    expect(scene.rows.pro.click).toHaveBeenCalledTimes(1);
  });

  it('a misleading remote description cannot replace the stored name of a confirmed model', async () => {
    const scene = pickerScene();
    scene.rows.pro.querySelector('.label')!.classList.remove('label');
    scene.rows.pro.querySelector('.sublabel')!.textContent = 'Flash';
    scene.rows.pro.classList.add('selected');
    scene.rows.flash.classList.remove('selected');
    retire = await installGeminiSelectorPatch({ 'modelPicker.modelLabel': ['.sublabel'] });
    const picker = new ModelPicker(new DefaultModelPreferences());
    expect(await picker.selectModel(PRO, interaction())).toBe('already-selected');
    const target: DefaultModelSetting = {
      kind: 'id',
      id: OCT_2026_MODEL_IDS.flashLite,
      name: '3.5 Flash-Lite',
    };
    expect(await picker.selectModel(target, interaction())).toBe('switched');
    expect(scene.rows.flashLite.click).toHaveBeenCalledTimes(1);
    expect(vi.mocked(chrome.storage.sync.set).mock.calls).toHaveLength(0);
  });

  it('a thinking description cannot impersonate High when the native labels disappear', async () => {
    const scene = pickerScene();
    for (const item of [scene.rows.low, scene.rows.medium, scene.rows.high]) {
      item.querySelector('.label')!.classList.remove('label');
    }
    scene.rows.low.querySelector('.sublabel')!.textContent = 'High';
    retire = await installGeminiSelectorPatch({ 'modelPicker.thinkingLabel': ['.sublabel'] });
    const picker = new ModelPicker(new DefaultModelPreferences());
    expect(
      await picker.selectThinking({ index: 2, label: 'High', mode: 'extended' }, interaction()),
    ).toBe('switched');
    expect(scene.rows.high.click).toHaveBeenCalledTimes(1);
    expect(scene.rows.low.click).not.toHaveBeenCalled();
  });

  it('an SVG title cannot rename Flash to the saved name-only Pro model', async () => {
    const scene = pickerScene();
    scene.rows.flash.innerHTML = '<svg><title>3.1 Pro</title></svg>' + scene.rows.flash.innerHTML;
    retire = await installGeminiSelectorPatch({ 'modelPicker.modelLabel': ['svg title, .label'] });
    const picker = new ModelPicker(new DefaultModelPreferences());
    expect(await picker.selectModel({ kind: 'name', name: '3.1 Pro' }, interaction())).toBe(
      'switched',
    );
    expect(scene.rows.pro.click).toHaveBeenCalledTimes(1);
    expect(scene.rows.flash.click).not.toHaveBeenCalled();
    const writes = vi
      .mocked(chrome.storage.sync.set)
      .mock.calls.map(([value]) => JSON.stringify(value));
    expect(writes.some((bytes) => bytes.includes(OCT_2026_MODEL_IDS.flash))).toBe(false);
  });

  it('a confirmed model rename writes the same stable ID and learned pill bytes through both profiles', async () => {
    const scene = pickerScene();
    const target: DefaultModelSetting = {
      kind: 'id',
      id: OCT_2026_MODEL_IDS.flash,
      name: '3.7 Flash',
    };
    const picker = new ModelPicker(new DefaultModelPreferences());
    expect(await picker.selectModel(target, interaction())).toBe('already-selected');
    const bytes = vi
      .mocked(chrome.storage.sync.set)
      .mock.calls.map(([value]) => JSON.stringify(value));
    expect(bytes).toEqual([
      JSON.stringify({
        [StorageKeys.DEFAULT_MODEL]: {
          id: OCT_2026_MODEL_IDS.flash,
          name: '3.8 Flash',
          pill: 'Flash',
        },
      }),
    ]);
    vi.mocked(chrome.storage.sync.set).mockClear();
    retire = await installGeminiSelectorPatch(PICKER_ALIASES);
    expect(await picker.selectModel(target, interaction())).toBe('already-selected');
    expect(
      vi.mocked(chrome.storage.sync.set).mock.calls.map(([value]) => JSON.stringify(value)),
    ).toEqual(bytes);
    expect(scene.rows.flash.click).not.toHaveBeenCalled();
  });

  it('a retired menu wait leaves the next session able to choose its own model', async () => {
    const scene = pickerScene();
    scene.rows.popover.remove();
    retire = await installGeminiSelectorPatch(PICKER_ALIASES);
    const picker = new ModelPicker(new DefaultModelPreferences());
    let current = true;
    const first = picker.selectModel(
      PRO,
      interaction(() => current),
    );
    current = false;
    await vi.advanceTimersByTimeAsync(50);
    expect(await first).toBe('cancelled');
    scene.host.appendChild(scene.rows.popover);
    expect(await picker.selectModel(PRO, interaction())).toBe('switched');
    expect(scene.rows.pro.click).toHaveBeenCalledTimes(1);
  });

  it('a thinking row selected while the menu await resumes stays selected and another row remains selectable', async () => {
    const scene = pickerScene();
    scene.trigger.click.mockImplementation(() => {
      void Promise.resolve().then(() => {
        scene.rows.high.classList.add('selected');
        scene.rows.high.dataset.fixtureSelected = '';
      });
    });
    retire = await installGeminiSelectorPatch(PICKER_ALIASES);
    const picker = new ModelPicker(new DefaultModelPreferences());
    expect(await picker.selectThinking({ index: 2, label: 'High' }, interaction())).toBe(
      'unchanged',
    );
    expect(await picker.selectThinking({ index: 1, label: 'Medium' }, interaction())).toBe(
      'switched',
    );
    expect(scene.rows.medium.click).toHaveBeenCalledTimes(1);
    expect(scene.rows.high.click).not.toHaveBeenCalled();
  });

  it('a model selected while the menu await resumes is confirmed before another model is picked', async () => {
    const scene = pickerScene();
    scene.trigger.click.mockImplementation(() => {
      void Promise.resolve().then(() => {
        scene.rows.pro.classList.add('selected');
        scene.rows.pro.dataset.fixtureSelected = '';
      });
    });
    retire = await installGeminiSelectorPatch(PICKER_ALIASES);
    const picker = new ModelPicker(new DefaultModelPreferences());
    expect(await picker.selectModel(PRO, interaction())).toBe('already-selected');
    expect(
      await picker.selectModel(
        { kind: 'id', id: OCT_2026_MODEL_IDS.flashLite, name: '3.5 Flash-Lite' },
        interaction(),
      ),
    ).toBe('switched');
    expect(scene.rows.flashLite.click).toHaveBeenCalledTimes(1);
    expect(scene.rows.pro.click).not.toHaveBeenCalled();
  });

  it('a focus alias matching a menu button recovers the editable composer', async () => {
    const scene = pickerScene();
    const main = document.createElement('main');
    main.innerHTML = '<textarea data-fixture-composer></textarea>';
    document.body.appendChild(main);
    const composer = main.querySelector('textarea');
    expect(findModelFocusInput()).toBe(composer);
    retire = await installGeminiSelectorPatch({
      'modelPicker.focusInput': ['[data-fixture-trigger]'],
    });
    expect(findModelFocusInput()).toBe(composer);
    expect(scene.trigger).not.toBe(composer);
  });

  it('a focus alias matching an inline editor preserves the preferred chat composer', async () => {
    pickerScene();
    const main = document.createElement('main');
    main.innerHTML = `
      <div contenteditable="true" data-inline-editor>Editing an earlier message</div>
      <rich-textarea><div contenteditable="true" data-chat-composer></div></rich-textarea>
    `;
    document.body.appendChild(main);
    const composer = main.querySelector('[data-chat-composer]');
    expect(findModelFocusInput()).toBe(composer);
    retire = await installGeminiSelectorPatch({
      'modelPicker.focusInput': ['[data-inline-editor]'],
    });
    expect(findModelFocusInput()).toBe(composer);
  });
});
