import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { LocatorViolation } from '../check-locator-contracts';

/** Native host dialects, not generic HTML, ARIA, Material or editor-library markup. */
const SITE_DIALECTS: Readonly<Record<string, RegExp>> = {
  gemini:
    /\b(?:user-query(?:-[\w-]+)?|model-response(?:-[\w-]+)?|rich-textarea|bard-sidenav|toolbox-drawer|gem-[\w-]+)\b/,
  aistudio: /\bms-[\w-]+\b/,
  chatgpt:
    /(?:#prompt-textarea\b|\bdata-(?:chatgpt|composer-markdown|app-action)[\w-]*\b|#conversation-header-actions\b)/,
  claude: /\b(?:font-claude-response|data-claude[\w-]*)\b/,
  deepseek: /(?:\.ds-[\w-]+\b|\bdata-deepseek[\w-]*\b)/,
  kimi: /\bdata-kimi[\w-]*\b/,
};

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.flatMap(strings) : [];
}

export function foreignSiteValue(
  site: string,
  value: string,
  baseline: readonly string[],
): string | null {
  // §6 legacy fallback lists intentionally include other dialects; only exact reviewed OFF values survive.
  if (baseline.includes(value)) return null;
  return (
    Object.entries(SITE_DIALECTS).find(
      ([owner, dialect]) => owner !== site && dialect.test(value),
    )?.[0] ?? null
  );
}

function baselineEntries(root: string, site: string): Map<string, readonly string[]> {
  const fixtures = join(root, 'src/core/selectors/__tests__/fixtures/bundled-off');
  const entries = new Map<string, readonly string[]>();
  for (const file of readdirSync(fixtures).filter(
    (file) => file.startsWith(`${site}-`) && file.endsWith('.json'),
  )) {
    const data: unknown = JSON.parse(readFileSync(join(fixtures, file), 'utf8'));
    if (!Array.isArray(data)) throw new Error(`Invalid OFF snapshot: ${file}`);
    for (const row of data) {
      if (Array.isArray(row) && typeof row[0] === 'string') entries.set(row[0], strings(row[1]));
    }
  }
  return entries;
}

export function inspectSiteFragmentOwnership(root: string): LocatorViolation[] {
  const failures: LocatorViolation[] = [];
  const sitesPath = 'src/features/plugins/catalog/sites';
  for (const site of Object.keys(SITE_DIALECTS)) {
    const baseline = baselineEntries(root, site);
    const dir = `${sitesPath}/${site}/selector-data`;
    for (const name of readdirSync(join(root, dir)).filter((name) => name.endsWith('.json'))) {
      const file = `${dir}/${name}`;
      const raw = readFileSync(join(root, file), 'utf8');
      const data: unknown = JSON.parse(raw);
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new Error(`Invalid fragment: ${file}`);
      for (const [key, value] of Object.entries(data)) {
        for (const selector of strings(value)) {
          const foreign = foreignSiteValue(site, selector, baseline.get(`${name}/${key}`) ?? []);
          if (!foreign) continue;
          const position = raw.indexOf(JSON.stringify(selector));
          failures.push({
            file,
            line: raw.slice(0, Math.max(0, position)).split('\n').length,
            reason: `${key} contains ${foreign}-only host data ${JSON.stringify(selector)}; review site ownership, not just the loader import`,
          });
        }
      }
    }
  }
  return failures;
}
