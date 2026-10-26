import { getSiteSelectorContract } from './contracts';

export const MAX_SITE_SELECTOR_BYTES = 65_536;
export const MAX_SITE_SELECTOR_LENGTH = 2_048;
export const MAX_SITE_SELECTOR_LIST_LENGTH = 32;

export function isSelectorRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isSelectorProfileList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_SITE_SELECTOR_LIST_LENGTH &&
    value.every(
      (item: unknown) =>
        typeof item === 'string' &&
        item.trim().length > 0 &&
        item.length <= MAX_SITE_SELECTOR_LENGTH &&
        !hasControlCharacter(item),
    )
  );
}

export function withinSelectorBudget(value: unknown): boolean {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_SITE_SELECTOR_BYTES;
  } catch {
    return false;
  }
}

/** Packaged profiles may include private keys, but obey the same shape and size budgets. */
export function readBundledSelectorProfiles(
  value: unknown,
): Readonly<Record<string, readonly string[]>> | null {
  if (!isSelectorRecord(value) || !withinSelectorBudget(value)) return null;
  const profiles: Record<string, readonly string[]> = {};
  for (const [key, list] of Object.entries(value)) {
    if (!isSelectorProfileList(list)) return null;
    profiles[key] = Object.freeze([...list]);
  }
  return Object.freeze(profiles);
}

/** The published contract additionally admits only the site's literal remote vocabulary. */
export function readSiteSelectorProfiles(
  siteId: string,
  value: unknown,
): Readonly<Record<string, readonly string[]>> | null {
  const contract = getSiteSelectorContract(siteId);
  if (!contract || !isSelectorRecord(value) || !withinSelectorBudget(value)) return null;
  return readBundledSelectorProfiles(
    Object.fromEntries(Object.entries(value).filter(([key]) => contract.keys.includes(key))),
  );
}

export interface SiteSelectorGroupsRead {
  readonly profiles: Readonly<Record<string, readonly string[]>>;
  readonly rejected: readonly string[];
  readonly unknown: readonly string[];
}

/** One malformed group cannot prevent an unrelated surface from recovering. */
export function readSiteSelectorGroups(
  siteId: string,
  value: unknown,
  isSelector: (selector: string) => boolean,
): SiteSelectorGroupsRead | null {
  const contract = getSiteSelectorContract(siteId);
  if (!contract || !isSelectorRecord(value) || !withinSelectorBudget(value)) return null;
  // New catalog keys must not withdraw repairs understood by an older extension.
  const unknown = Object.keys(value).filter((key) => !contract.keys.includes(key));
  const profiles: Record<string, readonly string[]> = {};
  const rejected: string[] = [];
  for (const group of contract.groups) {
    const present = group.filter((key) => Object.hasOwn(value, key));
    if (present.length === 0) continue;
    const valid = present.every((key) => {
      const list = value[key];
      if (!isSelectorProfileList(list)) return false;
      try {
        return list.every(isSelector);
      } catch {
        return false;
      }
    });
    if (!valid) {
      rejected.push(present[0]);
      continue;
    }
    for (const key of present)
      profiles[key] = Object.freeze([...(value[key] as readonly string[])]);
  }
  return { profiles: Object.freeze(profiles), rejected, unknown };
}

export function readSiteSelectorProfileGroup<Key extends string>(
  siteId: string,
  value: unknown,
  keys: readonly Key[],
): Readonly<Record<Key, readonly string[]>> | null {
  // Source fragments are authored with this build, so an extra key is a publishing typo.
  if (!isSelectorRecord(value) || Object.keys(value).some((key) => !keys.includes(key as Key)))
    return null;
  const profiles = readSiteSelectorProfiles(siteId, value);
  if (
    !profiles ||
    Object.keys(profiles).length !== keys.length ||
    keys.some((key) => !profiles[key])
  )
    return null;
  return profiles as Readonly<Record<Key, readonly string[]>>;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x08 || code === 0x0b || (code >= 0x0e && code <= 0x1f)) return true;
  }
  return false;
}
