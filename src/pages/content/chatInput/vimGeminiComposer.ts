import { readChatInput } from '@/core/gemini/composer/inputs';
import { findOwnedGeminiMainInputs } from '@/core/gemini/composer/ownedInput';
import {
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  resolveGeminiSelectorOperationInView,
  type GeminiSelectorView,
} from '@/core/gemini/selectors';
import { GEMINI_VIM_PROFILE_KEYS } from '@/core/gemini/selectors/vimKeys';
import { isEditable } from '@/core/services/composer/find';
import { inputSiteId, packagedInputSelectors } from '@/core/services/composer/siteInputData';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/vim-packaged.json';

import { resolveConfiguredComposer } from './vimConfiguredComposer';
import { resolveSiteVimComposer } from './vimSiteComposer';

export interface VimComposerResolution {
  readonly element: HTMLElement | null;
  readonly view: { readonly remoteKeys: ReadonlySet<string> };
  readonly composerSelector: string | null;
  readonly repaired: boolean;
}

export type ResolveVimComposer = (options: {
  doc: Document;
  requireVisible: boolean;
}) => VimComposerResolution;

const EDITABLE = packaged['vim.editable'].join(',');

function configuredInputs(doc: Document, selector: string | null): HTMLElement[] {
  if (!selector) return [];
  try {
    return Array.from(doc.querySelectorAll<HTMLElement>(selector)).flatMap((wrapper) =>
      wrapper.matches(EDITABLE)
        ? [wrapper]
        : Array.from(wrapper.querySelectorAll<HTMLElement>(EDITABLE)),
    );
  } catch {
    return [];
  }
}

function candidateInputs(doc: Document, selectors: readonly string[]): HTMLElement[] {
  return [
    ...new Set(
      selectors.flatMap((selector) =>
        Array.from(doc.querySelectorAll<HTMLElement>(selector)).filter(isEditable),
      ),
    ),
  ];
}

/** Preserve configured wrapper → editable lookup before the ordered generic fallback. */
export function createGeminiVimComposerResolver(
  getConfiguredSelector: () => string | null,
): ResolveVimComposer {
  return ({ doc, requireVisible }) => {
    const site = inputSiteId(doc);
    if (!site) {
      const configured = getConfiguredSelector();
      return {
        element:
          (configured ? resolveConfiguredComposer(configured, { requireVisible }, doc) : null) ??
          readChatInput(packagedInputSelectors('input.candidates', doc), { doc, requireVisible }),
        view: { remoteKeys: new Set<string>() },
        composerSelector: configured,
        repaired: false,
      };
    }
    if (site !== 'gemini')
      return resolveSiteVimComposer(site, getConfiguredSelector(), doc, requireVisible);
    const bundle = getBundledGeminiSelectorView();
    const view = getGeminiSelectorView();
    const configured = getConfiguredSelector();
    const bundledConfigured = bundle.profiles['vim.configuredComposer'].join(',');
    // Explicit plugin params remain authoritative; only the packaged Gemini adapter is migrated.
    const usesAdapter = configured === bundledConfigured;
    const selectorFor = (candidate: GeminiSelectorView): string | null =>
      usesAdapter ? candidate.profiles['vim.configuredComposer'].join(',') : configured;
    const read = (candidate: GeminiSelectorView) => {
      const composerSelector = selectorFor(candidate);
      const configuredElement = composerSelector
        ? resolveConfiguredComposer(composerSelector, { requireVisible }, doc)
        : null;
      const element =
        configuredElement ||
        readChatInput(candidate.profiles['vim.candidates'], { doc, requireVisible });
      return {
        element,
        view: candidate,
        repaired: false,
        // The HUD follows the branch that actually supplied this field, including generic repair.
        composerSelector:
          !configuredElement && candidate.remoteKeys.has('vim.candidates')
            ? candidate.profiles['vim.candidates'].join(',')
            : composerSelector,
      };
    };
    if (!GEMINI_VIM_PROFILE_KEYS.some((key) => view.remoteKeys.has(key))) return read(bundle);

    const expectedConfigured = configuredInputs(doc, configured);
    const expectedCandidates = candidateInputs(doc, bundle.profiles['vim.candidates']);
    const bundled = read(bundle);
    const agrees = (actual: HTMLElement[], expected: HTMLElement[]): boolean => {
      // The complete ordered collection matters even when a partial list picks today's same field.
      if (expected.length)
        return (
          actual.length === expected.length &&
          actual.every((element, index) => element === expected[index])
        );
      if (!actual.length) return true;
      const native = findOwnedGeminiMainInputs(doc);
      return actual.length === 1 && native.length === 1 && actual[0] === native[0];
    };
    const resolution = resolveGeminiSelectorOperationInView(
      view,
      (candidate) => ({
        resolution: read(candidate),
        configured: configuredInputs(doc, selectorFor(candidate)),
        candidates: candidateInputs(doc, candidate.profiles['vim.candidates']),
      }),
      ({ resolution, configured: actualConfigured, candidates }) =>
        agrees(actualConfigured, expectedConfigured) &&
        agrees(candidates, expectedCandidates) &&
        // A remote visible/hidden choice cannot move editing to another already-mounted draft.
        (!bundled.element || resolution.element === bundled.element),
    ).value.resolution;
    // A confirming patch must preserve bundled HUD mounts as well as the selected editor.
    return { ...resolution, repaired: !bundled.element && Boolean(resolution.element) };
  };
}
