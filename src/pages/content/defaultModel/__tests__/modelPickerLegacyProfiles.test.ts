import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { ModelPicker, type PickerInteraction } from '../modelPicker';
import { DefaultModelPreferences, type DefaultModelSetting } from '../preferences';
import { OCT_2026_MODEL_IDS, encodeJslogMetadata } from './geminiOct2026Menu';
import { PICKER_ALIASES, pickerScene } from './modelPickerProfileFixture';

let retire = () => {};
const interaction = (): PickerInteraction => ({
  isCurrent: () => true,
  shouldYield: () => false,
  stop: vi.fn(),
  failed: vi.fn(),
  resetFailures: vi.fn(),
  focusInput: vi.fn(),
});

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  retire();
  retire = () => {};
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function legacyScene(kind: 'radio' | 'compact') {
  const trigger = document.createElement('button');
  trigger.className = 'input-area-switch-label';
  trigger.dataset.fixtureTrigger = '';
  trigger.textContent = 'Flash';
  const panel = document.createElement(kind === 'compact' ? 'mat-action-list' : 'div');
  panel.className = kind === 'compact' ? 'gds-mode-switch-menu-list' : 'mat-mdc-menu-panel';
  panel.setAttribute('role', kind === 'compact' ? 'group' : 'menu');
  panel.dataset.fixturePane = '';
  const row = (id: string, name: string) => {
    const item = document.createElement('button');
    item.setAttribute('role', 'menuitemradio');
    item.dataset.fixtureRow = '';
    item.dataset.fixtureModel = '';
    if (kind === 'compact') {
      item.setAttribute('jslog', `242569;BardVeMetadataKey:${encodeJslogMetadata([id])}`);
    }
    item.innerHTML = `<div class="title-and-description" data-fixture-title><span class="${kind === 'compact' ? 'gds-title-m' : 'mode-title'}" data-fixture-label>${name}</span></div>`;
    if (kind === 'compact') {
      item.querySelector<HTMLElement>('[data-fixture-label]')!.dataset.fixtureThinkingLabel = '';
    }
    panel.appendChild(item);
    return item;
  };
  const flash = row(OCT_2026_MODEL_IDS.flash, 'Flash');
  const pro = row(OCT_2026_MODEL_IDS.pro, kind === 'compact' ? '专业' : 'Pro');
  const clicked = vi.spyOn(pro, 'click');
  document.body.append(trigger, panel);
  return { trigger, panel, flash, pro, clicked };
}

function nestedScene() {
  const scene = pickerScene();
  scene.rows.low.remove();
  scene.rows.medium.remove();
  scene.rows.high.remove();
  const row = document.createElement('gem-menu-item');
  row.setAttribute('role', 'menuitem');
  row.setAttribute('value', 'thinking_level');
  row.setAttribute('aria-haspopup', 'true');
  row.setAttribute('aria-controls', 'thinking-submenu');
  row.dataset.fixtureThinkingRow = '';
  row.dataset.fixtureRow = '';
  row.innerHTML =
    '<gem-menu-item-content data-fixture-thinking-content><div class="label-container" data-fixture-title><span class="label" data-fixture-label data-fixture-thinking-label>Thinking level</span></div></gem-menu-item-content>';
  scene.rows.menu.appendChild(row);
  const pane = document.createElement('div');
  pane.className = 'cdk-overlay-pane';
  pane.dataset.fixturePane = '';
  pane.innerHTML = '<div id="thinking-submenu" role="menu"></div>';
  const list = pane.firstElementChild!;
  const option = (label: string, selected: boolean) => {
    const item = document.createElement('gem-menu-item');
    item.setAttribute('role', 'menuitem');
    item.dataset.fixtureRow = '';
    item.dataset.fixtureThinkingOption = '';
    if (selected) {
      item.classList.add('selected');
      item.dataset.fixtureSelected = '';
    }
    item.innerHTML = `<div class="label-container" data-fixture-title><span class="label" data-fixture-label data-fixture-thinking-label>${label}</span></div>`;
    list.appendChild(item);
    return item;
  };
  const standard = option('Standard', true);
  const extended = option('Extended', false);
  const clicked = vi.spyOn(extended, 'click');
  document.body.appendChild(pane);
  return { ...scene, thinkingRow: row, pane, standard, extended, clicked };
}

describe('legacy and nested Gemini picker profile parity', () => {
  it.each(['radio', 'compact'] as const)(
    'keeps %s row identities, document order and click target across both profiles',
    async (kind) => {
      const scene = legacyScene(kind);
      const picker = new ModelPicker(new DefaultModelPreferences());
      const bundled = picker.describeMenu(scene.panel);
      const identities = bundled.items.map((item) => picker.describeItem(item, bundled.view));
      const target: DefaultModelSetting =
        kind === 'compact'
          ? { kind: 'id', id: OCT_2026_MODEL_IDS.pro, name: 'Pro' }
          : { kind: 'name', name: 'Pro' };
      expect(await picker.selectModel(target, interaction())).toBe('switched');
      expect(scene.clicked).toHaveBeenCalledTimes(1);
      scene.clicked.mockClear();
      retire = await installGeminiSelectorPatch(PICKER_ALIASES);
      const online = picker.describeMenu(scene.panel);
      expect(online.items).toEqual([scene.flash, scene.pro]);
      expect(online.items.map((item) => picker.describeItem(item, online.view))).toEqual(
        identities,
      );
      expect(await picker.selectModel(target, interaction())).toBe('switched');
      expect(scene.clicked).toHaveBeenCalledTimes(1);
    },
  );

  it('follows the native ARIA submenu association and preserves nested thinking order', async () => {
    const scene = nestedScene();
    const picker = new ModelPicker(new DefaultModelPreferences());
    const bundled = picker.describeMenu(scene.pane);
    expect(await picker.selectThinking({ index: 1, label: 'Extended' }, interaction())).toBe(
      'switched',
    );
    expect(scene.clicked).toHaveBeenCalledTimes(1);
    scene.clicked.mockClear();
    retire = await installGeminiSelectorPatch(PICKER_ALIASES);
    const online = picker.describeMenu(scene.pane);
    expect(online.kind).toBe('thinking');
    expect(online.items).toEqual(bundled.items);
    expect(online.items).toEqual([scene.standard, scene.extended]);
    expect(picker.findThinkingLevelSubmenuPane()).toBe(scene.pane);
    expect(await picker.selectThinking({ index: 1, label: 'Extended' }, interaction())).toBe(
      'switched',
    );
    expect(scene.clicked).toHaveBeenCalledTimes(1);
  });

  it('an incomplete thinking alias recovers both rows before interpreting a saved index', async () => {
    const scene = nestedScene();
    scene.extended.id = 'extended-only';
    retire = await installGeminiSelectorPatch({
      ...PICKER_ALIASES,
      'modelPicker.thinkingItems': ['#extended-only'],
    });
    const picker = new ModelPicker(new DefaultModelPreferences());
    expect(await picker.selectThinking({ index: 1, label: 'Extended' }, interaction())).toBe(
      'switched',
    );
    expect(scene.clicked).toHaveBeenCalledTimes(1);
    expect(picker.describeMenu(scene.pane).items).toEqual([scene.standard, scene.extended]);
  });

  it('a remote panel alias cannot relabel a native thinking option as a model', async () => {
    const scene = nestedScene();
    scene.pane.id = 'alias-thinking-pane';
    scene.rows.pane.id = 'alias-model-pane';
    scene.extended.querySelector('[data-fixture-label]')!.textContent = 'Pro';
    retire = await installGeminiSelectorPatch({
      ...PICKER_ALIASES,
      'modelPicker.legacyPanels': ['#alias-thinking-pane'],
      'modelPicker.overlayPane': ['#alias-model-pane'],
      'modelPicker.modelEvidence': ['[data-fixture-label]'],
    });
    const picker = new ModelPicker(new DefaultModelPreferences());
    expect(await picker.selectModel({ kind: 'name', name: 'Pro' }, interaction())).toBe('switched');
    expect(scene.rows.pro.click).toHaveBeenCalledTimes(1);
    expect(scene.clicked).not.toHaveBeenCalled();
  });
});
