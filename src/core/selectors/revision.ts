export function getSiteBundledRevision(): number {
  const value = Number(import.meta.env.VOYAGER_CATALOG_REVISION);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
