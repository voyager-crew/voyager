// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://gemini.google.com/app" }
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { ModelPicker, type PickerInteraction } from '../modelPicker';
import { DefaultModelPreferences, type DefaultModelSetting } from '../preferences';
import { OCT_2026_MODEL_IDS } from './geminiOct2026Menu';
import { pickerScene } from './modelPickerProfileFixture';

const PRO: DefaultModelSetting = { kind: 'id', id: OCT_2026_MODEL_IDS.pro, name: '3.1 Pro' };
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
  vi.useFakeTimers();
  document.body.replaceChildren();
});
afterEach(() => {
  retire();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each([
  'role="dialog"',
  'role="alertdialog"',
  'inert',
  'contenteditable="plaintext-only"',
  'class="gv-preview"',
  'data-gv-component="preview"',
  'data-message-author-role="assistant"',
  'class="edit-container"',
])('a trigger repair inside %s cannot receive a model-switch click', async (owner) => {
  const scene = pickerScene();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `<section ${owner}><button class="renamed-trigger" aria-controls="ng-menu-oct2026-1">Flash</button></section>`;
  document.body.append(wrapper);
  const wrong = wrapper.querySelector('button')!;
  const wrongClick = vi.spyOn(wrong, 'click');
  retire = await installGeminiSelectorPatch({ 'modelPicker.trigger': ['.renamed-trigger'] });
  const picker = new ModelPicker(new DefaultModelPreferences());
  expect(await picker.selectModel(PRO, interaction())).toBe('switched');
  expect(scene.trigger.click).toHaveBeenCalledTimes(1);
  expect(scene.rows.pro.click).toHaveBeenCalledTimes(1);
  expect(wrongClick).not.toHaveBeenCalled();

  // The same independently associated control can repair the native trigger after relocation.
  document.body.append(wrong);
  scene.trigger.remove();
  expect(await picker.selectModel(PRO, interaction())).toBe('switched');
  expect(wrongClick).toHaveBeenCalledTimes(1);
  expect(scene.rows.pro.click).toHaveBeenCalledTimes(2);
});

it.each(['role="dialog"', 'data-gv-layer="preview"'])(
  'a menu repair inside %s cannot supply a model choice',
  async (owner) => {
    const scene = pickerScene();
    scene.rows.pane.className = 'renamed-pane';
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `<section ${owner}></section>`;
    document.body.append(wrapper);
    wrapper.firstElementChild!.append(scene.rows.pane);
    retire = await installGeminiSelectorPatch({
      'modelPicker.legacyPanels': ['.renamed-pane'],
      'modelPicker.panelFallback': ['.renamed-pane'],
      'modelPicker.overlayPane': ['.renamed-pane'],
      'modelPicker.container': ['.renamed-pane'],
    });
    const picker = new ModelPicker(new DefaultModelPreferences());
    const rejected = picker.selectModel(PRO, interaction());
    await vi.advanceTimersByTimeAsync(1600);
    expect(await rejected).toBe('failed');
    expect(scene.rows.pro.click).not.toHaveBeenCalled();

    document.body.append(scene.rows.pane);
    expect(await picker.selectModel(PRO, interaction())).toBe('switched');
    expect(scene.rows.pro.click).toHaveBeenCalledTimes(1);
  },
);

it('a renamed thinking hover target cannot dispatch input events into a Voyager preview', async () => {
  document.body.innerHTML =
    '<button data-test-id="bard-mode-menu-button">Pro</button><div class="mat-mdc-menu-panel gds-mode-switch-menu cdk-overlay-pane" role="menu"><button role="menuitemradio" data-mode-id="pro-id"><span class="mode-title">Pro</span></button><button role="menuitem" value="thinking_level" aria-controls="levels"><div class="renamed-content">Thinking level</div><div class="gv-preview">Preview</div></button></div><div class="cdk-overlay-pane"><div id="levels" role="menu"><gem-menu-item role="menuitem" class="selected"><span class="label">Standard</span></gem-menu-item><gem-menu-item role="menuitem" id="extended"><span class="label">Extended</span></gem-menu-item></div></div>';
  const preview = document.querySelector('.gv-preview')!;
  const native = document.querySelector('.renamed-content')!;
  const previewHover = vi.fn(),
    nativeHover = vi.fn();
  preview.addEventListener('mouseover', previewHover);
  native.addEventListener('mouseover', nativeHover);
  const select = vi.spyOn(document.getElementById('extended')!, 'click');
  const picker = new ModelPicker(new DefaultModelPreferences());
  retire = await installGeminiSelectorPatch({ 'modelPicker.thinkingContent': ['.gv-preview'] });
  expect(await picker.selectThinking({ index: 1, label: 'Extended' }, interaction())).toBe(
    'switched',
  );
  expect(previewHover).not.toHaveBeenCalled();
  expect(select).toHaveBeenCalledTimes(1);
  retire();
  retire = await installGeminiSelectorPatch({
    'modelPicker.thinkingContent': ['.renamed-content'],
  });
  expect(await picker.selectThinking({ index: 1, label: 'Extended' }, interaction())).toBe(
    'switched',
  );
  expect(nativeHover).toHaveBeenCalledTimes(1);
  expect(select).toHaveBeenCalledTimes(2);
});
