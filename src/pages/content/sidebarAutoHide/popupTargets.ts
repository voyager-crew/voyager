import {
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  resolveGeminiSelectorOperationInView,
  type GeminiSelectorView,
} from '@/core/gemini/selectors';
import { GEMINI_SIDEBAR_HOVER_PROFILE_KEYS } from '@/core/gemini/selectors/sidebarInteractionKeys';
import { sameItems } from '@/core/utils/array';

interface Popups {
  readonly dialogs: readonly HTMLElement[];
  readonly menus: readonly HTMLElement[];
}

function read(view: GeminiSelectorView): Popups {
  return {
    dialogs: Array.from(
      document.querySelectorAll<HTMLElement>(view.profiles['sidebarHover.dialogs'].join(', ')),
    ),
    menus: Array.from(
      document.querySelectorAll<HTMLElement>(view.profiles['sidebarHover.menus'].join(', ')),
    ),
  };
}

/** Dialog/menu roles are native evidence, never supplied by the online profile itself. */
export function getSidebarHoverPopups(): Popups {
  const view = getGeminiSelectorView();
  const bundle = getBundledGeminiSelectorView();
  if (!GEMINI_SIDEBAR_HOVER_PROFILE_KEYS.some((key) => view.remoteKeys.has(key)))
    return read(bundle);
  const bundled = read(bundle);
  return resolveGeminiSelectorOperationInView(view, read, (popups) => {
    const complete = (
      nodes: readonly HTMLElement[],
      previous: readonly HTMLElement[],
      role: string,
    ): boolean => {
      if (previous.length > 0) return sameItems(nodes, previous);
      return sameItems(nodes, Array.from(document.querySelectorAll<HTMLElement>(role)));
    };
    // One rejected collection reruns both reads, so a menu cannot hide a dialog from the guard.
    return (
      complete(popups.dialogs, bundled.dialogs, '[role="dialog"], [role="alertdialog"]') &&
      complete(popups.menus, bundled.menus, '[role="menu"]')
    );
  }).value;
}
