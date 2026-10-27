import {
  getBundledGeminiSelectorView,
  resolveGeminiSelectorOperationInView,
  type GeminiSelectorView,
} from '@/core/gemini/selectors';

import { ModelPickerDom } from './modelPickerDom';
import { hasRemotePickerProfile } from './modelPickerSelectors';
import type { DefaultModelSetting } from './preferences';

/** One pure operation selects its complete view before any event or preference write. */
export function readModelPicker<T>(
  view: GeminiSelectorView,
  read: (dom: ModelPickerDom) => T,
  usable: (value: T) => boolean,
) {
  return resolveGeminiSelectorOperationInView(
    hasRemotePickerProfile(view) ? view : getBundledGeminiSelectorView(),
    (current) => read(new ModelPickerDom(current)),
    usable,
  );
}

export function readModelChoice(
  view: GeminiSelectorView,
  trigger: HTMLElement,
  target: DefaultModelSetting,
) {
  return readModelPicker(
    view,
    (dom) => {
      if (dom.remote && dom.findSelectorButton() !== trigger) return null;
      const panel = dom.getModeSwitchMenuPanel();
      if (!panel) return null;
      const menu = dom.describeMenu(panel);
      const item = dom.findTargetModel(panel, target);
      if (dom.remote && (menu.kind !== 'model' || !item || !menu.items.includes(item))) {
        return null;
      }
      return {
        panel,
        item,
        description: item ? dom.describeItem(item) : null,
        selected: item ? dom.isModelItemSelected(item) : false,
        view: dom.view,
      };
    },
    (choice) => Boolean(choice?.item),
  );
}

export function readThinkingChoice(view: GeminiSelectorView, trigger: HTMLElement) {
  return readModelPicker(
    view,
    (dom) => {
      if (dom.remote && dom.findSelectorButton() !== trigger) return null;
      const panel = dom.getModeSwitchMenuPanel();
      if (!panel) return null;
      const menu = dom.describeMenu(panel);
      if (dom.remote && menu.kind !== 'model') return null;
      const items = dom.findInlineThinkingItems(panel);
      const row = dom.findThinkingLevelTriggerRow();
      if (dom.remote && row && !panel.contains(row)) return null;
      return {
        panel,
        items,
        labels: items.map((item) => dom.getThinkingLevelLabel(item)),
        selected: items.map((item) => dom.isThinkingItemSelected(item)),
        row,
        content: row ? dom.thinkingContent(row) : null,
        view: dom.view,
      };
    },
    (choice) => Boolean(choice && (choice.items.length || choice.row)),
  );
}

export function readNestedThinkingChoice(
  view: GeminiSelectorView,
  trigger: HTMLElement,
  row: HTMLElement,
) {
  return readModelPicker(
    view,
    (dom) => {
      // An online read must reach the menu this pick opened; the packaged read keeps its own.
      if (
        dom.remote &&
        (dom.findSelectorButton() !== trigger || dom.findThinkingLevelTriggerRow() !== row)
      ) {
        return null;
      }
      const panel = dom.getModeSwitchMenuPanel();
      if (!panel) return null;
      dom.describeMenu(panel);
      const pane = dom.findThinkingLevelSubmenuPane();
      const items = dom.getThinkingLevelItems();
      if (!pane) return null;
      return {
        pane,
        items,
        labels: items.map((item) => dom.getThinkingLevelLabel(item)),
        selected: items.map((item) => dom.isNestedThinkingItemSelected(item)),
        view: dom.view,
      };
    },
    (choice) => Boolean(choice?.items.length),
  );
}
