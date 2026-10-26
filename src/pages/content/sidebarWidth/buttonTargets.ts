import {
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  resolveGeminiSelectorOperationInView,
  type GeminiSelectorView,
} from '@/core/gemini/selectors';
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

function sameElements(left: readonly HTMLElement[], right: readonly HTMLElement[]): boolean {
  return left.length === right.length && left.every((element, index) => element === right[index]);
}

/** A changed icon element can be found online; the native ligature and sidebar still prove it. */
export function getSidebarWidthButtons(): HTMLElement[] {
  const view = getGeminiSelectorView();
  const bundle = getBundledGeminiSelectorView();
  if (!view.remoteKeys.has('sidebarWidth.buttons')) return bundledButtons(bundle);
  const bundled = bundledButtons(bundle);
  return resolveGeminiSelectorOperationInView(
    view,
    (accepted) =>
      accepted === bundle
        ? bundled
        : Array.from(
            document.querySelectorAll<HTMLElement>(
              accepted.profiles['sidebarWidth.buttons'].join(', '),
            ),
          ).filter(isVisible),
    (buttons) => {
      // A partial or broader match must not redirect the person's hit to a different control.
      if (bundled.length > 0) return sameElements(buttons, bundled);
      const native = Array.from(document.querySelectorAll<HTMLButtonElement>('bard-sidenav button'))
        .filter(
          (button) =>
            !button.closest('[role="dialog"], [role="menu"], [data-gv-layer]') &&
            !button.disabled &&
            Array.from(button.querySelectorAll('[fonticon]')).some((icon) =>
              ICON_NAMES.has(icon.getAttribute('fonticon') ?? ''),
            ),
        )
        .filter(isVisible);
      return buttons.length === 1 && sameElements(buttons, native);
    },
  ).value;
}
