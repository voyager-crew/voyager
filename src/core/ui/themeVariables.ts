/**
 * The public colour interface of Voyager's own UI on a host page (issue #821).
 * Voyager never sets these: each chrome colour reads
 * `var(--gv-theme-<role>, <its own value>)`, so a creation that sets one on
 * `:root` recolours that role in light and dark alike, and with none set every
 * surface paints as before. `themeVariables.test.ts` holds this list to what
 * the shipped styles read; the create pages render it for the AI.
 */
export const THEME_VARIABLES = [
  { role: 'surface', meaning: 'panels, menus, dialogs' },
  { role: 'hover', meaning: 'hovered rows' },
  { role: 'text', meaning: 'text' },
  { role: 'text-muted', meaning: 'secondary text, icons' },
  { role: 'border', meaning: 'borders' },
  { role: 'accent', meaning: 'buttons, selection, focus' },
  { role: 'accent-fg', meaning: 'text on accent' },
  { role: 'accent-hue', meaning: 'its OKLCH hue as a number, for tints' },
  { role: 'danger', meaning: 'delete' },
] as const;

export type ThemeRole = (typeof THEME_VARIABLES)[number]['role'];

export function themeVariableName(role: ThemeRole): `--gv-theme-${ThemeRole}` {
  return `--gv-theme-${role}`;
}
