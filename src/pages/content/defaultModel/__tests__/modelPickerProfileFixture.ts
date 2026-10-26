import type { GeminiSelectorFile } from '@/core/gemini/selectors';

import { buildOct2026Menu, buildOct2026Trigger } from './geminiOct2026Menu';

/** Different locator spellings over the same native nodes, including document-order rows. */
export const PICKER_ALIASES: GeminiSelectorFile['selectors'] = {
  'modelPicker.trigger': ['[data-fixture-trigger]'],
  'modelPicker.legacyPanels': ['[data-fixture-pane]'],
  'modelPicker.panelFallback': ['[data-fixture-pane]'],
  'modelPicker.overlayPane': ['[data-fixture-pane]'],
  'modelPicker.container': ['[data-fixture-pane]'],
  'modelPicker.observerRoot': ['[data-fixture-root], [data-fixture-pane], [data-fixture-row]'],
  'modelPicker.items': ['[data-fixture-row]'],
  'modelPicker.modelEvidence': ['[data-fixture-model]'],
  'modelPicker.modelIdItem': ['[data-fixture-model]'],
  'modelPicker.modelLabel': ['[data-fixture-label]'],
  'modelPicker.thinkingLabel': ['[data-fixture-thinking-label]'],
  'modelPicker.thinkingRow': ['[data-fixture-thinking-row]'],
  'modelPicker.thinkingItems': ['[data-fixture-thinking-option]'],
  'modelPicker.thinkingContent': ['[data-fixture-thinking-content]'],
  'modelPicker.modelTitleContainer': ['[data-fixture-title]'],
  'modelPicker.thinkingTitleContainer': ['[data-fixture-title]'],
  'modelPicker.focusInput': ['[data-fixture-composer]'],
};

export function pickerScene() {
  const { trigger, pillContainer } = buildOct2026Trigger('Flash');
  trigger.dataset.fixtureTrigger = '';
  const rows = buildOct2026Menu(pillContainer);
  rows.popover.dataset.fixtureRoot = '';
  rows.pane.dataset.fixturePane = '';
  const items = [rows.flashLite, rows.flash, rows.pro, rows.low, rows.medium, rows.high];
  for (const item of items) {
    item.dataset.fixtureRow = '';
    if (item.hasAttribute('data-mode-id')) item.dataset.fixtureModel = '';
    else item.dataset.fixtureThinkingOption = '';
    item.querySelector<HTMLElement>('.label')!.dataset.fixtureLabel = '';
    item.querySelector<HTMLElement>('.label')!.dataset.fixtureThinkingLabel = '';
    item.querySelector<HTMLElement>('.label-container')!.dataset.fixtureTitle = '';
  }
  return { trigger, host: pillContainer, rows, items };
}
