import { getBundledGeminiSelectorView, type GeminiSelectorView } from '@/core/gemini/selectors';
import imageSelectors from '@/features/plugins/catalog/sites/gemini/selector-data/image-export-packaged.json';

const SOURCE_OWNER = '[data-full-size-image-uri]';
const UNSAFE_OWNER =
  'button, mat-icon, model-thoughts, .thoughts-container, .thoughts-content, user-query, user-query-file-preview, generated-image, .generated-images, youtube-block, single-video, .attachment-container.youtube, message-actions, .message-actions, .generated-image-controls, [class*="gv-"]';
const CONTENT_FRAMES =
  'p, h1, h2, h3, h4, h5, h6, pre, code, ul, ol, li, table, blockquote, canvas, svg, math, iframe, input, textarea, [contenteditable="true"]';
const ATTRIBUTION = [
  ...imageSelectors['imageExport.caption'],
  ...imageSelectors['imageExport.sourceAnchor'],
].join(', ');

export function bundledGeminiSearchImageSelector(): string {
  return getBundledGeminiSelectorView().profiles['imageExport.searchHosts'].join(', ');
}

/** Keep the existing light/shadow ordering for both the probe and the later image sweep. */
export function collectGeminiImageHosts(root: Element, selector: string): Element[] {
  const hosts: Element[] = [];
  const visit = (node: Element | ShadowRoot): void => {
    if (node instanceof Element && node.matches(selector)) hosts.push(node);
    hosts.push(...Array.from(node.querySelectorAll(selector)));
    const walk = (element: Element): void => {
      if (element.shadowRoot) visit(element.shadowRoot);
      Array.from(element.children).forEach(walk);
    };
    Array.from(node.children).forEach(walk);
  };
  visit(root);
  return hosts;
}

function sameNodes(left: readonly Element[], right: readonly Element[]): boolean {
  return left.length === right.length && left.every((element, index) => element === right[index]);
}

function isNativeSourceOwner(host: Element, root: Element): boolean {
  if (!host.getAttribute('data-full-size-image-uri') || host.closest(UNSAFE_OWNER)) return false;
  // The source attribute belongs to one image card; a wrapper must not swallow prose or cards.
  if (host.querySelector(`${CONTENT_FRAMES}, ${SOURCE_OWNER}`)) return false;
  const images = Array.from(host.querySelectorAll('img'));
  if (
    images.length === 0 ||
    images.some((image) => image.closest('mat-icon, .generated-image-controls'))
  )
    return false;
  const owner = host.closest('model-response, .model-response, user-query');
  if (owner && owner !== root && !owner.contains(root)) return false;
  const walker = host.ownerDocument.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.trim() && !node.parentElement?.closest(ATTRIBUTION)) return false;
  }
  return true;
}

/** Resolve once before traversal can emit figures or mark a YouTube cover as processed. */
export function resolveGeminiSearchImageSelector(root: Element, view: GeminiSelectorView): string {
  const bundled = bundledGeminiSearchImageSelector();
  if (!view.remoteKeys.has('imageExport.searchHosts')) return bundled;
  try {
    const selector = view.profiles['imageExport.searchHosts'].join(', ');
    const candidates = collectGeminiImageHosts(root, selector);
    const original = collectGeminiImageHosts(root, bundled);
    // Partial and foreign lists retire the entire read, including its later shadow/image sweep.
    if (original.length > 0) return sameNodes(candidates, original) ? selector : bundled;
    const native = collectGeminiImageHosts(root, SOURCE_OWNER);
    return native.length > 0 &&
      native.every((host) => isNativeSourceOwner(host, root)) &&
      sameNodes(candidates, native)
      ? selector
      : bundled;
  } catch {
    return bundled;
  }
}
