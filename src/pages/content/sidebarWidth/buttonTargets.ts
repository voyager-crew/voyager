import {
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  type GeminiSelectorView,
} from '@/core/gemini/selectors';
import { resolvePlacementOperation } from '@/core/selectors/placement';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/sidebar-interaction-packaged.json';

const ICON_NAMES = new Set(['side_nav', 'side_nav_expand']);

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function bundledButtons(view: GeminiSelectorView): HTMLElement[] {
  const selector = view.profiles['sidebarWidth.buttons'].join(', ');
  const buttons = new Set(document.querySelectorAll<HTMLElement>(selector));
  document.querySelectorAll<HTMLElement>(packaged.widthButtons.join(', ')).forEach((button) => {
    const name =
      button.querySelector(packaged.widthIcon.join(', '))?.getAttribute('fonticon') ?? '';
    if (button.matches(selector) || ICON_NAMES.has(name)) buttons.add(button);
  });
  return Array.from(buttons).filter(isVisible);
}

/** Trusted candidates only measure the hit region; they never authorize the forwarded click. */
export function getSidebarWidthButtons(): HTMLElement[] {
  const view = getGeminiSelectorView();
  const bundle = getBundledGeminiSelectorView();
  if (
    !view.remoteKeys.has('sidebarWidth.buttons') &&
    !view.remoteKeys.has('sidebarWidth.candidates')
  )
    return bundledButtons(bundle);
  const key = view.remoteKeys.has('sidebarWidth.buttons')
    ? 'sidebarWidth.buttons'
    : 'sidebarWidth.candidates';
  return resolvePlacementOperation(
    view,
    key,
    (selector) =>
      selector === bundle.profiles[key].join(',')
        ? bundledButtons(bundle)
        : Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(isVisible),
    { mount: false },
  );
}

/** The real control stays independently fixed even when catalog geometry moves. */
export function getSidebarWidthActionButtons(): HTMLElement[] {
  const view = getGeminiSelectorView();
  const bundled = bundledButtons(getBundledGeminiSelectorView());
  if (
    !view.remoteKeys.has('sidebarWidth.buttons') &&
    !view.remoteKeys.has('sidebarWidth.candidates')
  )
    return bundled;
  if (bundled.length) return bundled;
  const native = Array.from(
    document.querySelectorAll<HTMLButtonElement>(packaged.widthButtons.join(', ')),
  )
    .filter(
      (button) =>
        !button.closest('[role="dialog"], [role="menu"], [data-gv-layer]') &&
        !button.disabled &&
        Array.from(button.querySelectorAll('[fonticon]')).some((icon) =>
          ICON_NAMES.has(icon.getAttribute('fonticon') ?? ''),
        ),
    )
    .filter(isVisible);
  return native.length === 1 ? native : [];
}
