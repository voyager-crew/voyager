import menus from '@/features/plugins/catalog/sites/gemini/selector-data/canvas-entry.json';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/export-entry-packaged.json';

import {
  createMenuItemFromNativeTemplate,
  updateMenuItemTemplateLabel,
} from '../shared/nativeMenuItemTemplate';

export const CANVAS_MENU_SELECTOR = menus['canvasEntry.menus'].join(',');
const DOWNLOAD_ITEM_SELECTOR = packaged['canvasEntry.downloadItem'];
const CANVAS_OWNER_SELECTOR = packaged['canvasEntry.owner'];
export const CANVAS_MARKDOWN_BUTTON_CLASS = 'gv-canvas-copy-markdown-btn';

export type CanvasMenuInjectionOptions = {
  label: string;
  tooltip: string;
};

export function findCanvasProseMirrorRoot(menuPanel: HTMLElement): HTMLElement | null {
  if (document.querySelector('deep-research-immersive-panel')) return null;
  const trigger = menuPanel.id
    ? Array.from(document.querySelectorAll<HTMLElement>('[aria-controls], [aria-owns]')).find(
        (element) =>
          `${element.getAttribute('aria-controls') || ''} ${element.getAttribute('aria-owns') || ''}`
            .split(/\s+/)
            .includes(menuPanel.id),
      )
    : null;
  // Inline and expanded Canvas editors coexist; a document-wide query copies the wrong one.
  const owner = (trigger || menuPanel).closest(CANVAS_OWNER_SELECTOR);
  return owner?.querySelector<HTMLElement>(packaged['canvasEntry.editor']) ?? null;
}

export function isCanvasExportMenuPanel(menuPanel: HTMLElement): boolean {
  return (
    menuPanel.matches(CANVAS_MENU_SELECTOR) &&
    !!menuPanel.querySelector(DOWNLOAD_ITEM_SELECTOR) &&
    !!findCanvasProseMirrorRoot(menuPanel)
  );
}

export function closeCanvasMenuOverlay(menuPanel: HTMLElement): void {
  // Let Gemini dispose its popover and restore trigger focus rather than removing host DOM.
  menuPanel.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      bubbles: true,
      cancelable: true,
    }),
  );
}

export function updateCanvasCopyLabel(
  button: HTMLElement,
  options: CanvasMenuInjectionOptions,
): void {
  updateMenuItemTemplateLabel(button, options.label, options.tooltip);
  button.setAttribute('arialabel', options.tooltip);
}

export function injectCanvasCopyMarkdownButton(
  menuPanel: HTMLElement,
  options: CanvasMenuInjectionOptions,
): HTMLElement | null {
  if (!isCanvasExportMenuPanel(menuPanel)) return null;
  const downloadItem = menuPanel.querySelector<HTMLElement>(DOWNLOAD_ITEM_SELECTOR)!;
  const existing = menuPanel.querySelector<HTMLElement>(`.${CANVAS_MARKDOWN_BUTTON_CLASS}`);
  if (existing) {
    updateCanvasCopyLabel(existing, options);
    return existing;
  }

  const button = createMenuItemFromNativeTemplate({
    menuContent: menuPanel,
    injectedClassName: CANVAS_MARKDOWN_BUTTON_CLASS,
    iconName: 'content_copy',
    label: options.label,
    tooltip: options.tooltip,
  });
  if (!button) return null;
  // Cloning Angular markup must not retain the source item's action or active styling.
  for (const element of [button, ...button.querySelectorAll<HTMLElement>('*')]) {
    element.classList.remove('active');
    element.removeAttribute('jslog');
    element.removeAttribute('value');
    element.removeAttribute('data-active');
  }
  button.setAttribute('tabindex', '-1');
  button.setAttribute('leadingicon', 'content_copy');
  updateCanvasCopyLabel(button, options);
  downloadItem.after(button);
  return button;
}

function menuItems(menuPanel: HTMLElement): HTMLElement[] {
  return Array.from(
    menuPanel.querySelectorAll<HTMLElement>('gem-menu-item[role="menuitem"]'),
  ).filter((item) => item.getAttribute('aria-disabled') !== 'true');
}

function focusMenuItem(items: HTMLElement[], target: HTMLElement): void {
  for (const item of items) {
    const active = item === target;
    item.tabIndex = active ? 0 : -1;
    item.classList.toggle('active', active);
    item.setAttribute('data-active', String(active));
    item.querySelector('gem-menu-item-content')?.classList.toggle('active', active);
  }
  target.focus();
}

export function removeCanvasCopyMarkdownButton(button: HTMLElement): void {
  // Inner menu wrappers do not own the native items that receive focus on removal.
  const panel = button.closest<HTMLElement>(CANVAS_MENU_SELECTOR);
  if (panel && button.contains(document.activeElement)) {
    const items = menuItems(panel);
    const nativeItem = items.find((item) => item !== button);
    // Disabling while Copy is focused must leave a reachable native menu item.
    if (nativeItem) focusMenuItem(items, nativeItem);
  }
  button.remove();
}

export function navigateCanvasMenu(menuPanel: HTMLElement, event: KeyboardEvent): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const items = menuItems(menuPanel);
  const current = items.findIndex((item) => item.contains(document.activeElement));
  if (current < 0 || items.length === 0) return;
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  // Angular's menu registry does not include cloned items, so include ours in arrow navigation.
  event.preventDefault();
  event.stopImmediatePropagation();
  focusMenuItem(items, items[next]);
}

/** Discovery is pure; retries and DOM insertion start only after the whole local scan is accepted. */
export function resolveCanvasEntryPanels(root: ParentNode): HTMLElement[] {
  const panels: HTMLElement[] = [];
  if (root instanceof HTMLElement) {
    const closest = root.closest<HTMLElement>(CANVAS_MENU_SELECTOR);
    if (closest) panels.push(closest);
  }
  panels.push(...root.querySelectorAll<HTMLElement>(CANVAS_MENU_SELECTOR));
  return [...new Set(panels)];
}
