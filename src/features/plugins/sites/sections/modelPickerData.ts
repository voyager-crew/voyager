/**
 * The optional `modelPicker` section of a `site.json` (Local Bridge spec §3.5):
 * the data `model.select` reads. A broken section is reported and dropped,
 * which keeps the site usable (only `model.select` reports `unsupported-data`)
 * and makes `catalog:build` refuse to publish data no shipped client can read.
 *
 * Format 1 (measured on chatgpt.com, zh-CN, 2026-10-18):
 * - `triggerLabels`: the picker button's exact `aria-label`, per locale;
 * - `effortStatus`: the menu's `role=status` text, a template with `{label}`
 *   and optionally `{position}` / `{count}` (1-based), per locale;
 * - `models`: per model id, its radio labels and, where measured, its effort
 *   steps in slider order (index = `aria-valuenow`). The steps of all models
 *   are also the step-name vocabulary: an id's names merge across models;
 * - `presets`: CLI names (`pro`, …) for a model and one of its efforts. A
 *   preset with an effort lands on that step of whatever model the page has
 *   selected, listed here or not; its model gives only the steps' order.
 *
 * Label tables are keyed by UI locale, but the engine merges every locale:
 * a page is not always in the language its `lang` attribute claims.
 */
import type { ManifestIssue } from '../../manifest/validate';

export const MODEL_PICKER_FORMATS = [1] as const;
export type ModelPickerFormat = (typeof MODEL_PICKER_FORMATS)[number];

/** Labels per UI locale (`zh-CN`, `en`, …). */
export type LocalizedLabels = Readonly<Record<string, readonly string[]>>;

export interface ModelPickerEffort {
  readonly id: string;
  readonly labels: LocalizedLabels;
}

export interface ModelPickerModel {
  readonly labels: LocalizedLabels;
  /** Slider steps in order; absent where the steps were not measured. */
  readonly efforts?: readonly ModelPickerEffort[];
}

export interface ModelPickerPreset {
  readonly mode: 'chat';
  readonly model: string;
  readonly effort?: string;
}

export interface ModelPickerSection {
  readonly format: ModelPickerFormat;
  readonly triggerLabels: LocalizedLabels;
  readonly effortStatus: Readonly<Record<string, string>>;
  readonly models: Readonly<Record<string, ModelPickerModel>>;
  readonly presets: Readonly<Record<string, ModelPickerPreset>>;
}

export interface ModelPickerSectionRead {
  readonly modelPicker?: ModelPickerSection;
  readonly issues: readonly ManifestIssue[];
}

const ID_PATTERN = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const MAX_LABEL_LENGTH = 200;
const MAX_ENTRIES = 16;
const SECTION_KEYS = ['format', 'triggerLabels', 'effortStatus', 'models', 'presets'];
const STATUS_PLACEHOLDERS = ['{label}', '{position}', '{count}'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class Reader {
  readonly issues: ManifestIssue[] = [];

  issue(path: string, message: string): void {
    this.issues.push({ path, message });
  }

  /** A record with only `allowed` keys (all of them when omitted), or null. */
  record(raw: unknown, path: string, allowed?: readonly string[]): Record<string, unknown> | null {
    if (!isRecord(raw)) {
      this.issue(path, 'must be an object');
      return null;
    }
    const keys = Object.keys(raw);
    if (allowed) {
      for (const key of keys)
        if (!allowed.includes(key)) this.issue(`${path}.${key}`, 'unknown key');
    } else if (keys.length > MAX_ENTRIES) {
      this.issue(path, `must have at most ${MAX_ENTRIES} entries`);
    }
    return raw;
  }

  /** A non-empty map of `ID_PATTERN` keys. */
  idMap(raw: unknown, path: string): [string, unknown][] {
    const rec = this.record(raw, path);
    if (!rec) return [];
    const entries = Object.entries(rec);
    if (entries.length === 0) this.issue(path, 'must not be empty');
    for (const [id] of entries) {
      if (!ID_PATTERN.test(id)) this.issue(`${path}.${id}`, `id must match ${ID_PATTERN.source}`);
    }
    return entries;
  }

  label(raw: unknown, path: string): string {
    if (typeof raw !== 'string' || raw.trim() === '' || raw.length > MAX_LABEL_LENGTH) {
      this.issue(path, `must be a non-empty string of up to ${MAX_LABEL_LENGTH} chars`);
      return '';
    }
    return raw;
  }

  /** Per-locale values, at least one locale. */
  localized<T>(
    raw: unknown,
    path: string,
    read: (value: unknown, at: string) => T,
  ): Record<string, T> {
    const rec = this.record(raw, path);
    const out: Record<string, T> = {};
    if (!rec) return out;
    const entries = Object.entries(rec);
    if (entries.length === 0) this.issue(path, 'must name at least one locale');
    for (const [locale, value] of entries) {
      const at = `${path}.${locale}`;
      if (!LOCALE_PATTERN.test(locale)) this.issue(at, 'must be a locale such as zh-CN');
      out[locale] = read(value, at);
    }
    return out;
  }

  labels(raw: unknown, path: string): LocalizedLabels {
    return this.localized(raw, path, (value, at) => {
      if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ENTRIES) {
        this.issue(at, `must be an array of 1-${MAX_ENTRIES} labels`);
        return [];
      }
      return value.map((label, index) => this.label(label, `${at}[${index}]`));
    });
  }

  statusTemplate(raw: unknown, path: string): string {
    const template = this.label(raw, path);
    if (!template) return template;
    for (const placeholder of STATUS_PLACEHOLDERS) {
      const count = template.split(placeholder).length - 1;
      if (count > 1 || (placeholder === '{label}' && count === 0)) {
        this.issue(path, `must contain {label} once, and {position} / {count} at most once`);
        break;
      }
    }
    return template;
  }

  effort(raw: unknown, path: string): ModelPickerEffort {
    const rec = this.record(raw, path, ['id', 'labels']);
    const id = rec && typeof rec.id === 'string' && ID_PATTERN.test(rec.id) ? rec.id : '';
    if (rec && !id) this.issue(`${path}.id`, `must match ${ID_PATTERN.source}`);
    return { id, labels: this.labels(rec?.labels, `${path}.labels`) };
  }

  model(raw: unknown, path: string): ModelPickerModel {
    const rec = this.record(raw, path, ['labels', 'efforts']);
    const labels = this.labels(rec?.labels, `${path}.labels`);
    if (rec?.efforts === undefined) return { labels };
    const at = `${path}.efforts`;
    if (!Array.isArray(rec.efforts) || rec.efforts.length < 2 || rec.efforts.length > MAX_ENTRIES) {
      this.issue(at, `must be an array of 2-${MAX_ENTRIES} steps`);
      return { labels };
    }
    const efforts = rec.efforts.map((effort, index) => this.effort(effort, `${at}[${index}]`));
    const ids = efforts.map((effort) => effort.id);
    if (new Set(ids).size !== ids.length) this.issue(at, 'effort ids must be unique');
    return { labels, efforts };
  }

  preset(
    raw: unknown,
    path: string,
    models: Readonly<Record<string, ModelPickerModel>>,
  ): ModelPickerPreset {
    const rec = this.record(raw, path, ['mode', 'model', 'effort']);
    if (rec && rec.mode !== 'chat') this.issue(`${path}.mode`, 'must be "chat"');
    const model = typeof rec?.model === 'string' ? rec.model : '';
    const known = Object.hasOwn(models, model) ? models[model] : undefined;
    if (rec && !known) this.issue(`${path}.model`, 'must name a model of this section');
    if (rec?.effort === undefined) return { mode: 'chat', model };
    const effort = typeof rec.effort === 'string' ? rec.effort : '';
    if (known && !known.efforts?.some((step) => step.id === effort)) {
      this.issue(`${path}.effort`, 'must name an effort of its model');
    }
    return { mode: 'chat', model, effort };
  }
}

export function readModelPickerSection(raw: unknown, path = 'modelPicker'): ModelPickerSectionRead {
  if (raw === undefined) return { issues: [] };
  if (!isRecord(raw)) return { issues: [{ path, message: 'must be an object' }] };
  if (!MODEL_PICKER_FORMATS.some((known) => known === raw.format)) {
    return { issues: [{ path: `${path}.format`, message: 'unknown format' }] };
  }
  const reader = new Reader();
  reader.record(raw, path, SECTION_KEYS);
  const triggerLabels = reader.labels(raw.triggerLabels, `${path}.triggerLabels`);
  const effortStatus = reader.localized(raw.effortStatus, `${path}.effortStatus`, (value, at) =>
    reader.statusTemplate(value, at),
  );
  const models: Record<string, ModelPickerModel> = {};
  for (const [id, model] of reader.idMap(raw.models, `${path}.models`)) {
    models[id] = reader.model(model, `${path}.models.${id}`);
  }
  const presets: Record<string, ModelPickerPreset> = {};
  for (const [name, preset] of reader.idMap(raw.presets, `${path}.presets`)) {
    presets[name] = reader.preset(preset, `${path}.presets.${name}`, models);
  }
  if (reader.issues.length > 0) return { issues: reader.issues };
  return {
    modelPicker: {
      format: raw.format as ModelPickerFormat,
      triggerLabels,
      effortStatus,
      models,
      presets,
    },
    issues: [],
  };
}
