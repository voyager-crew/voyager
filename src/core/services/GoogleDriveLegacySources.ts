import { UnrecognizedDriveFileError } from '@/core/utils/driveReadResult';

/** Optional envelope provenance travels atomically with the email file across devices. */
export function readLegacyMergeSources(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || !('legacyMergeSources' in value)) return {};
  const raw = value.legacyMergeSources;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UnrecognizedDriveFileError();
  const entries = Object.entries(raw);
  if (
    !entries.every(
      ([id, checksum]) =>
        id.length > 0 &&
        typeof checksum === 'string' &&
        /^(?:[a-f0-9]{32}|sha256:[a-f0-9]{64})$/i.test(checksum),
    )
  )
    throw new UnrecognizedDriveFileError();
  return Object.fromEntries(entries);
}

export function withLegacyMergeSources(
  value: unknown,
  sources: Readonly<Record<string, string>>,
): unknown {
  if (!Object.keys(sources).length) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new UnrecognizedDriveFileError();
  return { ...value, legacyMergeSources: { ...sources } };
}
