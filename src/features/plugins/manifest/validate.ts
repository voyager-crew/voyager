/**
 * Manifest validation + normalization.
 *
 * Plugins from a remote marketplace are UNTRUSTED input. This validator turns an
 * arbitrary `unknown` into a typed `PluginManifest` (or a list of issues),
 * normalizing authoring sugar along the way (a bare selector string becomes a
 * `{kind:'css'}` ref). Custom type guards are used instead of a schema library
 * to avoid adding a runtime dependency (the codebase has no zod).
 */
import type { Result } from '@/core/types/common';
import { FORM_FACTORS, type FormFactor, isFormFactor } from '@/core/types/formFactor';

import { MAX_DOM_OPS, PLUGIN_MANIFEST_FORMAT } from '../constants';
import type {
  DomOperation,
  LocalizedSettingField,
  PluginContributions,
  PluginLocalization,
  PluginManifest,
  PluginRequirements,
  PluginTheme,
  PluginTier,
  SettingField,
  SettingsSchema,
  StyleContribution,
} from '../types';
import { PRIMITIVE_NAME_PATTERN } from '../verbs/contracts';
import { isRecord, isString, nonEmptyString } from './jsonGuards';
import { nativeParamTemplateIssues } from './primitiveChecks';
import { readScriptContribution } from './scriptedChecks';
import { renderSettingTemplate, styleSheetIssue } from './sinkGuards';
import { normalizeOp, renderedOpIsSafe } from './validateDomOp';

export { OP_KINDS } from './validateDomOp';

const SETTING_TYPES = ['boolean', 'number', 'string', 'color', 'select'] as const;

export interface ManifestIssue {
  readonly path: string;
  readonly message: string;
}

const TIERS = ['declarative', 'scripted'] as const;
const MAX_REQUIRES_ENTRIES = 50;
const MAX_CHANGELOG_LENGTH = 500;
/** Top-level fields that must be non-empty strings. */
export const REQUIRED_STRINGS = [
  'id',
  'name',
  'version',
  'description',
  'author',
  'category',
  'license',
  'engine',
] as const;

/**
 * Accept ONLY hex colours for a plugin-declared brand. The value is injected
 * into a CSS custom property and string-concatenated into a `color-mix(...)`
 * expression at runtime, so anything other than a strict hex literal (3/4/6/8
 * digits) could break out of the value context — reject it.
 */
function isHexColor(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)
  );
}

/** Per-field cap for localized strings (UNTRUSTED input). */
const MAX_I18N_FIELD_LENGTH = 500;

function readOptionalString(
  raw: Record<string, unknown>,
  key: string,
  path: string,
  issues?: ManifestIssue[],
): string | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (nonEmptyString(value) && value.length <= MAX_I18N_FIELD_LENGTH) return value;
  issues?.push({
    path,
    message: `must be a non-empty string up to ${MAX_I18N_FIELD_LENGTH} chars`,
  });
  return undefined;
}

/**
 * A select's options and default, which the popup and the host both resolve
 * against: at least one option, unique string values ("" included), labelled,
 * and a default that is one of them.
 * Undefined, with issues, otherwise.
 */
function readSelectOptions(
  rawField: Record<string, unknown>,
  path: string,
  issues: ManifestIssue[],
): { value: string; label: string }[] | undefined {
  const raw = rawField.options;
  if (!Array.isArray(raw) || raw.length === 0) {
    issues.push({ path: `${path}.options`, message: 'required non-empty array' });
    return undefined;
  }
  const options: { value: string; label: string }[] = [];
  for (const [index, option] of raw.entries()) {
    if (!isRecord(option) || !isString(option.value) || !nonEmptyString(option.label)) {
      issues.push({
        path: `${path}.options[${index}]`,
        message: 'required { value: string, label: non-empty string }',
      });
      return undefined;
    }
    if (options.some((seen) => seen.value === option.value)) {
      issues.push({ path: `${path}.options[${index}].value`, message: 'duplicate option value' });
      return undefined;
    }
    options.push({ value: option.value, label: option.label });
  }
  if (!options.some((option) => option.value === rawField.default)) {
    issues.push({ path: `${path}.default`, message: 'must be one of the declared options' });
    return undefined;
  }
  return options;
}

function normalizeLocalizedSetting(raw: unknown): LocalizedSettingField | undefined {
  if (!isRecord(raw)) return undefined;
  const label = readOptionalString(raw, 'label', 'label');
  const minLabel = readOptionalString(raw, 'minLabel', 'minLabel');
  const maxLabel = readOptionalString(raw, 'maxLabel', 'maxLabel');
  const rawOptions = raw.options;
  const options = isRecord(rawOptions)
    ? Object.fromEntries(
        Object.keys(rawOptions).flatMap((key) => {
          const label = readOptionalString(rawOptions, key, key);
          return label ? [[key, label]] : [];
        }),
      )
    : undefined;
  const entry: LocalizedSettingField = {
    ...(label ? { label } : {}),
    ...(minLabel ? { minLabel } : {}),
    ...(maxLabel ? { maxLabel } : {}),
    ...(options && Object.keys(options).length > 0 ? { options } : {}),
  };
  return Object.keys(entry).length > 0 ? entry : undefined;
}

function normalizeLocalizedSettings(
  raw: unknown,
): Readonly<Record<string, LocalizedSettingField>> | undefined {
  if (!isRecord(raw)) return undefined;
  const settings: Record<string, LocalizedSettingField> = {};
  for (const [key, value] of Object.entries(raw)) {
    const entry = normalizeLocalizedSetting(value);
    if (entry) settings[key] = entry;
  }
  return Object.keys(settings).length > 0 ? settings : undefined;
}

/**
 * Sanitize an optional `i18n` map (UNTRUSTED). Keeps only localized metadata and
 * setting labels whose fields are non-oversized strings; drops everything else.
 * Returns undefined when nothing survives, so the field is absent on the manifest.
 */
function normalizeI18n(raw: unknown): Readonly<Record<string, PluginLocalization>> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Record<string, PluginLocalization> = {};
  for (const [locale, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const entry: {
      name?: string;
      description?: string;
      changelog?: string;
      settings?: Readonly<Record<string, LocalizedSettingField>>;
    } = {};
    // A blank localized changelog would hide the top-level one in the popup.
    if (nonEmptyString(value.changelog) && value.changelog.length <= MAX_CHANGELOG_LENGTH) {
      entry.changelog = value.changelog;
    }
    if (isString(value.name) && value.name.length <= MAX_I18N_FIELD_LENGTH) {
      entry.name = value.name;
    }
    if (isString(value.description) && value.description.length <= MAX_I18N_FIELD_LENGTH) {
      entry.description = value.description;
    }
    const settings = normalizeLocalizedSettings(value.settings);
    if (settings) entry.settings = settings;
    if (
      entry.name !== undefined ||
      entry.description !== undefined ||
      entry.changelog !== undefined ||
      entry.settings !== undefined
    )
      out[locale] = entry;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function validateStyleCss(css: string, path: string): ManifestIssue[] {
  const issue = styleSheetIssue(css);
  return issue ? [{ path, message: issue }] : [];
}

function normalizeContributions(raw: unknown, issues: ManifestIssue[]): PluginContributions {
  if (!isRecord(raw)) {
    issues.push({ path: 'contributes', message: 'required object' });
    return {};
  }
  const result: {
    styles?: StyleContribution[];
    domOps?: DomOperation[];
    settings?: SettingsSchema;
  } = {};

  if (raw.settings !== undefined) {
    if (!isRecord(raw.settings)) {
      issues.push({ path: 'contributes.settings', message: 'must be an object' });
    } else {
      const settings: Record<string, SettingField> = {};
      for (const [key, rawField] of Object.entries(raw.settings)) {
        const path = `contributes.settings.${key}`;
        if (
          !isRecord(rawField) ||
          !isString(rawField.type) ||
          !(SETTING_TYPES as readonly string[]).includes(rawField.type)
        ) {
          issues.push({
            path: `${path}.type`,
            message: `must be one of ${SETTING_TYPES.join(', ')}`,
          });
          continue;
        }
        if (!nonEmptyString(rawField.label)) {
          issues.push({ path: `${path}.label`, message: 'required non-empty string' });
          continue;
        }
        const fallback = rawField.default;
        if (
          typeof fallback !== 'boolean' &&
          typeof fallback !== 'number' &&
          typeof fallback !== 'string'
        ) {
          issues.push({ path: `${path}.default`, message: 'required boolean | number | string' });
          continue;
        }
        const selectOptions =
          rawField.type === 'select' ? readSelectOptions(rawField, path, issues) : undefined;
        if (rawField.type === 'select' && !selectOptions) continue;
        const minLabel = readOptionalString(rawField, 'minLabel', `${path}.minLabel`, issues);
        const maxLabel = readOptionalString(rawField, 'maxLabel', `${path}.maxLabel`, issues);
        const enabledBy = rawField.enabledBy;
        if (enabledBy !== undefined && !nonEmptyString(enabledBy)) {
          issues.push({ path: `${path}.enabledBy`, message: 'must be a non-empty setting key' });
        }
        settings[key] = {
          type: rawField.type as SettingField['type'],
          label: rawField.label,
          default: fallback,
          ...(nonEmptyString(enabledBy) ? { enabledBy } : {}),
          ...(minLabel ? { minLabel } : {}),
          ...(maxLabel ? { maxLabel } : {}),
          ...(typeof rawField.min === 'number' ? { min: rawField.min } : {}),
          ...(typeof rawField.max === 'number' ? { max: rawField.max } : {}),
          ...(selectOptions
            ? { options: selectOptions }
            : Array.isArray(rawField.options)
              ? {
                  options: rawField.options.filter(
                    (option): option is { value: string; label: string } =>
                      isRecord(option) && isString(option.value) && isString(option.label),
                  ),
                }
              : {}),
        };
      }
      // Resolve references after all fields are read so declaration order does not matter.
      for (const [key, field] of Object.entries(settings)) {
        if (field.enabledBy === undefined) continue;
        const path = `contributes.settings.${key}.enabledBy`;
        if (field.enabledBy === key) {
          issues.push({ path, message: 'must refer to another setting, not itself' });
        } else if (!Object.hasOwn(settings, field.enabledBy)) {
          issues.push({ path, message: 'must refer to a setting in the same plugin' });
        } else {
          const target = settings[field.enabledBy];
          if (target.type !== 'boolean') {
            issues.push({ path, message: 'must refer to a boolean setting' });
          } else if (target.enabledBy !== undefined) {
            issues.push({
              path,
              message: 'must refer to a setting without enabledBy; only one level is supported',
            });
          }
        }
      }
      result.settings = settings;
    }
  }

  // `{{setting}}` defaults are substituted after the literal checks, so a
  // default can smuggle in what the literal text may not contain. Each sink is
  // also checked rendered with the defaults; the engine repeats this for stored
  // values before every write.
  const schema = result.settings;
  const renderDefaults = (value: string): string => renderSettingTemplate(value, schema, {});

  if (raw.styles !== undefined) {
    if (!Array.isArray(raw.styles)) {
      issues.push({ path: 'contributes.styles', message: 'must be an array' });
    } else {
      const styles: StyleContribution[] = [];
      raw.styles.forEach((entry, index) => {
        if (!isRecord(entry) || !isString(entry.css)) {
          issues.push({ path: `contributes.styles[${index}].css`, message: 'required string' });
          return;
        }
        const cssIssues = validateStyleCss(entry.css, `contributes.styles[${index}].css`);
        if (cssIssues.length > 0) {
          issues.push(...cssIssues);
          return;
        }
        const renderedIssue = styleSheetIssue(renderDefaults(entry.css));
        if (renderedIssue) {
          issues.push({ path: `contributes.styles[${index}].css`, message: renderedIssue });
          return;
        }
        styles.push({
          css: entry.css,
          ...(isString(entry.source) ? { source: entry.source } : {}),
        });
      });
      result.styles = styles;
    }
  }

  if (raw.domOps !== undefined) {
    if (!Array.isArray(raw.domOps)) {
      issues.push({ path: 'contributes.domOps', message: 'must be an array' });
    } else {
      if (raw.domOps.length > MAX_DOM_OPS) {
        issues.push({ path: 'contributes.domOps', message: `exceeds max of ${MAX_DOM_OPS}` });
      }
      const ops: DomOperation[] = [];
      raw.domOps.slice(0, MAX_DOM_OPS).forEach((rawOp, index) => {
        const path = `contributes.domOps[${index}]`;
        const op = normalizeOp(rawOp, path, issues);
        if (op && renderedOpIsSafe(op, renderDefaults, path, issues)) ops.push(op);
      });
      result.domOps = ops;
    }
  }

  return result;
}

function normalizeStringList(
  raw: unknown,
  path: string,
  issues: ManifestIssue[],
): readonly string[] | undefined {
  if (raw === undefined) return undefined;
  if (
    !Array.isArray(raw) ||
    raw.length > MAX_REQUIRES_ENTRIES ||
    !raw.every((entry) => nonEmptyString(entry) && entry.length <= 100)
  ) {
    issues.push({ path, message: 'must be an array of short non-empty strings' });
    return undefined;
  }
  return Array.from(new Set(raw as string[]));
}

function normalizeRequires(raw: unknown, issues: ManifestIssue[]): PluginRequirements | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    issues.push({ path: 'requires', message: 'must be an object' });
    return undefined;
  }
  const handlers = normalizeStringList(raw.handlers, 'requires.handlers', issues);
  const semantic = normalizeStringList(raw.semantic, 'requires.semantic', issues);
  if (handlers?.some((name) => !PRIMITIVE_NAME_PATTERN.test(name))) {
    issues.push({ path: 'requires.handlers', message: 'entries must be primitive names' });
  }
  const formFactors = normalizeFormFactors(raw.formFactors, issues);
  if (!handlers && !semantic && !formFactors) return undefined;
  return {
    ...(handlers ? { handlers } : {}),
    ...(semantic ? { semantic } : {}),
    ...(formFactors ? { formFactors } : {}),
  };
}

/** A non-empty list of known device classes; an empty one would make the plugin run nowhere. */
function normalizeFormFactors(
  raw: unknown,
  issues: ManifestIssue[],
): readonly FormFactor[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every(isFormFactor)) {
    issues.push({
      path: 'requires.formFactors',
      message: `must be a non-empty array of ${FORM_FACTORS.join(', ')}`,
    });
    return undefined;
  }
  return FORM_FACTORS.filter((formFactor) => raw.includes(formFactor));
}

export interface ValidateManifestOptions {
  /** Admit `tier: "scripted"` with its `contributes.script`. Only the local gate passes it. */
  readonly allowScripted?: boolean;
}

export function validateManifest(
  input: unknown,
  options: ValidateManifestOptions = {},
): Result<PluginManifest, ManifestIssue[]> {
  if (!isRecord(input)) {
    return { success: false, error: [{ path: '', message: 'manifest must be an object' }] };
  }
  const issues: ManifestIssue[] = [];

  if (input.format !== undefined && input.format !== PLUGIN_MANIFEST_FORMAT) {
    issues.push({
      path: 'format',
      message: `unsupported manifest format (expected ${PLUGIN_MANIFEST_FORMAT})`,
    });
  }
  const requires = normalizeRequires(input.requires, issues);
  let changelog: string | undefined;
  if (input.changelog !== undefined) {
    if (nonEmptyString(input.changelog) && input.changelog.length <= MAX_CHANGELOG_LENGTH) {
      changelog = input.changelog;
    } else {
      issues.push({
        path: 'changelog',
        message: `must be a non-empty string up to ${MAX_CHANGELOG_LENGTH} chars`,
      });
    }
  }

  for (const key of REQUIRED_STRINGS) {
    if (!nonEmptyString(input[key]))
      issues.push({ path: key, message: 'required non-empty string' });
  }
  if (!isString(input.tier) || !(TIERS as readonly string[]).includes(input.tier)) {
    issues.push({ path: 'tier', message: `must be one of ${TIERS.join(', ')}` });
  }
  if (
    !Array.isArray(input.matches) ||
    input.matches.length === 0 ||
    !input.matches.every(nonEmptyString)
  ) {
    issues.push({ path: 'matches', message: 'must be a non-empty array of non-empty strings' });
  }

  const contributes = normalizeContributions(input.contributes, issues);
  const script = readScriptContribution(input, options.allowScripted === true, issues);

  let theme: PluginTheme | undefined;
  if (input.theme !== undefined) {
    if (!isRecord(input.theme) || !isHexColor(input.theme.brand)) {
      issues.push({ path: 'theme.brand', message: 'must be a hex colour string (e.g. #d97757)' });
    } else {
      theme = { brand: input.theme.brand };
    }
  }

  const i18n = normalizeI18n(input.i18n);

  if (issues.length > 0) return { success: false, error: issues };

  const manifest: PluginManifest = {
    id: input.id as string,
    name: input.name as string,
    version: input.version as string,
    description: input.description as string,
    author: input.author as string,
    category: input.category as string,
    license: input.license as string,
    homepage: isString(input.homepage) ? input.homepage : undefined,
    engine: input.engine as string,
    tier: input.tier as PluginTier,
    matches: (input.matches as string[]).slice(),
    contributes: script ? { ...contributes, script } : contributes,
    ...(theme ? { theme } : {}),
    ...(typeof input.format === 'number' ? { format: input.format } : {}),
    ...(requires ? { requires } : {}),
    ...(changelog ? { changelog } : {}),
    ...(i18n ? { i18n } : {}),
  };
  const templateIssues = nativeParamTemplateIssues(manifest);
  if (templateIssues.length > 0) return { success: false, error: templateIssues };
  return { success: true, data: manifest };
}
