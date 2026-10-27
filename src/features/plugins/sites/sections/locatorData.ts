/** Site-scoped locator profiles; the vocabulary and rejection groups ship in the extension. */
import { readSiteSelectorGroups } from '../../../../core/selectors/validation';
import type { ManifestIssue } from '../../manifest/validate';

export type SiteLocatorProfiles = Readonly<Record<string, readonly string[]>>;

export interface SiteLocatorsRead {
  readonly locators?: SiteLocatorProfiles;
  readonly issues: readonly ManifestIssue[];
}

export function readSiteLocators(
  raw: unknown,
  siteId: unknown,
  isSelector: (selector: string) => boolean,
): SiteLocatorsRead {
  if (raw === undefined) return { issues: [] };
  const accepted =
    typeof siteId === 'string' ? readSiteSelectorGroups(siteId, raw, isSelector) : null;
  if (!accepted)
    return {
      issues: [{ path: 'locators', message: 'invalid or unsupported site locator profiles' }],
    };
  return {
    locators: accepted.profiles,
    issues: [
      ...accepted.rejected.map((key) => ({
        path: `locators.${key}`,
        message: 'invalid locator group',
      })),
      ...accepted.unknown.map((key) => ({
        path: `locators.${key}`,
        message: 'unknown locator key',
      })),
    ],
  };
}
