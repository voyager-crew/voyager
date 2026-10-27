/** Gemini's domain names delegate to the shared per-site snapshot owner. */
import {
  getSiteSelectorView,
  initializeSiteSelectors,
  resolveSiteSelectorOperationInView,
  type SiteSelectorInitialization,
  type SiteSelectorLifetime,
} from '../../selectors/service';
import { acceptsGeminiTurnView } from '../turnIntegrity';
import { getBundledGeminiSelectorView } from './bundle';
import {
  GEMINI_TURN_PROFILE_KEYS,
  type GeminiSelectorOperation,
  type GeminiSelectorView,
  type GeminiTurnOperation,
  type GeminiTurnView,
} from './types';

export type GeminiSelectorInitialization = SiteSelectorInitialization;
export type GeminiSelectorLifetime = SiteSelectorLifetime;

export function initializeGeminiSelectors(
  input: GeminiSelectorInitialization,
): GeminiSelectorLifetime {
  return initializeSiteSelectors('gemini', input);
}

export function getGeminiSelectorView(): GeminiSelectorView {
  return getSiteSelectorView('gemini') as GeminiSelectorView;
}

export function getGeminiTurnView(): GeminiTurnView {
  return getGeminiSelectorView();
}

export function resolveGeminiSelectorOperationInView<T>(
  view: GeminiSelectorView,
  read: (view: GeminiSelectorView) => T,
  isUsable: (value: T) => boolean,
): GeminiSelectorOperation<T> {
  return resolveSiteSelectorOperationInView(view, read, isUsable);
}

export function resolveGeminiSelectorOperation<T>(
  read: (view: GeminiSelectorView) => T,
  isUsable: (value: T) => boolean,
): GeminiSelectorOperation<T> {
  return resolveSiteSelectorOperationInView(getGeminiSelectorView(), read, isUsable);
}

/** Turn ownership and completeness are Gemini protocols, independent of the shared transport. */
export function resolveGeminiTurnOperation<T>(
  read: (view: GeminiTurnView) => T,
  isUsable: (value: T) => boolean,
  view: GeminiTurnView = getGeminiSelectorView(),
): GeminiTurnOperation<T> {
  if (
    !GEMINI_TURN_PROFILE_KEYS.some((key) => view.remoteKeys.has(key)) ||
    !acceptsGeminiTurnView(view)
  ) {
    const bundle = getBundledGeminiSelectorView();
    return { value: read(bundle), view: bundle };
  }
  return resolveSiteSelectorOperationInView(view, read, isUsable);
}
