import { readChatInput } from '@/core/gemini/composer/inputs';
import {
  getBundledSiteSelectorView,
  getSiteSelectorView,
  resolveSiteSelectorOperationInView,
  type SiteSelectorView,
} from '@/core/selectors';
import { isEditable } from '@/core/services/composer/find';
import { packagedInputSelector } from '@/core/services/composer/siteInputData';
import { acceptsSiteInputs, inputCandidates } from '@/core/services/composer/siteInputReads';

import { resolveConfiguredComposer } from './vimConfiguredComposer';
import type { VimComposerResolution } from './vimGeminiComposer';

export function resolveSiteVimComposer(
  siteId: string,
  configured: string | null,
  doc: Document,
  requireVisible: boolean,
): VimComposerResolution {
  const bundle = getBundledSiteSelectorView(siteId);
  const view = getSiteSelectorView(siteId);
  const configuredBundle = bundle.profiles.composer.join(',');
  const usesAdapter =
    configured === configuredBundle || configured === view.profiles.composer?.join(',');
  const selectorFor = (candidate: SiteSelectorView) =>
    usesAdapter ? candidate.profiles.composer.join(',') : configured;
  const configuredInputs = (selector: string | null): HTMLElement[] => {
    if (!selector) return [];
    return Array.from(doc.querySelectorAll<HTMLElement>(selector)).flatMap((wrapper) =>
      isEditable(wrapper)
        ? [wrapper]
        : Array.from(
            wrapper.querySelectorAll<HTMLElement>(packagedInputSelector('vim.editable', doc)),
          ).filter(isEditable),
    );
  };
  const read = (candidate: SiteSelectorView) => {
    const composerSelector = selectorFor(candidate);
    const configuredElement = composerSelector
      ? resolveConfiguredComposer(composerSelector, { requireVisible }, doc)
      : null;
    return {
      element:
        configuredElement ??
        readChatInput(
          candidate.profiles['vim.candidates'] ?? candidate.profiles['input.candidates'],
          { doc, requireVisible },
        ),
      view: candidate,
      composerSelector,
      repaired: false,
    };
  };
  if (!view.remoteKeys.has('vim.candidates') && !view.remoteKeys.has('composer'))
    return read(bundle);
  const expectedConfigured = configuredInputs(selectorFor(bundle));
  const expectedCandidates = inputCandidates(
    doc,
    bundle.profiles['vim.candidates'] ?? bundle.profiles['input.candidates'],
  );
  const bundled = read(bundle);
  const accepted = resolveSiteSelectorOperationInView(
    view,
    (candidate) => ({
      resolution: read(candidate),
      configured: configuredInputs(selectorFor(candidate)),
      candidates: inputCandidates(
        doc,
        candidate.profiles['vim.candidates'] ?? candidate.profiles['input.candidates'],
      ),
    }),
    (value) =>
      ((expectedConfigured.length === 0 && value.configured.length === 0) ||
        acceptsSiteInputs(siteId, doc, value.configured, expectedConfigured)) &&
      acceptsSiteInputs(siteId, doc, value.candidates, expectedCandidates) &&
      (!bundled.element || value.resolution.element === bundled.element),
  ).value.resolution;
  return { ...accepted, repaired: !bundled.element && Boolean(accepted.element) };
}
