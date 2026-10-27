import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getSiteSelectorContract } from '../../src/core/selectors/contracts';
import {
  MAX_SITE_SELECTOR_BYTES,
  readSiteSelectorProfiles,
  readSiteSelectorProfileGroup,
} from '../../src/core/selectors/validation';

/** Publish exactly the consumed fragments; packaged safety and protocol data never leave the bundle. */
export function readPublishedSiteLocators(catalogDir: string, siteId: string) {
  const contract = getSiteSelectorContract(siteId);
  if (!contract) return undefined;
  const root = join(catalogDir, 'sites', siteId, 'selector-data');
  if (!existsSync(root)) return undefined;
  const selectors: Record<string, readonly string[]> = {};
  for (const group of contract.files) {
    const path = join(root, group.file);
    const raw = readFileSync(path, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > MAX_SITE_SELECTOR_BYTES) {
      throw new Error(`${path}: locator source exceeds the decoded byte limit`);
    }
    const profiles = readSiteSelectorProfileGroup(siteId, JSON.parse(raw) as unknown, group.keys);
    if (!profiles) throw new Error(`${path}: bundled locator group is incomplete or invalid`);
    Object.assign(selectors, profiles);
  }
  const profiles = readSiteSelectorProfiles(siteId, selectors);
  if (!profiles) throw new Error(`${root}: combined locator profiles exceed the shared contract`);
  return profiles;
}
