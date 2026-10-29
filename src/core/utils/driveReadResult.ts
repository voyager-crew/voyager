/** A missing file is the only read result that may stand for absent cloud data. */
export type DriveReadResult<T> =
  | { kind: 'found'; value: T }
  | { kind: 'missing' }
  | { kind: 'unrecognized' }
  | { kind: 'failed'; error: unknown };

export class UnrecognizedDriveFileError extends Error {
  constructor(message = 'Download failed') {
    super(message);
    this.name = 'UnrecognizedDriveFileError';
  }
}

/** Newly created Drive files can have no media yet; malformed media is not empty data. */
export function parseDriveJson(text: string): unknown | null {
  if (text.length === 0) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new UnrecognizedDriveFileError(
      error instanceof Error ? error.message : 'Download failed',
    );
  }
  if (value === null) {
    throw new UnrecognizedDriveFileError('The cloud sync file contains invalid null data');
  }
  return value;
}

export async function readDriveValue<T>(
  read: () => Promise<T | null>,
): Promise<DriveReadResult<T>> {
  try {
    const value = await read();
    return value === null ? { kind: 'missing' } : { kind: 'found', value };
  } catch (error) {
    return error instanceof UnrecognizedDriveFileError
      ? { kind: 'unrecognized' }
      : { kind: 'failed', error };
  }
}
