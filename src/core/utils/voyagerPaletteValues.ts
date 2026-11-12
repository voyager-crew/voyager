/** The palettes of the `voyager.*-palette` plugins; the first is the default. */
export const VOYAGER_PALETTES = ['nord', 'nord-dark', 'nord-light'] as const;
export type VoyagerPalette = (typeof VOYAGER_PALETTES)[number];

/** A stored palette this build does not offer reads as the default. */
export function resolveVoyagerPalette(stored: unknown): VoyagerPalette {
  return VOYAGER_PALETTES.find((palette) => palette === stored) ?? VOYAGER_PALETTES[0];
}
