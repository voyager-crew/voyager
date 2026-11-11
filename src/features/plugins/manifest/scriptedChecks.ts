import type { ScriptContribution } from '../scripted/types';
import { isRecord, nonEmptyString } from './jsonGuards';
import type { ManifestIssue } from './validate';

export const MAX_SCRIPT_SOURCE_CHARS = 200_000;

/**
 * The `contributes.script` of a scripted manifest, or undefined with issues.
 * Only a caller that passes `allowScripted` (the local gate, on request) gets
 * one; the remote catalog, the bundled catalog and `plugin:check` refuse the tier.
 */
export function readScriptContribution(
  input: Readonly<Record<string, unknown>>,
  allowScripted: boolean,
  issues: ManifestIssue[],
): ScriptContribution | undefined {
  const contributes = isRecord(input.contributes) ? input.contributes : {};
  if (input.tier !== 'scripted') {
    if (contributes.script !== undefined) {
      issues.push({
        path: 'contributes.script',
        message: 'only a scripted plugin carries a script',
      });
    }
    return undefined;
  }
  if (!allowScripted) {
    issues.push({ path: 'tier', message: 'scripted plugins run only as reviewed local plugins' });
    return undefined;
  }
  for (const key of Object.keys(contributes)) {
    if (key === 'script') continue;
    issues.push({
      path: `contributes.${key}`,
      message: 'a scripted plugin contributes only its script',
    });
  }
  if (input.theme !== undefined) {
    issues.push({ path: 'theme', message: 'a scripted plugin declares no theme' });
  }
  const script = contributes.script;
  if (!isRecord(script) || !nonEmptyString(script.source)) {
    issues.push({ path: 'contributes.script.source', message: 'required non-empty string' });
    return undefined;
  }
  for (const key of Object.keys(script)) {
    if (key !== 'source')
      issues.push({ path: `contributes.script.${key}`, message: 'unknown field' });
  }
  if (script.source.length > MAX_SCRIPT_SOURCE_CHARS) {
    issues.push({
      path: 'contributes.script.source',
      message: `exceeds ${MAX_SCRIPT_SOURCE_CHARS} characters`,
    });
    return undefined;
  }
  return { source: script.source };
}
