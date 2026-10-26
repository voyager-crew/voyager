/** Site-scoped locator profiles; the vocabulary and rejection groups ship in the extension. */
import { GEMINI_SELECTOR_PROFILE_GROUPS } from '../../../../core/gemini/selectors/types';
import { readGeminiSelectorProfiles } from '../../../../core/gemini/selectors/validation';
import type { ManifestIssue } from '../../manifest/validate';

export type SiteLocatorProfiles = Readonly<Record<string, readonly string[]>>;

interface LocatorPolicy {
  readonly groups: readonly (readonly string[])[];
  readonly read: (raw: unknown) => SiteLocatorProfiles | null;
}

const SITE_LOCATOR_POLICIES: Readonly<Record<string, LocatorPolicy>> = {
  gemini: { groups: GEMINI_SELECTOR_PROFILE_GROUPS, read: readGeminiSelectorProfiles },
};

export interface SiteLocatorsRead {
  readonly locators?: SiteLocatorProfiles;
  readonly issues: readonly ManifestIssue[];
}

/** Invalid shape/budgets discard only this section; invalid syntax discards only its surface. */
export function readSiteLocators(
  raw: unknown,
  siteId: unknown,
  isSelector: (selector: string) => boolean,
): SiteLocatorsRead {
  if (raw === undefined) return { issues: [] };
  const policy =
    typeof siteId === 'string' && Object.hasOwn(SITE_LOCATOR_POLICIES, siteId)
      ? SITE_LOCATOR_POLICIES[siteId]
      : undefined;
  const profiles = policy?.read(raw);
  if (!policy || !profiles) {
    return {
      issues: [{ path: 'locators', message: 'invalid or unsupported site locator profiles' }],
    };
  }
  const locators: Record<string, readonly string[]> = {};
  const issues: ManifestIssue[] = [];
  for (const group of policy.groups) {
    const present = group.filter((key) => profiles[key] !== undefined);
    if (present.some((key) => !profiles[key].every(isSelector))) {
      // A half-adopted surface can pair unrelated elements; retain the whole bundled group.
      issues.push({ path: `locators.${present[0]}`, message: 'locator group does not parse' });
      continue;
    }
    for (const key of present) locators[key] = profiles[key];
  }
  return { locators: Object.freeze(locators), issues };
}
