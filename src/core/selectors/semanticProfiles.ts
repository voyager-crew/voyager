import { getSiteSelectorContract } from './contracts';

/** Only explicitly admitted semantic locators can cross a native adapter's packaged boundary. */
export function overlayPublishedSemanticSelectors(
  siteId: string,
  bundled: Readonly<Record<string, string>>,
  remote: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const selectors = { ...bundled };
  for (const key of getSiteSelectorContract(siteId)?.keys ?? []) {
    if (Object.hasOwn(bundled, key) && typeof remote[key] === 'string')
      selectors[key] = remote[key];
  }
  return selectors;
}
