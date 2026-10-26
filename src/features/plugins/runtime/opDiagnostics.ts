/**
 * Per-op match diagnostics: how many elements each targeted DOM op of a
 * plugin finds on the page right now. Read-only (one `querySelectorAll` per
 * op, nothing written), so it is safe for a plugin that is not mounted.
 *
 * A plugin-wide count hides an op that finds nothing whenever another op
 * matches, and an op on `body` always matches; the popup and the health check
 * look at each op instead.
 */
import {
  SEMANTIC_KEY_PRESENCE,
  type SemanticKeyPresence,
  isSemanticSelectorKey,
} from '../sites/semanticKeys';
import type { PluginManifest, SiteAdapter } from '../types';
import { resolveSemanticElements } from './semanticElements';
import { type TargetedOperation, isTargetedOp } from './targetedOps';

/**
 *   ok                found at least one element
 *   none              found nothing
 *   page-root         targets `html`, `body` or `:root`, which always exist
 *   unresolved-key    the site adapter has no selector for its semantic key
 *   invalid-selector  the selector does not parse
 */
export type OpMatchState = 'ok' | 'none' | 'page-root' | 'unresolved-key' | 'invalid-selector';

export interface OpDiagnostic {
  /** Index in `contributes.domOps` (native ops keep their slots). */
  readonly index: number;
  readonly op: TargetedOperation['op'];
  /** The semantic key, or the raw selector shortened for display. */
  readonly label: string;
  readonly count: number;
  readonly state: OpMatchState;
  /** When its element should exist; `unknown` for a raw selector. */
  readonly expect: SemanticKeyPresence | 'unknown';
}

const MAX_LABEL_LENGTH = 40;
const PAGE_ROOTS = new Set(['html', 'body', ':root']);

function isPageRoot(selector: string): boolean {
  return selector.split(',').every((part) => PAGE_ROOTS.has(part.trim().toLowerCase()));
}

function selectorLabel(selector: string): string {
  const label = selector.replace(/\s+/g, ' ').trim();
  return label.length > MAX_LABEL_LENGTH ? `${label.slice(0, MAX_LABEL_LENGTH - 1)}…` : label;
}

function diagnoseOp(
  doc: Document,
  adapter: SiteAdapter | null,
  op: TargetedOperation,
  index: number,
): OpDiagnostic {
  const { target } = op;
  const semantic = target.kind === 'semantic';
  const label = semantic ? target.key : selectorLabel(target.selector);
  const expect: OpDiagnostic['expect'] =
    semantic && isSemanticSelectorKey(target.key) ? SEMANTIC_KEY_PRESENCE[target.key] : 'unknown';
  const base = { index, op: op.op, label, expect };
  const selector = semantic ? adapter?.selectors[target.key] : target.selector;
  if (!selector) return { ...base, count: 0, state: 'unresolved-key' };
  let count: number;
  try {
    count =
      (semantic ? resolveSemanticElements(doc, adapter, target.key)?.length : undefined) ??
      doc.querySelectorAll(selector).length;
  } catch {
    return { ...base, count: 0, state: 'invalid-selector' };
  }
  if (isPageRoot(selector)) return { ...base, count, state: 'page-root' };
  return { ...base, count, state: count > 0 ? 'ok' : 'none' };
}

/** Every targeted op of `manifest`, in `domOps` order. Empty when it has none. */
export function diagnoseOps(
  doc: Document,
  adapter: SiteAdapter | null,
  manifest: PluginManifest,
): readonly OpDiagnostic[] {
  const result: OpDiagnostic[] = [];
  (manifest.contributes.domOps ?? []).forEach((op, index) => {
    if (isTargetedOp(op)) result.push(diagnoseOp(doc, adapter, op, index));
  });
  return result;
}

/**
 * Ops that found nothing although the page shows what they need: a
 * `page` key always (an empty chat has a sidebar and a composer too), a
 * `conversation` key once the page has user turns, and any op whose target
 * cannot resolve. Raw selectors and transient keys are never judged on their
 * own; page-root targets always match. Returns their `index` values.
 */
export function missingOps(ops: readonly OpDiagnostic[], userTurns: number): readonly number[] {
  return ops
    .filter((op) => {
      if (op.state === 'unresolved-key' || op.state === 'invalid-selector') return true;
      if (op.state !== 'none') return false;
      return op.expect === 'page' || (op.expect === 'conversation' && userTurns > 0);
    })
    .map((op) => op.index);
}
