/** Where an open folder lists its subfolders against its own conversations. */
export type SubfolderPlacement = 'first' | 'last';

/** A stored placement; anything but `'last'` is the default, `'first'`. */
export function toSubfolderPlacement(value: unknown): SubfolderPlacement {
  return value === 'last' ? 'last' : 'first';
}
