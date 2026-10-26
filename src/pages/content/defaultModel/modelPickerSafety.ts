import { getBundledGeminiSelectorView, type GeminiSelectorView } from '@/core/gemini/selectors';

import {
  hasNativeItemRole,
  isInlineThinkingItem,
  isNestedThinkingItem,
  readModelId,
} from './modelPickerMetadata';
import { pickerSelector } from './modelPickerSelectors';

/** These are identity/ownership checks, never remotely supplied click instructions. */
export function isSafePickerTrigger(button: HTMLElement): boolean {
  if (!(button instanceof HTMLElement) || !button.isConnected || inExcludedSurface(button)) {
    return false;
  }
  const id = button.getAttribute('data-test-id');
  if (id === 'bard-mode-menu-button' || id === 'model-selector') return true;
  if (
    button.classList.contains('input-area-switch') ||
    button.classList.contains('input-area-switch-label')
  ) {
    return true;
  }
  const controlled = controlledElement(button);
  return Boolean(
    controlled &&
    (button.localName === 'button' || button.getAttribute('role') === 'button') &&
    hasModelEvidence(controlled),
  );
}

export function isSafePickerPanel(panel: HTMLElement, trigger: HTMLElement | null): boolean {
  if (
    !(panel instanceof HTMLElement) ||
    panel === document.body ||
    panel === document.documentElement ||
    !panel.isConnected ||
    inExcludedSurface(panel)
  ) {
    return false;
  }
  if (isModelScope(panel, trigger) && hasModelEvidence(panel)) return true;
  return isNativeThinkingPane(panel);
}

/** A broad ancestor or a single row is not the complete picker controlled by the trigger. */
function isModelScope(panel: HTMLElement, trigger: HTMLElement | null): boolean {
  if (hasNativeItemRole(panel)) return false;
  const bundle = getBundledGeminiSelectorView();
  const containerSelector = pickerSelector(bundle, 'modelPicker.container');
  const controlled = trigger ? controlledElement(trigger) : null;
  if (controlled) {
    const nativeContainer = controlled.closest<HTMLElement>(containerSelector);
    if (nativeContainer && panel !== controlled && panel !== nativeContainer) return false;
    if (!(panel === controlled || panel.contains(controlled) || controlled.contains(panel))) {
      return false;
    }
    const expected = nativeRows(controlled);
    const actual = nativeRows(panel);
    return (
      expected.length > 0 &&
      actual.length === expected.length &&
      actual.every((item, index) => item === expected[index])
    );
  }
  if (!panel.matches(containerSelector)) return false;
  return nativeRows(panel).every((item) => item.closest(containerSelector) === panel);
}

function nativeRows(root: HTMLElement): Element[] {
  const bundle = getBundledGeminiSelectorView();
  return Array.from(
    root.querySelectorAll(
      `${pickerSelector(bundle, 'modelPicker.items')}, ${pickerSelector(bundle, 'modelPicker.thinkingItems')}`,
    ),
  );
}

/** Fixed ARIA ownership also determines the row's meaning; remote classes cannot relabel it. */
export function isNativeThinkingPane(panel: HTMLElement): boolean {
  const bundle = getBundledGeminiSelectorView();
  for (const row of document.querySelectorAll<HTMLElement>('[value="thinking_level"]')) {
    if (!(row instanceof HTMLElement) || !hasNativeItemRole(row) || inExcludedSurface(row))
      continue;
    const submenu = controlledElement(row);
    if (submenu && !panel.contains(row) && (panel === submenu || panel.contains(submenu))) {
      return true;
    }
    if (panel === row && row.querySelector(pickerSelector(bundle, 'modelPicker.thinkingItems'))) {
      return true;
    }
  }
  return false;
}

function hasModelEvidence(panel: HTMLElement): boolean {
  const bundle = getBundledGeminiSelectorView();
  const legacyPanel = bundle.profiles['modelPicker.legacyPanels'].some((selector) =>
    panel.matches(selector),
  );
  return Array.from(
    panel.querySelectorAll<HTMLElement>(pickerSelector(bundle, 'modelPicker.items')),
  ).some((item) => {
    if (
      !(item instanceof HTMLElement) ||
      !hasNativeItemRole(item) ||
      isInlineThinkingItem(item) ||
      isNestedThinkingItem(item) ||
      item.getAttribute('value') === 'thinking_level'
    ) {
      return false;
    }
    if (readModelId(item)) return true;
    const label = item.querySelector(pickerSelector(bundle, 'modelPicker.modelLabel'));
    return (
      item.getAttribute('role') === 'menuitemradio' &&
      Boolean(label?.textContent?.trim()) &&
      (legacyPanel || label?.classList.contains('mode-title') === true)
    );
  });
}

function controlledElement(element: HTMLElement): HTMLElement | null {
  const id = element.getAttribute('aria-controls');
  if (!id || /\s/.test(id)) return null;
  const controlled = document.getElementById(id);
  return controlled && controlled !== element && !element.contains(controlled) ? controlled : null;
}

function inExcludedSurface(element: HTMLElement): boolean {
  return Boolean(
    element.closest(
      '[contenteditable="true"], [hidden], [aria-hidden="true"], .desktop-settings-menu, user-query, model-response, .gv-default-star-btn',
    ),
  );
}

export function assertPickerLabel(
  item: HTMLElement,
  label: HTMLElement,
  kind: 'model' | 'thinking',
  view: GeminiSelectorView,
): void {
  if (
    !(label instanceof HTMLElement) ||
    !hasNativeItemRole(item) ||
    !belongsToPickerItem(label, item) ||
    label.closest('.gv-default-star-btn')
  ) {
    throw new Error('Unrelated model label');
  }
  const key = kind === 'model' ? 'modelPicker.modelLabel' : 'modelPicker.thinkingLabel';
  if (!view.remoteKeys.has(key)) return;
  const canonical = item.querySelector(pickerSelector(getBundledGeminiSelectorView(), key));
  // A stable model ID does not authorize a description to become a future fast-path name.
  if (!canonical && !hasNativeLabelAssociation(item, label)) {
    throw new Error('Uncorroborated picker label');
  }
  // A description matching a remote label cannot rename a still-readable native row.
  if (canonical && canonical.textContent?.trim() !== label.textContent?.trim()) {
    throw new Error('Model label disagrees with native row');
  }
}

function hasNativeLabelAssociation(item: HTMLElement, label: HTMLElement): boolean {
  const text = label.textContent?.trim();
  if (!text) return false;
  if (item.getAttribute('aria-label')?.trim() === text) return true;
  const ids = item.getAttribute('aria-labelledby')?.trim().split(/\s+/) ?? [];
  if (ids.length !== 1) return false;
  const named = document.getElementById(ids[0]);
  return Boolean(
    named && (named === label || named.contains(label)) && named.textContent?.trim() === text,
  );
}

/** Neither an alias nor equal text may move a star/hover target into a nested control. */
export function belongsToPickerItem(node: HTMLElement, item: HTMLElement): boolean {
  for (let current: HTMLElement | null = node; current; current = current.parentElement) {
    if (current === item) return true;
    if (
      hasNativeItemRole(current) ||
      current.localName === 'button' ||
      current.getAttribute('role') === 'button' ||
      current.classList.contains('gv-default-star-btn')
    ) {
      return false;
    }
  }
  return false;
}
