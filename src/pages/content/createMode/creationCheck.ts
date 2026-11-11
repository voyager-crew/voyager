/**
 * Whether a restyling creation finds anything on this page: each style rule's
 * selectors and each page change's target, read without writing anything.
 * What cannot be judged by matching (hover and focus states, pseudo-elements,
 * at-rules such as `@keyframes`, a `{{setting}}` in a selector) is set aside
 * rather than counted as a miss; a rule on `html`, `body` or `:root` alone
 * always matches.
 */
import type { PageVerdict } from '@/features/plugins/local/creation/creationChecks';
import type { InstalledFixFacts } from '@/features/plugins/local/creation/installedFix';
import { diagnoseOps } from '@/features/plugins/runtime/opDiagnostics';
import type { PluginManifest, SiteAdapter } from '@/features/plugins/types';

const PSEUDO_ELEMENT = /::[\w-]+(?:\([^)]*\))?|:(?:before|after|first-line|first-letter)\b/gi;
/** States a person brings about; at check time nothing is hovered or focused. */
const USER_STATE =
  /:(?:hover|active|focus|focus-visible|focus-within|visited|target|target-within)\b/gi;
const PAGE_ROOT = /^(?:html|body|:root)(?:\[[^\]]*\]|:[\w-]+(?:\([^)]*\))?)*$/i;

export interface CreationPageCheck {
  readonly verdict: PageVerdict;
  readonly facts: Pick<InstalledFixFacts, 'quietRules' | 'quietTargets'>;
}

/** Splits a selector list on its top-level commas, leaving `:is(a, b)` whole. */
function selectorParts(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let index = 0; index < list.length; index += 1) {
    const char = list[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(list.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(list.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** True or false when the rule can be judged here; null when it cannot. */
function ruleMatches(doc: Document, selectorText: string): boolean | null {
  if (selectorText.includes('{{')) return null;
  let judged = false;
  for (const part of selectorParts(selectorText)) {
    const bare = part.replace(PSEUDO_ELEMENT, '').replace(USER_STATE, '').trim();
    // `::selection` alone, or `html[data-gv-scheme='dark']`: the page itself.
    if (bare === '' || bare === '*' || PAGE_ROOT.test(bare)) return true;
    try {
      if (doc.querySelector(bare)) return true;
      judged = true;
    } catch {
      // A selector this engine cannot parse says nothing either way.
    }
  }
  return judged ? false : null;
}

/** Every top-level style rule's selector text, inside `@media`, `@supports`, `@layer` and `@container` too. */
function styleSelectors(doc: Document, css: string): string[] {
  const selectors: string[] = [];
  const walk = (rules: CSSRuleList | undefined) => {
    for (const rule of Array.from(rules ?? [])) {
      if ('selectorText' in rule && typeof rule.selectorText === 'string') {
        selectors.push(rule.selectorText);
      } else if ('cssRules' in rule) {
        // Grouping rules; `@keyframes` children have `keyText`, not selectors, so add nothing.
        walk(rule.cssRules as CSSRuleList);
      }
    }
  };
  walk(parsedRules(doc, css));
  return selectors;
}

/**
 * The sheet's rules, parsed without applying them to this page: a sheet no
 * document adopts, or else a `<style>` in an inert document. Undefined where
 * neither parses, which leaves every rule unjudged.
 */
function parsedRules(doc: Document, css: string): CSSRuleList | undefined {
  try {
    if (typeof CSSStyleSheet.prototype.replaceSync === 'function') {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      return sheet.cssRules;
    }
  } catch {
    // Fall through to the inert document.
  }
  const inert = doc.implementation.createHTMLDocument('');
  const style = inert.createElement('style');
  style.textContent = css;
  inert.head.append(style);
  return style.sheet?.cssRules;
}

export function checkCreationOnPage(
  doc: Document,
  adapter: SiteAdapter | null,
  manifest: PluginManifest,
): CreationPageCheck {
  const css = (manifest.contributes.styles ?? []).map((entry) => entry.css).join('\n');
  const quietRules: string[] = [];
  const quietTargets: string[] = [];
  let found = false;
  for (const selector of styleSelectors(doc, css)) {
    const result = ruleMatches(doc, selector);
    if (result === true) found = true;
    else if (result === false) quietRules.push(selector);
  }
  for (const op of diagnoseOps(doc, adapter, manifest)) {
    if (op.state === 'ok' || op.state === 'page-root') found = true;
    else if (op.state === 'none') quietTargets.push(`${op.label} (${op.op})`);
  }
  const verdict: PageVerdict = found
    ? 'matches'
    : quietRules.length + quietTargets.length > 0
      ? 'nothing'
      : 'unchecked';
  return { verdict, facts: { quietRules, quietTargets } };
}
