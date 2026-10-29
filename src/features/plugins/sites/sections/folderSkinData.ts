/**
 * Folder appearance only: no selectors, storage or account policy. Kept outside
 * `folders` because older clients reject unknown keys inside that section.
 * The same reader checks bundled adapters, online data and catalog publishing.
 */
import type { ManifestIssue } from '../../manifest/validate';

export const FOLDER_SKIN_COLORS = [
  'heading',
  'text',
  'textMuted',
  'surface',
  'surfaceContainer',
  'surfaceHover',
  'surfaceActive',
  'outline',
  'danger',
  'dangerSoft',
] as const;

export type FolderSkinColors = Readonly<Record<(typeof FOLDER_SKIN_COLORS)[number], string>> & {
  readonly sidebar?: string;
};

export interface FolderSkin {
  readonly rowHeight: string;
  readonly rowRadius: string;
  readonly light: FolderSkinColors;
  /** Unchanged colours inherit from light, as ordinary CSS custom properties do. */
  readonly dark: Partial<FolderSkinColors>;
  /** Reserve the corner occupied by a host's pinned history control. */
  readonly header?: { readonly height: number; readonly paddingInlineEnd: number };
}

const VARIABLE = /^--[a-z][a-z0-9-]{0,79}$/;
const HEX = /^#(?:[a-f0-9]{3}|[a-f0-9]{4}|[a-f0-9]{6}|[a-f0-9]{8})$/i;
const DECIMAL = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,3})?$/;
const COLOR_KEYS = [...FOLDER_SKIN_COLORS, 'sidebar'];

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

/** Split only outer arguments; nested var fallbacks and colour mixes stay whole. */
function argumentsOf(raw: string): string[] {
  let depth = 0;
  let start = 0;
  const args: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '(') depth++;
    if (raw[i] === ')') depth--;
    if (raw[i] === ',' && depth === 0) {
      args.push(raw.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(raw.slice(start).trim());
  return args;
}

function boundedNumber(raw: string, max: number): boolean {
  return DECIMAL.test(raw) && Number(raw) <= max;
}

/** A deliberately small colour grammar, also available in builds without a DOM. */
function isColor(raw: string, depth = 0): boolean {
  if (depth > 4) return false;
  if (HEX.test(raw) || raw === 'transparent') return true;
  const fn = /^(var|rgba?|color-mix)\((.*)\)$/.exec(raw);
  if (!fn) return false;
  const args = argumentsOf(fn[2]);
  if (fn[1] === 'var') {
    return args.length === 2 && VARIABLE.test(args[0]) && isColor(args[1], depth + 1);
  }
  if (fn[1] === 'color-mix') {
    const mix = /^(.*) ([\d.]+)%$/.exec(args[1] ?? '');
    return (
      args.length === 3 &&
      (args[0] === 'in oklab' || args[0] === 'in srgb') &&
      mix !== null &&
      isColor(mix[1], depth + 1) &&
      boundedNumber(mix[2], 100) &&
      args[2] === 'transparent'
    );
  }
  return (
    args.length === (fn[1] === 'rgb' ? 3 : 4) &&
    args.slice(0, 3).every((channel) => boundedNumber(channel, 255)) &&
    (fn[1] === 'rgb' || boundedNumber(args[3], 1))
  );
}

/** A bounded px metric, optionally following an inherited host design token. */
function isMetric(raw: unknown, min: number, max: number): raw is string {
  if (typeof raw !== 'string' || raw.length > 128) return false;
  const variable = /^var\((--[a-z][a-z0-9-]{0,79}), (.*)\)$/.exec(raw);
  const metric = /^(\d{1,3})px$/.exec(variable ? variable[2] : raw);
  return metric !== null && Number(metric[1]) >= min && Number(metric[1]) <= max;
}

export function readFolderSkin(raw: unknown): {
  readonly folderSkin?: FolderSkin;
  readonly issues: readonly ManifestIssue[];
} {
  if (raw === undefined) return { issues: [] };
  const issues: ManifestIssue[] = [];
  const issue = (path: string, message: string): void => {
    issues.push({ path: `folderSkin${path}`, message });
  };
  const record = (value: unknown, path: string, keys: readonly string[]) => {
    if (!isRecord(value)) {
      issue(path, 'must be an object');
      return {};
    }
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) issue(`${path}.${key}`, 'unknown token');
    }
    return value;
  };
  const skin = record(raw, '', ['rowHeight', 'rowRadius', 'light', 'dark', 'header']);
  const colors = (value: unknown, path: string): Partial<FolderSkinColors> => {
    const entries = record(value, path, COLOR_KEYS);
    const result: Partial<Record<(typeof COLOR_KEYS)[number], string>> = {};
    for (const key of COLOR_KEYS) {
      if (entries[key] === undefined) continue;
      const color = entries[key];
      if (typeof color !== 'string' || color.length > 256 || !isColor(color)) {
        issue(`${path}.${key}`, 'must be a colour, var with fallback, or colour mix');
      } else {
        result[key] = color;
      }
    }
    return result;
  };
  const light = colors(skin.light, '.light');
  const dark = colors(skin.dark, '.dark');
  for (const key of FOLDER_SKIN_COLORS) {
    if (!light[key]) issue(`.light.${key}`, 'required colour token');
  }
  if (!isMetric(skin.rowHeight, 16, 64))
    issue('.rowHeight', 'must be 16-64px or var with fallback');
  if (!isMetric(skin.rowRadius, 0, 32)) issue('.rowRadius', 'must be 0-32px or var with fallback');
  let header: FolderSkin['header'];
  if (skin.header !== undefined) {
    const value = record(skin.header, '.header', ['height', 'paddingInlineEnd']);
    const { height, paddingInlineEnd } = value;
    if (typeof height !== 'number' || !Number.isInteger(height) || height < 16 || height > 64) {
      issue('.header.height', 'must be an integer 16-64');
    }
    if (
      typeof paddingInlineEnd !== 'number' ||
      !Number.isInteger(paddingInlineEnd) ||
      paddingInlineEnd < 0 ||
      paddingInlineEnd > 128
    ) {
      issue('.header.paddingInlineEnd', 'must be an integer 0-128');
    }
    if (!light.sidebar) issue('.light.sidebar', 'required for a sticky header');
    if (typeof height === 'number' && typeof paddingInlineEnd === 'number') {
      header = { height, paddingInlineEnd };
    }
  }
  if (issues.length) return { issues };
  // Every required token and metric was checked above; no unchecked JSON escapes this boundary.
  return {
    folderSkin: {
      rowHeight: skin.rowHeight as string,
      rowRadius: skin.rowRadius as string,
      light: light as FolderSkinColors,
      dark,
      ...(header ? { header } : {}),
    },
    issues,
  };
}
