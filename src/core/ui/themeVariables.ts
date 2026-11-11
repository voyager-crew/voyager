/**
 * The public colour interface of Voyager's own UI on a host page (issue #821).
 * Voyager never sets these: each chrome colour reads
 * `var(--gv-theme-<role>, <its own value>)`, so a creation that sets one on
 * `:root` recolours that role in light and dark alike, and with none set every
 * surface paints as before. The neutral roles reach only Voyager's own surfaces
 * (panels, menus, dialogs, tooltips, toasts) and what sits on them; what Voyager
 * draws straight on the host page keeps the host's colours, since a creation's
 * panel text would vanish on the host's background. The accent roles and danger
 * are fills and marks readable anywhere, so they reach both. `timeline` is the
 * one role for marks Voyager draws on the host page: the timeline's rail, its
 * resting dots and ticks, and the left slider's track. `themeVariables.test.ts` holds this list to what
 * the shipped styles read; the create pages render it for the AI.
 */
export const THEME_VARIABLES = [
  { role: 'surface', meaning: 'background' },
  { role: 'hover', meaning: 'hovered rows' },
  { role: 'text', meaning: 'text' },
  { role: 'text-muted', meaning: 'secondary text, icons' },
  { role: 'border', meaning: 'borders' },
  { role: 'accent', meaning: 'buttons, selection, focus' },
  { role: 'accent-fg', meaning: 'text on accent' },
  { role: 'accent-hue', meaning: 'accent OKLCH hue, a number' },
  { role: 'danger', meaning: 'delete' },
  { role: 'timeline', meaning: 'rail and dots on the site’s background' },
] as const;

export type ThemeRole = (typeof THEME_VARIABLES)[number]['role'];

export function themeVariableName(role: ThemeRole): `--gv-theme-${ThemeRole}` {
  return `--gv-theme-${role}`;
}
