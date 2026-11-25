/**
 * What `model.select` asks of the picker, and where on the page's slider that lands.
 *
 * ChatGPT renames and adds models often ("Latest" appeared 2026-11-24, then GPT-6.2),
 * while the step names stay a small vocabulary (Instant, Medium, High, Extra High, Pro).
 * So a preset names a step, not a model: it lands on that step of whatever model the
 * page has selected, as long as that model's slider names the step. Model names are
 * display-only; only a caller naming a model (restoring a captured selection) needs that
 * model selected.
 *
 * The vocabulary is the site data's `efforts`: a step id's names are merged across every
 * model that lists it, and their order is the preset's model's steps (format 1 has no
 * separate vocabulary key, and a new key would drop the section in shipped clients).
 */
import type { ModelTarget } from '@/features/bridge/protocol';
import type { OpContext } from '@/features/plugins/builtin/chatgptLocalBridge/opContext';
import type {
  ModelPickerEffort,
  ModelPickerSection,
} from '@/features/plugins/sites/sections/modelPickerData';

import { mergedLabels } from './pickerDom';

export type ResolvedTarget =
  /** A model the caller named: it must be the selected one. Null index: the model only. */
  | { readonly kind: 'model'; readonly modelId: string; readonly effortIndex: number | null }
  /** A preset's step on whatever model is selected; `order` is the vocabulary's step ids. */
  | { readonly kind: 'step'; readonly step: string; readonly order: readonly string[] };

/** Expand a target through the site data; fails before any page event. */
export function resolveTarget(
  ctx: OpContext,
  data: ModelPickerSection,
  target: ModelTarget,
): ResolvedTarget {
  let modelId: string;
  let effort: string | undefined;
  let effortIndex: number | undefined;
  const fromPreset = 'preset' in target;
  if ('preset' in target) {
    const preset = Object.hasOwn(data.presets, target.preset) ? data.presets[target.preset] : null;
    if (!preset) {
      ctx.fail('bad-request', `The site data has no model preset "${target.preset}".`, {
        presets: Object.keys(data.presets),
      });
    }
    modelId = preset.model;
    effort = preset.effort;
  } else {
    modelId = target.model;
    if ('effortIndex' in target) effortIndex = target.effortIndex;
    else effort = target.effort;
  }
  const model = Object.hasOwn(data.models, modelId) ? data.models[modelId] : null;
  if (!model) {
    ctx.fail('model-not-found', `The site data knows no model "${modelId}".`, {
      models: Object.keys(data.models),
    });
  }
  if (effort !== undefined) {
    const order = model.efforts?.map((step) => step.id) ?? [];
    const index = order.indexOf(effort);
    if (index < 0) {
      ctx.fail('effort-unavailable', `The site data has no effort "${effort}" for ${modelId}.`, {
        efforts: order,
      });
    }
    return fromPreset
      ? { kind: 'step', step: effort, order }
      : { kind: 'model', modelId, effortIndex: index };
  }
  if (effortIndex !== undefined && !model.efforts) {
    ctx.fail('effort-unavailable', `The site data has no effort steps for ${modelId}.`);
  }
  return { kind: 'model', modelId, effortIndex: effortIndex ?? null };
}

/** A step id's names across every model of the site data. */
export function stepLabels(data: ModelPickerSection, id: string): Set<string> {
  const table: Record<string, string[]> = {};
  for (const model of Object.values(data.models)) {
    for (const effort of model.efforts ?? []) {
      if (effort.id !== id) continue;
      for (const [locale, labels] of Object.entries(effort.labels)) {
        table[locale] = [...(table[locale] ?? []), ...labels];
      }
    }
  }
  return mergedLabels(table);
}

/** Whether a step name fits step `goal`: the position decides, a name only vetoes as another step's. */
function stepNamer(
  efforts: readonly ModelPickerEffort[],
  goal: number,
): (label: string | null) => boolean {
  const labels = mergedLabels(efforts[goal].labels);
  const otherLabels = new Set(
    efforts.flatMap((step, index) => (index === goal ? [] : [...mergedLabels(step.labels)])),
  );
  return (label) => label === null || labels.has(label) || !otherLabels.has(label);
}

export interface PageGoal {
  /** The target's `aria-valuenow`. */
  readonly goal: number;
  /** Whether a step name (status or closed trigger) is no proof against the goal. */
  readonly named: (label: string | null) => boolean;
  /** The goal step's names in the site data. */
  readonly labels: ReadonlySet<string>;
}

export interface SliderSpan {
  readonly now: number;
  readonly min: number;
  readonly max: number;
}

/** The steps the site data gives model `id`, when they are the page's slider's steps. */
function measuredSteps(
  data: ModelPickerSection,
  id: string | null,
  slider: SliderSpan,
): readonly ModelPickerEffort[] | null {
  const efforts = id === null ? undefined : data.models[id]?.efforts;
  return efforts && slider.min === 0 && slider.max === efforts.length - 1 ? efforts : null;
}

/**
 * Where `target` lands on the open slider, else null (`effort-unavailable`).
 *
 * - A model with steps measured in the site data, and as many on the page, goes by
 *   position; a name there only vetoes as another step's (a zh-CN page may say
 *   "Extra High", and other UI languages are not in the data).
 * - Any other model goes by name: the status names the current step, its place in the
 *   vocabulary gives the distance to the target, and the target must then be named as
 *   itself. An unnamed status, or a target off the slider, lands nowhere.
 */
export function goalOnPage(
  data: ModelPickerSection,
  target: ResolvedTarget,
  selectedId: string | null,
  slider: SliderSpan,
  statusLabel: string | null,
): PageGoal | null {
  if (target.kind === 'model') {
    const efforts = measuredSteps(data, target.modelId, slider);
    const goal = target.effortIndex;
    if (!efforts || goal === null || goal > slider.max) return null;
    return { goal, named: stepNamer(efforts, goal), labels: mergedLabels(efforts[goal].labels) };
  }
  const efforts = measuredSteps(data, selectedId, slider);
  const index = efforts?.findIndex((step) => step.id === target.step) ?? -1;
  if (efforts && index >= 0) {
    return {
      goal: index,
      named: stepNamer(efforts, index),
      labels: mergedLabels(efforts[index].labels),
    };
  }
  const here =
    statusLabel === null
      ? -1
      : target.order.findIndex((id) => stepLabels(data, id).has(statusLabel));
  if (here < 0 || slider.min !== 0) return null;
  const goal = slider.now + target.order.indexOf(target.step) - here;
  if (goal < 0 || goal > slider.max) return null;
  const labels = stepLabels(data, target.step);
  return { goal, named: (label) => label !== null && labels.has(label), labels };
}
