/**
 * The two formula copy preferences Gemini and AI Studio share, stored in
 * `StorageKeys.FORMULA_COPY_FORMAT` and `StorageKeys.FORMULA_COPY_SELECTION_LATEX`,
 * read the way the formula copy service has always read them.
 */
export type FormulaCopyFormat = 'latex' | 'unicodemath' | 'no-dollar' | 'notion';

export function isFormulaCopyFormat(value: unknown): value is FormulaCopyFormat {
  return (
    value === 'latex' || value === 'unicodemath' || value === 'no-dollar' || value === 'notion'
  );
}

/** Anything but a known format, a missing key included, copies LaTeX. */
export function resolveFormulaCopyFormat(stored: unknown): FormulaCopyFormat {
  return isFormulaCopyFormat(stored) ? stored : 'latex';
}

/** On unless stored `false`: a selection copy rewrites its formulas as LaTeX. */
export function resolveFormulaCopySelectionLatex(stored: unknown): boolean {
  return stored !== false;
}
