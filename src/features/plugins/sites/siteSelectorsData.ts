/**
 * The selector-bearing fields of a `site.json`: `theme` and `selectors`, and
 * the syntax check every selector in the document passes.
 */
import type { ManifestIssue } from '../manifest/validate';
import type { SiteThemeDescriptor } from '../types';
import { isSemanticSelectorKey } from './semanticKeys';

const MAX_SELECTOR_LENGTH = 2_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * A selector that does not parse would make `querySelector` throw at runtime;
 * the engine swallows that and silently skips the operation, so reject it here.
 * With a DOM (extension, jsdom) the parser is the judge; the catalog build runs
 * under Bun without one, where balanced brackets and quotes keep the obvious
 * typos out.
 */
export function isValidSelectorSyntax(selector: string): boolean {
  const doc = (globalThis as { document?: Document }).document;
  if (doc?.createDocumentFragment) {
    try {
      doc.createDocumentFragment().querySelector(selector);
      return true;
    } catch {
      return false;
    }
  }
  const stack: string[] = [];
  let quote: string | null = null;
  for (const char of selector) {
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') stack.push(char);
    else if (char === ')' || char === ']') {
      const open = stack.pop();
      if ((char === ')' && open !== '(') || (char === ']' && open !== '[')) return false;
    }
  }
  return quote === null && stack.length === 0;
}

export function readTheme(raw: unknown, issues: ManifestIssue[]): SiteThemeDescriptor | null {
  if (!isRecord(raw)) {
    issues.push({ path: 'theme', message: 'must be an object' });
    return null;
  }
  const keys = ['hostSelector', 'lightSelector', 'darkSelector'] as const;
  let ok = true;
  for (const key of keys) {
    const value = raw[key];
    if (!nonEmptyString(value) || value.length > MAX_SELECTOR_LENGTH) {
      issues.push({ path: `theme.${key}`, message: 'required non-empty selector' });
      ok = false;
    } else if (!isValidSelectorSyntax(value)) {
      issues.push({ path: `theme.${key}`, message: 'selector does not parse' });
      ok = false;
    }
  }
  if (!ok) return null;
  return {
    hostSelector: raw.hostSelector as string,
    lightSelector: raw.lightSelector as string,
    darkSelector: raw.darkSelector as string,
  };
}

/**
 * A key outside the vocabulary goes to `unknownKeys`, not `issues`: a newer
 * catalog may name a key this build predates, and failing on it would drop
 * every remote selector fix for the site. A known key with a bad value stays
 * fatal, since the remote adapter replaces the bundled one whole and dropping
 * the key would also lose the bundled selector for it.
 */
export function readSelectors(
  raw: unknown,
  issues: ManifestIssue[],
  unknownKeys: ManifestIssue[],
  fallback?: Readonly<Record<string, string>>,
): Record<string, string> {
  const selectors: Record<string, string> = {};
  if (raw === undefined) return selectors;
  if (!isRecord(raw)) {
    issues.push({ path: 'selectors', message: 'must be an object' });
    return fallback ? { ...fallback } : selectors;
  }
  for (const [key, value] of Object.entries(raw)) {
    if (!isSemanticSelectorKey(key)) {
      unknownKeys.push({ path: `selectors.${key}`, message: 'unknown semantic selector key' });
      continue;
    }
    if (!nonEmptyString(value) || value.length > MAX_SELECTOR_LENGTH) {
      issues.push({ path: `selectors.${key}`, message: 'must be a non-empty selector' });
      continue;
    }
    if (!isValidSelectorSyntax(value)) {
      issues.push({ path: `selectors.${key}`, message: 'selector does not parse' });
      continue;
    }
    selectors[key] = value;
  }
  if (fallback && issues.length) {
    // A malformed composer member must not mix another composer with a bundled Send button.
    const groups = [
      ['composer', 'composerRoot', 'sendButton'],
      ['userTurn', 'assistantTurn'],
    ];
    const rejected = new Set(issues.map((issue) => issue.path.slice('selectors.'.length)));
    for (const group of groups) {
      if (group.some((key) => rejected.has(key))) group.forEach((key) => rejected.add(key));
    }
    for (const key of rejected) {
      if (fallback[key]) selectors[key] = fallback[key];
      else delete selectors[key];
    }
  }
  return selectors;
}
