import { resolveGeminiInput } from '@/core/gemini/composer/inputs';
import { hasGeminiBoundaryConflict } from '@/core/gemini/domBoundary';
import { getGeminiSelectorView } from '@/core/gemini/selectors';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/fork-packaged.json';

interface ForkComposerRead {
  readonly hasRemote: boolean;
  find(): HTMLElement | null;
}

/** A fork keeps its legacy visibility policy while sharing the guarded main-composer claim. */
export function createForkComposerRead(): ForkComposerRead {
  const view = getGeminiSelectorView();
  const hasRemote = view.remoteKeys.has('composer.candidates');
  const bundledSelector = packaged['fork.input'].join(', ');
  const find = (selector: string, remote = false) =>
    Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
      (element) =>
        !(remote
          ? hasGeminiBoundaryConflict(
              element,
              element.closest(
                'input-area, input-area-v2, input-container, .text-input-field, .input-area',
              ),
              '.edit-container, .user-query-container.edit-mode, [role="dialog"], .mat-mdc-dialog-container',
            )
          : element.closest(
              '.edit-container, .user-query-container.edit-mode, [role="dialog"], .mat-mdc-dialog-container',
            )) && element.getBoundingClientRect().height > 0,
    ) ?? null;
  const bundled = () => find(bundledSelector);
  // A composer rename must recover paste and upload prefill without broadening bundled matching.
  return {
    hasRemote,
    find: hasRemote
      ? () => resolveGeminiInput({}, (selectors) => find(selectors.join(', '), true), view, bundled)
      : bundled,
  };
}
