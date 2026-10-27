import { hasGeminiBoundaryConflict } from '@/core/gemini/domBoundary';
import {
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  resolveGeminiSelectorOperationInView,
  type GeminiSelectorOperation,
  type GeminiSelectorView,
} from '@/core/gemini/selectors';
import { locatorSiteForHost } from '@/core/selectors/sites';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/canvas-packaged.json';
import entry from '@/features/plugins/catalog/sites/gemini/selector-data/export-entry-packaged.json';

const OWNER = entry['canvasEntry.owner'];
const EXCLUDED =
  'deep-research-immersive-panel, input-area, rich-textarea, button, a, input, textarea, [data-gv-layer], [data-gv-plugin]';

function query(root: ParentNode, view: GeminiSelectorView): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(view.profiles['canvas.codePanels'].join(', ')),
  );
}

function isRepairShell(shell: HTMLElement, owner: Element): boolean {
  return (
    (shell.localName === 'div' || shell.localName.includes('-')) &&
    !shell.closest(EXCLUDED) &&
    !hasGeminiBoundaryConflict(shell, owner, 'dialog, [role="dialog"]') &&
    !Array.from(shell.classList).some((name) => name.startsWith('gv-'))
  );
}

function ownsCodeSource(shell: HTMLElement, source: HTMLElement): boolean {
  const lines = shell.querySelector(packaged['canvas.codeLines']);
  const language = shell.querySelector(packaged['canvas.codeLanguage']);
  const title = shell.querySelector(packaged['canvas.codeTitle']);
  // A sibling preview may use Monaco classes too; it cannot lend its bytes or language to this editor.
  return (
    (!lines || source.contains(lines)) &&
    (!language || source.contains(language)) &&
    (!title || !source.contains(title))
  );
}

/** Native editor protocols identify a complete shell without trusting the remote locator. */
function nativeRoots(root: ParentNode): HTMLElement[] {
  const source = packaged['canvas.codeEditor'];
  const header = packaged['canvas.codeTitle'];
  const known = getBundledGeminiSelectorView().profiles['canvas.codePanels'].join(', ');
  const roots: HTMLElement[] = [];
  for (const content of root.querySelectorAll<HTMLElement>(source)) {
    const bundled = content.closest<HTMLElement>(known);
    if (bundled) {
      if (!roots.includes(bundled)) roots.push(bundled);
      continue;
    }
    const owner = content.closest(OWNER);
    if (!owner) continue;
    for (let shell = content.parentElement; shell && shell !== owner; shell = shell.parentElement) {
      const title = Array.from(shell.querySelectorAll(header)).find(
        (node) => !content.contains(node),
      );
      if (!title) continue;
      // Keep one entry per native source: one remote shell cannot collapse two editors into one.
      if (isRepairShell(shell, owner) && ownsCodeSource(shell, content)) roots.push(shell);
      break;
    }
  }
  return roots;
}

function usesRemoteCodePanels(root: ParentNode, view: GeminiSelectorView): boolean {
  const doc = root instanceof Document ? root : root.ownerDocument;
  return (
    locatorSiteForHost(doc?.defaultView?.location.hostname ?? '') === 'gemini' &&
    view.remoteKeys.has('canvas.codePanels')
  );
}

export function resolveFirstCanvasCodeRoot(
  root: ParentNode,
  view = getGeminiSelectorView(),
): HTMLElement | null {
  // The packaged path only needs its first panel; collecting all panels adds work while fixes are off.
  if (!usesRemoteCodePanels(root, view)) {
    const selector = getBundledGeminiSelectorView().profiles['canvas.codePanels'].join(', ');
    return root.querySelector<HTMLElement>(selector);
  }
  return resolveCanvasCodeRoots(root, view).value[0] ?? null;
}

export function resolveCanvasCodeRoots(
  root: ParentNode,
  view = getGeminiSelectorView(),
): GeminiSelectorOperation<HTMLElement[]> {
  const bundle = getBundledGeminiSelectorView();
  if (!usesRemoteCodePanels(root, view)) return { value: query(root, bundle), view: bundle };
  const bundled = query(root, bundle);
  const expected = bundled.length ? bundled : nativeRoots(root);
  return resolveGeminiSelectorOperationInView(
    view,
    (candidate) => query(root, candidate),
    // Whole-operation fallback keeps titles/content paired and never exports a partial editor list.
    (found) =>
      found.length === expected.length && found.every((node, index) => node === expected[index]),
  );
}
