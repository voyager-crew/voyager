import { getGeminiSelectorView } from '@/core/gemini/selectors';
import { isSafePlacementMount, resolvePlacementOperation } from '@/core/selectors/placement';

export type ProjectPlacementKey =
  | 'project.modelAnchor'
  | 'project.inputAnchor'
  | 'project.fontSource';

/** Fonts only measure; insertion anchors must leave our picker outside the host's editor. */
export function readProjectPlacement(key: ProjectPlacementKey): HTMLElement | null {
  const view = getGeminiSelectorView();
  return resolvePlacementOperation(
    view,
    key,
    (selector) => {
      const anchor = document.querySelector<HTMLElement>(selector);
      if (
        view.remoteKeys.has(key) &&
        selector === view.profiles[key].join(',') &&
        key !== 'project.fontSource' &&
        anchor?.parentElement &&
        !isSafePlacementMount(anchor.parentElement)
      )
        return null;
      return anchor;
    },
    { mount: false },
  );
}
