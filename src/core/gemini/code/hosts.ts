import {
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  resolveGeminiSelectorOperationInView,
  type GeminiSelectorOperation,
  type GeminiSelectorView,
} from '@/core/gemini/selectors';
import { locatorSiteForHost } from '@/core/selectors/sites';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/code-packaged.json';

import { hasGeminiBoundaryConflict } from '../domBoundary';

export const GEMINI_PACKAGED_CODE = packaged;
const CODE_SELECTOR = packaged['code.content'].join(', ');
const DECORATION_SELECTOR = packaged['code.decoration'].join(', ');
const SHELL_SELECTOR = packaged['code.shell'].join(', ');

export function hasGeminiCodeFixes(doc: Document, view = getGeminiSelectorView()): boolean {
  return (
    view.remoteKeys.has('code.host') &&
    locatorSiteForHost(doc.defaultView?.location.hostname ?? '') === 'gemini'
  );
}

function queryHosts(root: ParentNode, view: GeminiSelectorView): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(view.profiles['code.host'].join(', ')));
}

function hasCompleteCode(host: HTMLElement): boolean {
  return Boolean(host.querySelector(CODE_SELECTOR) && host.querySelector(DECORATION_SELECTOR));
}

/** Repair evidence never comes from an input, dialog, action or Voyager-owned island. */
function isNativeCodeOwner(host: HTMLElement): boolean {
  if (
    (host.localName !== 'div' && !host.localName.includes('-')) ||
    host.matches('html, body, main, model-response, message-content, [role="main"]') ||
    host.closest(
      'input-area, rich-textarea, [contenteditable], button, a, input, textarea, select, [role="button"], [data-gv-layer], [data-gv-plugin], .gv-dialog',
    ) ||
    hasGeminiBoundaryConflict(
      host,
      host.closest('model-response, .model-response'),
      'dialog, [role="dialog"]',
    )
  )
    return false;
  // The proved native host may carry plugin classes; its surrounding Voyager UI still cannot own it.
  for (
    let current: HTMLElement | null = host.parentElement;
    current && current !== host.ownerDocument.body;
    current = current.parentElement
  ) {
    if (
      Array.from(current.classList).some(
        (name) =>
          name.startsWith('gv-') &&
          name !== 'gv-code-block-collapsible' &&
          name !== 'gv-code-block-collapsed',
      )
    )
      return false;
  }
  return true;
}

/** Native code and its decoration identify the smallest complete shell independently of the patch. */
function nativeHosts(root: ParentNode): HTMLElement[] {
  const result: HTMLElement[] = [];
  for (const code of root.querySelectorAll<HTMLElement>(CODE_SELECTOR)) {
    let host = code.closest<HTMLElement>('code-block');
    if (!host) {
      const shell = code.closest<HTMLElement>(SHELL_SELECTOR);
      const parent = shell?.parentElement;
      if (
        shell &&
        parent &&
        isNativeCodeOwner(parent) &&
        parent.children.length === 1 &&
        Array.from(parent.childNodes).every(
          (node) => node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim(),
        ) &&
        shell.querySelector(DECORATION_SELECTOR) &&
        shell.querySelectorAll(CODE_SELECTOR).length === 1
      )
        host = parent;
    }
    if (host && hasCompleteCode(host) && !result.includes(host)) result.push(host);
  }
  return result;
}

export function resolveGeminiCodeHosts(
  root: ParentNode,
  view = getGeminiSelectorView(),
): GeminiSelectorOperation<HTMLElement[]> {
  const doc = root instanceof Document ? root : root.ownerDocument;
  const bundle = getBundledGeminiSelectorView();
  if (!doc || !hasGeminiCodeFixes(doc, view))
    return { value: queryHosts(root, bundle), view: bundle };
  // Streaming shells lack a source or header; they must not invalidate the completed siblings.
  const bundled = queryHosts(root, bundle).filter(hasCompleteCode);
  const expected = bundled.length ? bundled : nativeHosts(root);
  return resolveGeminiSelectorOperationInView(
    view,
    (candidate) => {
      const hosts = queryHosts(root, candidate);
      return candidate.remoteKeys.has('code.host') ? hosts.filter(hasCompleteCode) : hosts;
    },
    (hosts) => {
      // A subset or a larger wrapper can hide a sibling response; accept the complete native host list only.
      return (
        hosts.length === expected.length && hosts.every((host, index) => host === expected[index])
      );
    },
  );
}
