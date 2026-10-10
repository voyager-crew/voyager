/**
 * `userLatex` primitive: renders the `$…$` / `$$…$$` LaTeX a user typed in their
 * own messages, with the renderer Gemini uses (`pages/content/userLatex`).
 * User turns come from the `turn` param or the site adapter's `userTurn`.
 *
 * Inside each turn only text-only elements are rendered (no element children),
 * so host-owned element nodes are never replaced, and nothing editable or in
 * the composer is touched. Each rendered element keeps its source in
 * `data-user-latex-original` for export, the timeline and send tracking, and
 * unmount puts the host's original text nodes back.
 */
import { dropStaleUserLatex, renderUserLatex, restoreUserLatex } from '@/pages/content/userLatex';

import type { ManifestIssue } from '../manifest/validate';
import type { Dispose } from '../runtime/pluginScope';
import { getPrimitiveContract } from './contracts';
import type { Primitive } from './types';

export interface UserLatexParams {
  readonly turn?: string;
}

const MAX_SELECTOR_LENGTH = 2_000;
/** Same pacing as Gemini's renderer: one pass once the page settles. */
const RESCAN_DELAY_MS = 300;
const PROCESSED_SELECTOR = '[data-user-latex-processed]';
/** Never rendered: editable, hidden, code, controls, or already-rendered math and Voyager UI. */
const SKIP_SELECTOR = [
  'textarea',
  'input',
  'script',
  'style',
  'button',
  'code',
  'pre',
  '[contenteditable]:not([contenteditable="false"])',
  '[aria-hidden="true"]',
  '[data-user-latex-original]',
  '.katex',
  '[class^="gv-"]',
  '[class*=" gv-"]',
].join(', ');
/** Checked on every ancestor, page included: nothing inside an editor is ever rendered. */
const EDITABLE_SELECTOR = 'textarea, input, [contenteditable]:not([contenteditable="false"])';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function querySafe(root: ParentNode, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

export const userLatexPrimitive: Primitive<UserLatexParams> = {
  contract: getPrimitiveContract('userLatex')!,

  validateParams(raw: unknown) {
    if (raw !== undefined && !isRecord(raw)) {
      return { success: false, error: [{ path: 'params', message: 'must be an object' }] };
    }
    const issues: ManifestIssue[] = [];
    const params: { turn?: string } = {};
    for (const [key, value] of Object.entries(raw ?? {})) {
      if (key !== 'turn') {
        issues.push({ path: `params.${key}`, message: 'unknown parameter' });
      } else if (typeof value !== 'string' || !value.trim() || value.length > MAX_SELECTOR_LENGTH) {
        issues.push({ path: 'params.turn', message: 'must be a non-empty selector' });
      } else {
        params.turn = value;
      }
    }
    return issues.length > 0 ? { success: false, error: issues } : { success: true, data: params };
  },

  activate(scope, params, context) {
    const turn = params.turn ?? context.adapter?.selectors.userTurn;
    const composer = context.adapter?.selectors.composer;
    if (!turn) return;
    const { doc } = context;
    context.setTargetCounter(() => querySafe(doc, turn).length);

    const skipped = (element: HTMLElement, message: Element): boolean => {
      // Only up to the message: Voyager stamps gv- classes on the page (body.gv-rtl) around every message.
      for (let node: Element | null = element; node; node = node.parentElement) {
        if (node.matches(SKIP_SELECTOR)) return true;
        if (node === message) break;
      }
      // A custom turn selector can match inside an editor, so editability looks past the message.
      if (element.isContentEditable || element.closest(EDITABLE_SELECTOR)) return true;
      return (
        composer !== undefined && querySafe(doc, composer).some((field) => field.contains(element))
      );
    };
    const renderAll = (): void => {
      for (const message of querySafe(doc, turn)) {
        for (const element of [message, ...message.querySelectorAll('*')]) {
          if (!(element instanceof HTMLElement)) continue;
          dropStaleUserLatex(element);
          if (element.childElementCount > 0) continue;
          if (!element.textContent?.includes('$') || skipped(element, message)) continue;
          // Eligibility again once KaTeX has loaded: the element may have become an editor meanwhile.
          const stillEligible = (): boolean =>
            message.contains(element) &&
            element.isConnected &&
            element.childElementCount === 0 &&
            !skipped(element, message);
          void renderUserLatex(element, scope.signal, stillEligible);
        }
      }
    };

    // Registered first so it runs last: the observer is gone before text goes back.
    scope.effect(
      () => () =>
        querySafe(doc, PROCESSED_SELECTOR).forEach((el) => restoreUserLatex(el as HTMLElement)),
      'user-latex:restore',
    );
    let rescan: Dispose | null = null;
    scope.observe(doc.body, { childList: true, subtree: true }, () => {
      if (scope.isDisposed) return;
      void rescan?.();
      rescan = scope.timer(renderAll, RESCAN_DELAY_MS);
    });
    renderAll();
  },
};
