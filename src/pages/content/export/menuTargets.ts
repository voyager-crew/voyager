import {
  type GeminiSelectorView,
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  resolveGeminiSelectorOperationInView,
} from '@/core/gemini/selectors';
import { GEMINI_MENU_PROFILE_KEYS } from '@/core/gemini/selectors/menuKeys';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/menu-packaged.json';

export const MENU_PANEL_SELECTOR = '.mat-mdc-menu-panel[role="menu"], gem-menu';

class InjectedOnlinePanels {
  private readonly panels = new WeakSet<HTMLElement>();
  remember(panel: HTMLElement): void {
    this.panels.add(panel);
  }
  containsRemoved(node: HTMLElement): boolean {
    if (node.isConnected) return false;
    return (
      this.panels.has(node) ||
      Array.from(node.querySelectorAll<HTMLElement>(packaged['menu.nativePanels'])).some((panel) =>
        this.panels.has(panel),
      )
    );
  }
}
const injectedOnlinePanels = new InjectedOnlinePanels();

export function rememberOnlineMenuPanel(panel: HTMLElement): void {
  injectedOnlinePanels.remember(panel);
}
export function containsRemovedOnlineMenuPanel(node: HTMLElement): boolean {
  return injectedOnlinePanels.containsRemoved(node);
}

export function hasOnlineMenuTargets(): boolean {
  const view = getGeminiSelectorView();
  return GEMINI_MENU_PROFILE_KEYS.some((key) => view.remoteKeys.has(key));
}

function controlledIds(trigger: HTMLElement): string[] {
  return `${trigger.getAttribute('aria-controls') ?? ''} ${trigger.getAttribute('aria-owns') ?? ''}`
    .split(/\s+/)
    .filter(Boolean);
}

/** Remote menu reads cannot borrow the last expanded settings/profile trigger. */
export function associatedMenuTrigger(panel: HTMLElement): HTMLElement | null {
  if (!panel.id) return null;
  const expanded = Array.from(
    document.querySelectorAll<HTMLElement>(packaged['menu.expandedTrigger']),
  );
  if (expanded.length !== 1) return null;
  const matches = expanded.filter(
    (trigger) =>
      controlledIds(trigger).includes(panel.id) &&
      trigger.matches(
        `${packaged['menu.conversationTriggers']}, ${packaged['menu.responseTrigger']}`,
      ),
  );
  return matches.length === 1 ? matches[0] : null;
}

function nativeItems(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(packaged['menu.items'])).filter(
    (item) => !Array.from(item.classList).some((name) => name.startsWith('gv-')),
  );
}

function contentInView(panel: HTMLElement, view: GeminiSelectorView): HTMLElement | null {
  if (!panel.matches(view.profiles['menu.panels'].join(','))) return null;
  if (panel.tagName === 'GEM-MENU') return panel;
  return panel.querySelector<HTMLElement>(view.profiles['menu.content'].join(','));
}

/** The native item collection proves the complete insertion parent, not just one matching item. */
function provesContent(panel: HTMLElement, content: HTMLElement | null): boolean {
  if (!content || !panel.matches(packaged['menu.nativePanels'])) return false;
  const bundled = contentInView(panel, getBundledGeminiSelectorView());
  if (bundled && bundled !== content) return false;
  const items = nativeItems(panel);
  return items.length > 0 && items.every((item) => item.parentElement === content);
}

function readMenuSurface(panel: HTMLElement) {
  const view = getGeminiSelectorView();
  const read = (candidate: GeminiSelectorView) => ({
    panels: Array.from(
      panel.ownerDocument.querySelectorAll<HTMLElement>(
        candidate.profiles['menu.panels'].join(','),
      ),
    ),
    content: contentInView(panel, candidate),
  });
  const bundled = getBundledGeminiSelectorView();
  if (!GEMINI_MENU_PROFILE_KEYS.some((key) => view.remoteKeys.has(key))) {
    return { value: read(bundled), view: bundled };
  }
  return resolveGeminiSelectorOperationInView(
    view,
    read,
    ({ panels, content }) =>
      panels.includes(panel) &&
      sameNodes(
        panels,
        Array.from(
          panel.ownerDocument.querySelectorAll<HTMLElement>(packaged['menu.nativePanels']),
        ),
      ) &&
      (read(bundled).panels.length === 0 || sameNodes(panels, read(bundled).panels)) &&
      provesContent(panel, content) &&
      associatedMenuTrigger(panel) !== null,
  );
}

export function findMenuContent(panel: HTMLElement): HTMLElement | null {
  // Preserve the old standalone reader as well as the guarded injection call sites.
  if (!hasOnlineMenuTargets())
    return panel.tagName === 'GEM-MENU'
      ? panel
      : panel.querySelector<HTMLElement>(
          getBundledGeminiSelectorView().profiles['menu.content'].join(','),
        );
  return readMenuSurface(panel).value.content;
}

export function usesOnlineMenuPanel(panel: HTMLElement): boolean {
  // The bundled injection path never needs a document-wide online validation read.
  if (!hasOnlineMenuTargets()) return false;
  const { view } = readMenuSurface(panel);
  return GEMINI_MENU_PROFILE_KEYS.some((key) => view.remoteKeys.has(key));
}

function sameNodes(left: readonly HTMLElement[], right: readonly HTMLElement[]): boolean {
  return left.length === right.length && left.every((node, index) => node === right[index]);
}

/** Discovery reads one complete collection; a narrowed online list cannot hide another menu. */
export function getMenuPanels(root: ParentNode = document): HTMLElement[] {
  const view = getGeminiSelectorView();
  const read = (candidate: GeminiSelectorView) =>
    Array.from(root.querySelectorAll<HTMLElement>(candidate.profiles['menu.panels'].join(',')));
  if (!GEMINI_MENU_PROFILE_KEYS.some((key) => view.remoteKeys.has(key))) {
    return read(getBundledGeminiSelectorView());
  }
  return resolveGeminiSelectorOperationInView(view, read, (panels) => {
    const bundled = read(getBundledGeminiSelectorView());
    const native = Array.from(root.querySelectorAll<HTMLElement>(packaged['menu.nativePanels']));
    return (
      panels.length > 0 &&
      (bundled.length === 0 || sameNodes(panels, bundled)) &&
      sameNodes(panels, native)
    );
  }).value;
}

export function isMenuPanel(panel: HTMLElement): boolean {
  if (!hasOnlineMenuTargets()) return panel.matches(MENU_PANEL_SELECTOR);
  return getMenuPanels(panel.ownerDocument).includes(panel);
}

export function collectMenuPanels(node: HTMLElement): Set<HTMLElement> {
  if (!hasOnlineMenuTargets()) {
    const panels = new Set<HTMLElement>();
    if (node.matches(MENU_PANEL_SELECTOR)) panels.add(node);
    node.querySelectorAll<HTMLElement>(MENU_PANEL_SELECTOR).forEach((panel) => panels.add(panel));
    const parent = node.closest<HTMLElement>(MENU_PANEL_SELECTOR);
    if (parent) panels.add(parent);
    return panels;
  }
  const candidates = `${getGeminiSelectorView().profiles['menu.panels'].join(',')}, ${packaged['menu.nativePanels']}`;
  // Streaming chat nodes cannot justify a complete document scan unless a menu is nearby.
  if (!node.matches(candidates) && !node.querySelector(candidates) && !node.closest(candidates)) {
    return new Set();
  }
  return new Set(
    getMenuPanels(node.ownerDocument).filter(
      (panel) => panel === node || panel.contains(node) || node.contains(panel),
    ),
  );
}
