import { hasVoyagerOwner } from '../gemini/composer/ownedInput';
import { getBundledSiteSelectorView } from './bundle';
import { getSiteSelectorView } from './service';

/** Streaming aliases can only add a refusal, never make a native in-progress export look complete. */
export function chatgptSignalSelector(
  key: 'export.streaming' | 'export.loggedOutStreaming' | 'actions.thinking',
  root: ParentNode = document,
): string {
  const bundle = getBundledSiteSelectorView('chatgpt').profiles[key].join(',');
  const view = getSiteSelectorView('chatgpt');
  if (!view.remoteKeys.has(key)) return bundle;
  try {
    const remote = view.profiles[key].join(',');
    const candidates = Array.from(root.querySelectorAll(remote));
    if (root instanceof Element && root.matches(remote)) candidates.unshift(root);
    if (
      !candidates.length ||
      candidates.some(
        (node) =>
          hasVoyagerOwner(node) ||
          !node.closest(
            '[data-turn-key], [data-turn-id-container], [data-message-role="assistant"]',
          ) ||
          !(
            node.matches('[aria-busy="true"], [role="progressbar"], progress') ||
            node.querySelector('[aria-busy="true"], [role="progressbar"], progress')
          ),
      )
    )
      return bundle;
    return `${bundle}, ${remote}`;
  } catch {
    return bundle;
  }
}
