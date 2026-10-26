import {
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  resolveGeminiSelectorOperationInView,
  type GeminiSelectorView,
} from '@/core/gemini/selectors';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/research-pack-packaged.json';

export function readResearchActionBar(
  host: HTMLElement,
  view: GeminiSelectorView,
): HTMLElement | null {
  for (const selector of view.profiles['researchPack.actionBars']) {
    for (const bar of host.querySelectorAll<HTMLElement>(selector)) {
      if (!bar.closest(packaged['researchPack.thoughts'])) return bar;
    }
  }
  return null;
}

export function resolveResearchActionBars(
  hosts: readonly HTMLElement[],
  view: GeminiSelectorView = getGeminiSelectorView(),
): Array<HTMLElement | null> {
  const bundle = getBundledGeminiSelectorView();
  const read = (candidate: GeminiSelectorView) =>
    hosts.map((host) => readResearchActionBar(host, candidate));
  if (!view.remoteKeys.has('researchPack.actionBars')) return read(bundle);
  return resolveGeminiSelectorOperationInView(view, read, (bars) => {
    const reference = read(bundle);
    // Resolve every response before adding buttons; one partial result rejects the whole pass.
    return bars.every((bar, index) => {
      if (reference[index]) return bar === reference[index];
      const host = hosts[index];
      const nativeControls = Array.from(
        host.querySelectorAll<HTMLElement>(
          '[data-test-id="more-menu-button"], [data-test-id="copy-button"], [data-test-id="share-button"]',
        ),
      ).filter((node) => !node.closest(packaged['researchPack.thoughts']));
      if (!bar) return nativeControls.length === 0;

      return (
        bar.closest(packaged['researchPack.host']) === host &&
        !bar.querySelector('message-content, .markdown, .markdown-main-panel, model-thoughts') &&
        nativeControls.length > 0 &&
        nativeControls.every((control) => bar.contains(control))
      );
    });
  }).value;
}
