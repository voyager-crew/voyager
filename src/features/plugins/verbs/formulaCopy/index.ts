/**
 * `formulaCopy` primitive (D10): Voyager's formula-copy feature, unchanged,
 * exposed to declarative plugins. A plugin turns it on for its site with
 *
 *   { "op": "native", "handler": "formulaCopy", "params": {} }
 *
 * Every plugin that copies formulas calls it this way: the builtin
 * `voyager.formula-copy` (Claude, ChatGPT), the DeepSeek catalog plugin, the
 * packaged Gemini / AI Studio official plugins and any local one. The plugins
 * own the lifecycle and retain the existing formula-copy settings keys. One
 * page-wide service backs them all, so the host lets one plugin hold it at a
 * time (`runtime/resourceClaims.ts`).
 */
import { activateFormulaCopy } from '@/features/formulaCopy';
import { FORMULA_TARGET_SELECTOR } from '@/features/formulaCopy/formulaSource';

import type { ManifestIssue } from '../../manifest/validate';
import { getPrimitiveContract } from '../contracts';
import type { Primitive } from '../types';

export type FormulaCopyParams = Readonly<Record<string, never>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const formulaCopyPrimitive: Primitive<FormulaCopyParams> = {
  contract: getPrimitiveContract('formulaCopy')!,

  validateParams(raw: unknown) {
    const issues: ManifestIssue[] = [];
    if (raw !== undefined && !isRecord(raw)) {
      issues.push({ path: 'params', message: 'must be an object' });
    } else if (raw) {
      for (const key of Object.keys(raw)) {
        issues.push({ path: `params.${key}`, message: 'unknown parameter' });
      }
    }
    return issues.length > 0 ? { success: false, error: issues } : { success: true, data: {} };
  },

  activate(scope, _params, context) {
    context.setTargetCounter(() => context.doc.querySelectorAll(FORMULA_TARGET_SELECTOR).length);
    activateFormulaCopy(scope);
  },
};
