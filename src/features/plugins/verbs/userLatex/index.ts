/**
 * `userLatex` primitive: renders the `$…$` / `$$…$$` LaTeX a user typed in their
 * own messages, with the renderer Gemini uses (`pages/content/userLatex`).
 * User turns come from the `turn` param or the site adapter's `userTurn`.
 *
 * With `unit: 'leaf'` (the default) only text-only elements inside each turn
 * are rendered (no element children), so host-owned element nodes are never
 * replaced. With `unit: 'turn'` each matched turn is rendered whole, as
 * Gemini's native renderer does with a user line, Voyager's own markers in it
 * included. Nothing editable or in the composer is touched either way. Each
 * rendered element keeps its source in `data-user-latex-original` for export,
 * the timeline and send tracking.
 *
 * Every activation claims what it renders under its own owner token, so two
 * activations (for example, official and local plugins) never render or restore
 * each other's lines: unmount puts back only
 * what this activation claimed, including lines the host detached meanwhile.
 * Nor does one claim inside or around a line the other holds, its claim still
 * waiting for KaTeX included: a whole turn over another's rendered leaf would
 * save that leaf's KaTeX text as its source.
 */
import { resolveGeminiUserLatexLines } from '@/core/gemini/math/userLatex';
import { getGeminiSelectorView } from '@/core/gemini/selectors';
import { createUserLatexOwner } from '@/core/utils/userLatexSource';
import {
  createUserLatexClaims,
  dropStaleUserLatex,
  renderUserLatex,
} from '@/pages/content/userLatex';

import type { ManifestIssue } from '../../manifest/validate';
import type { Dispose } from '../../runtime/pluginScope';
import { getPrimitiveContract } from '../contracts';
import type { Primitive } from '../types';

export type UserLatexUnit = 'leaf' | 'turn';

export interface UserLatexParams {
  readonly turn?: string;
  readonly unit?: UserLatexUnit;
}

const MAX_SELECTOR_LENGTH = 2_000;
/** Same pacing as Gemini's renderer: one pass once the page settles. */
const RESCAN_DELAY_MS = 300;
const UNITS: readonly UserLatexUnit[] = ['leaf', 'turn'];
/** Never rendered: editable, hidden, code, controls, or already-rendered math. */
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
].join(', ');
/** Voyager's own UI, skipped too, except on a whole turn rendered as one unit. */
const VOYAGER_SELECTOR = '[class^="gv-"], [class*=" gv-"]';
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
    const params: { turn?: string; unit?: UserLatexUnit } = {};
    for (const [key, value] of Object.entries(raw ?? {})) {
      if (key === 'unit') {
        if (UNITS.includes(value as UserLatexUnit)) params.unit = value as UserLatexUnit;
        else issues.push({ path: 'params.unit', message: 'must be "leaf" or "turn"' });
      } else if (key !== 'turn') {
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
    const wholeTurn = params.unit === 'turn';
    // Only the packaged Gemini line profile participates; local selectors keep their own contract.
    const geminiLines =
      context.adapter?.id === 'gemini' && wholeTurn && turn === 'p.query-text-line';
    const readMessages = () =>
      geminiLines ? resolveGeminiUserLatexLines(doc) : { value: querySafe(doc, turn), view: null };
    const owner = createUserLatexOwner(context.pluginId);
    const claims = createUserLatexClaims(owner);
    context.setTargetCounter(() => readMessages().value.length);

    const skipped = (element: HTMLElement, message: Element): boolean => {
      // Only up to the message: Voyager stamps gv- classes on the page (body.gv-rtl) around every message.
      for (let node: Element | null = element; node; node = node.parentElement) {
        if (node.matches(SKIP_SELECTOR)) return true;
        // The turn is host content even under a gv- marker another plugin put on it (collapse's
        // instance class), which would otherwise leave its math raw whenever that plugin mounted first.
        if (node !== message && node.matches(VOYAGER_SELECTOR)) return true;
        if (node === message) break;
      }
      // A custom turn selector can match inside an editor, so editability looks past the message.
      if (element.isContentEditable || element.closest(EDITABLE_SELECTOR)) return true;
      // Rendering a whole turn replaces everything in it: never with an editor inside.
      if (wholeTurn && element.querySelector(EDITABLE_SELECTOR)) return true;
      return (
        composer !== undefined && querySafe(doc, composer).some((field) => field.contains(element))
      );
    };
    // A leaf has no element children; a whole turn is rendered whatever it holds.
    const renderable = (element: HTMLElement, message: Element): boolean =>
      (wholeTurn ? element === message : element.childElementCount === 0) &&
      !skipped(element, message);
    const render = (element: HTMLElement, message: Element, accepts: () => boolean): void => {
      dropStaleUserLatex(element);
      if (!element.textContent?.includes('$') || !renderable(element, message)) return;
      // Eligibility again once KaTeX has loaded: the element may have become an editor meanwhile.
      const stillEligible = (): boolean =>
        message.contains(element) &&
        element.isConnected &&
        renderable(element, message) &&
        accepts();
      void renderUserLatex(element, {
        owner,
        signal: scope.signal,
        canReplace: stillEligible,
        claims,
      });
    };
    const renderAll = (): void => {
      claims.prune();
      const operation = readMessages();
      const view = operation.view;
      for (const message of operation.value) {
        // A renamed line moved to another turn while KaTeX loaded is no longer this operation's line.
        const host = view?.remoteKeys.has('userLatex.lines') ? message.closest('user-query') : null;
        const accepts = () =>
          !view?.remoteKeys.has('userLatex.lines') ||
          (getGeminiSelectorView() === view &&
            message.closest('user-query') === host &&
            resolveGeminiUserLatexLines(doc, view).value.includes(message as HTMLElement));
        if (wholeTurn) {
          if (message instanceof HTMLElement) render(message, message, accepts);
          continue;
        }
        for (const element of [message, ...message.querySelectorAll('*')]) {
          if (element instanceof HTMLElement) render(element, message, accepts);
        }
      }
    };

    // Registered first so it runs last: the observer is gone and scope.signal has
    // cancelled pending renders before text goes back, detached lines included.
    scope.effect(() => () => claims.restoreAll(), 'user-latex:restore');
    let rescan: Dispose | null = null;
    scope.observe(doc.body, { childList: true, subtree: true }, () => {
      if (scope.isDisposed) return;
      void rescan?.();
      rescan = scope.timer(renderAll, RESCAN_DELAY_MS);
    });
    renderAll();
  },
};
