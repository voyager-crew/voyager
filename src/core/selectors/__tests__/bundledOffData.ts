import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { getBundledGeminiTurnSelectors } from '@/core/gemini/turnSelectors';
import genericInput from '@/core/services/composer/generic-input.json';
import { SEND_SITE_POLICIES } from '@/core/services/composer/sendKeys/sendSitePolicies';
import { packagedSiteInputSelectors } from '@/core/services/composer/siteInputData';
import type { InputSiteId } from '@/core/services/composer/siteInputData';
import { timelineSiteData } from '@/features/timeline/siteTextData';

import type { SiteSelectorView } from '../types';

export type BundledOffEntry = readonly [key: string, value: unknown];
const SOURCE_ROOT = join(process.cwd(), 'src');

/** Capture ordered data, including packaged consumers outside the online view. */
export function bundledOffData(
  site: InputSiteId | null,
  host: string,
  view?: SiteSelectorView,
): BundledOffEntry[] {
  const entries: BundledOffEntry[] = [
    ['siteId', site ?? 'generic'],
    ...Object.entries(view?.profiles ?? {}).map(([key, value]): BundledOffEntry => [
      `profiles/${key}`,
      value,
    ]),
    [
      'packagedInput',
      Object.keys(genericInput).map((key) => [key, packagedSiteInputSelectors(site, key)]),
    ],
    ['timeline', Object.entries(timelineSiteData(undefined, `https://${host}/`))],
  ];
  if (site === 'gemini') {
    for (const key of ['chatWidth.userTurn', 'chatWidth.assistantTurn'] as const)
      entries.push([key, getBundledGeminiTurnSelectors(key)]);
  }
  if (site === 'gemini' || site === 'aistudio') {
    const policy = SEND_SITE_POLICIES[site];
    entries.push(['sendPolicy', [policy.editableSelector, policy.sendContainerSelectors]]);
  }
  if (site) {
    const dir = join(SOURCE_ROOT, 'features/plugins/catalog/sites', site, 'selector-data');
    for (const file of readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .sort()) {
      const data: unknown = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new Error(`Expected a locator fragment: ${site}/${file}`);
      for (const entry of Object.entries(data)) entries.push([`${file}/${entry[0]}`, entry[1]]);
    }
  } else {
    for (const file of [
      'core/services/composer/generic-input.json',
      'features/timeline/generic-text.json',
      'pages/content/export/generic-layout.json',
      'pages/content/export/adapter/platform/generic-profile.json',
    ]) {
      const data: unknown = JSON.parse(readFileSync(join(SOURCE_ROOT, file), 'utf8'));
      entries.push([file, data]);
    }
  }
  return entries;
}
