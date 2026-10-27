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

export interface SiteFragmentBaselineEntry {
  readonly sites: readonly string[];
  readonly row: string;
  readonly values: readonly string[];
  readonly reason: string;
}

/** OFF snapshots can be updated; they must never grant a new ownership exemption. */
export function readSiteFragmentBaseline(root: string): readonly SiteFragmentBaselineEntry[] {
  const file = 'scripts/lib/siteFragmentBaseline.json';
  const data: unknown = JSON.parse(readFileSync(join(root, file), 'utf8'));
  if (
    !data ||
    typeof data !== 'object' ||
    !('header' in data) ||
    typeof data.header !== 'string' ||
    !data.header.trim() ||
    !('baseline' in data) ||
    data.baseline !== '6fa19b4ae' ||
    !('entries' in data) ||
    !Array.isArray(data.entries)
  )
    throw new Error(`Invalid frozen ownership baseline: ${file}`);
  return data.entries.map((entry: unknown, index): SiteFragmentBaselineEntry => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !('reason' in entry) ||
      typeof entry.reason !== 'string' ||
      !entry.reason.trim()
    )
      throw new Error(`${file} entry ${index} needs a reviewed reason`);
    if (
      !('sites' in entry) ||
      !Array.isArray(entry.sites) ||
      !entry.sites.length ||
      !entry.sites.every(
        (site: unknown): site is string =>
          typeof site === 'string' && Object.hasOwn(SITE_DIALECTS, site),
      ) ||
      !('row' in entry) ||
      typeof entry.row !== 'string' ||
      !/^[\w-]+\.json\/[^/]+$/.test(entry.row) ||
      !('values' in entry) ||
      !Array.isArray(entry.values) ||
      !entry.values.length ||
      !entry.values.every((value: unknown): value is string => typeof value === 'string' && !!value)
    )
      throw new Error(`${file} entry ${index} must identify exact sites, row and values`);
    return { sites: entry.sites, row: entry.row, values: entry.values, reason: entry.reason };
  });
}

export function inspectSiteFragmentOwnership(root: string): LocatorViolation[] {
  const failures: LocatorViolation[] = [];
  const sitesPath = 'src/features/plugins/catalog/sites';
  const exemptions = readSiteFragmentBaseline(root);
  for (const site of Object.keys(SITE_DIALECTS)) {
    const baseline = new Map<string, readonly string[]>();
    for (const entry of exemptions.filter((entry) => entry.sites.includes(site)))
      baseline.set(entry.row, [...(baseline.get(entry.row) ?? []), ...entry.values]);
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
