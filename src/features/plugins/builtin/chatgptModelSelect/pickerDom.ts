import { hasVoyagerOwner } from '@/core/gemini/composer/ownedInput';
import { getSiteSelectorView } from '@/core/selectors';
import { chatgptPageData } from '@/features/plugins/builtin/chatgptPageData';
import chatgptSite from '@/features/plugins/catalog/sites/chatgpt/site.json';
/**
 * Read-only views of ChatGPT's chat-mode model picker, measured on chatgpt.com
 * (zh-CN) on 2026-10-18. Structure comes from ARIA and ChatGPT's own data
 * attributes; localized strings come from the site data (`modelPicker`) and
 * are never the only evidence:
 * - the trigger is a `button[aria-haspopup=menu]` in the composer form marked
 *   `data-composer-navigation-target="reasoning"`, else one whose `aria-label`
 *   is a `triggerLabels` entry;
 * - its menu is found only through the trigger's `aria-controls`: Voyager's
 *   own export menu is another `role=menu` on the same page;
 * - inside it, `role=menuitemradio` radios (in a collapsed, `aria-hidden`
 *   sub-panel) name the model, one `role=slider` holds the effort step, and
 *   `role=status` names that step;
 * - a tab that was never shown can render the slider's row
 *   (`data-reasoning-slider`) without the `role=slider` inside it (measured on
 *   a bridge tab opened in the background). The row takes the same arrow keys,
 *   and its status says the step as two numbers, its place and the count of
 *   steps, in every UI language: those stand in for the slider then.
 */
import type { ModelPickerSection } from '@/features/plugins/sites/sections/modelPickerData';
import { isRendered } from '@/pages/content/export/adapter/chatgptThread';

export interface PickerRadio {
  readonly label: string;
  readonly checked: boolean;
}

export interface PickerSlider {
  readonly element: HTMLElement;
  readonly now: number;
  readonly min: number;
  readonly max: number;
}

export interface PickerStatus {
  readonly text: string;
  readonly label: string | null;
  /** 1-based, when the template carries it. */
  readonly position: number | null;
}

export interface PickerReading {
  readonly radios: readonly PickerRadio[];
  readonly slider: PickerSlider | null;
  readonly status: PickerStatus;
}

export function normalizeLabel(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Every locale's labels, normalized: a page is not always in the language it claims. */
export function mergedLabels(table: Readonly<Record<string, readonly string[]>>): Set<string> {
  return new Set(Object.values(table).flatMap((labels) => labels.map(normalizeLabel)));
}

/**
 * ChatGPT's marker on the picker trigger, the same in every UI language, as
 * measured. It is the baseline; an online replacement also needs the native accessible name.
 */
const DEFAULT_TRIGGER_MARKER = chatgptSite.pageHooks.modelPickerTrigger;

function triggerLabel(button: HTMLElement): string {
  const ids = button.getAttribute('aria-labelledby')?.split(/\s+/) ?? [];
  const labelled = ids
    .map((id) => button.ownerDocument.getElementById(id)?.textContent ?? '')
    .join(' ');
  return normalizeLabel(button.getAttribute('aria-label') ?? labelled);
}

/** The one rendered picker trigger in `scope`, else null (none, or ambiguous). */
export function findTrigger(scope: ParentNode, data: ModelPickerSection): HTMLElement | null {
  const view = getSiteSelectorView('chatgpt');
  if (view.remoteKeys.has('modelPicker.trigger')) {
    const selector = view.profiles['modelPicker.trigger'].join(',');
    const candidates = Array.from(scope.querySelectorAll<HTMLElement>(selector)).filter(isRendered);
    const labels = mergedLabels(data.triggerLabels);
    const candidate = candidates[0];
    const native = Array.from(scope.querySelectorAll<HTMLElement>(DEFAULT_TRIGGER_MARKER)).filter(
      isRendered,
    );
    // A model label and native menu semantics identify the control before any click occurs.
    if (
      candidates.length === 1 &&
      !hasVoyagerOwner(candidate) &&
      candidate.matches('button[aria-haspopup="menu"], [role="button"][aria-haspopup="menu"]') &&
      !!candidate.closest('form') &&
      labels.has(triggerLabel(candidate)) &&
      (!native.length || (native.length === 1 && native[0] === candidate))
    )
      return candidate;
  }
  // The aria-label is translated into each of ChatGPT's UI languages; the marker is not.
  const marked = Array.from(scope.querySelectorAll<HTMLElement>(DEFAULT_TRIGGER_MARKER)).filter(
    isRendered,
  );
  if (marked.length > 0) return marked.length === 1 ? marked[0] : null;
  const labels = mergedLabels(data.triggerLabels);
  const found = Array.from(
    scope.querySelectorAll<HTMLElement>(chatgptPageData.pickerLabelledTrigger),
  ).filter(
    (button) =>
      labels.has(normalizeLabel(button.getAttribute('aria-label') ?? '')) && isRendered(button),
  );
  return found.length === 1 ? found[0] : null;
}

/** The trigger's own open menu, never another `role=menu` on the page. */
export function findOpenMenu(trigger: HTMLElement): HTMLElement | null {
  if (trigger.getAttribute('aria-expanded') !== 'true') return null;
  const id = trigger.getAttribute('aria-controls');
  const menu = id ? document.getElementById(id) : null;
  return menu?.getAttribute('role') === 'menu' ? menu : null;
}

/** The trigger's text without its `aria-hidden` caption; recorded, never evidence. */
export function triggerText(trigger: HTMLElement): string {
  const copy = trigger.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return normalizeLabel(copy.textContent ?? '');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `effortStatus` templates as patterns: `{label}` is text, `{position}` / `{count}` digits. */
function statusPatterns(data: ModelPickerSection): { regex: RegExp; groups: string[] }[] {
  return Object.values(data.effortStatus).map((template) => {
    const groups: string[] = [];
    const source = normalizeLabel(template)
      .split(/(\{label\}|\{position\}|\{count\})/)
      .map((part) => {
        if (part === '{label}' || part === '{position}' || part === '{count}') {
          groups.push(part);
          return part === '{label}' ? '(.+?)' : '(\\d+)';
        }
        return escapeRegExp(part);
      })
      .join('');
    return { regex: new RegExp(`^${source}$`), groups };
  });
}

export function readStatus(menu: HTMLElement, data: ModelPickerSection): PickerStatus {
  const text = normalizeLabel(menu.querySelector('[role="status"]')?.textContent ?? '');
  for (const { regex, groups } of statusPatterns(data)) {
    const match = regex.exec(text);
    if (!match) continue;
    const value = (name: string): string | undefined => {
      // A template may leave a placeholder out; index -1 would read the whole match.
      const at = groups.indexOf(name);
      return at < 0 ? undefined : match[at + 1];
    };
    const position = value('{position}');
    return {
      text,
      label: normalizeLabel(value('{label}') ?? ''),
      position: position === undefined ? null : Number(position),
    };
  }
  return { text, label: null, position: null };
}

/**
 * ChatGPT's marker on the effort row, the same in every UI language, as
 * measured. The row can be located online; its slider/status and arrow-key protocol stay packaged.
 */
const DEFAULT_EFFORT_CONTROL = chatgptSite.pageHooks.effortControl;

/** The step a status names by its two numbers (place, count), in either order; else null. */
export function statusStep(text: string): { readonly now: number; readonly max: number } | null {
  const numbers = (text.match(/\d+/g) ?? []).map(Number);
  if (numbers.length !== 2) return null;
  const position = Math.min(numbers[0], numbers[1]);
  const count = Math.max(numbers[0], numbers[1]);
  return position >= 1 ? { now: position - 1, max: count - 1 } : null;
}

/** The effort row standing in for a slider that did not render; null unless it is unambiguous. */
function rowSlider(menu: HTMLElement, control: string, status: PickerStatus): PickerSlider | null {
  const rows = menu.querySelectorAll<HTMLElement>(control);
  if (rows.length !== 1) return null;
  const step = statusStep(status.text);
  // The site data's template, when it matched, names the place too: the two must agree.
  if (!step || (status.position !== null && status.position - 1 !== step.now)) return null;
  return { element: rows[0], now: step.now, min: 0, max: step.max };
}

function readNumber(element: Element, name: string): number | null {
  const raw = element.getAttribute(name);
  if (raw === null || !/^\d{1,3}$/.test(raw.trim())) return null;
  return Number(raw);
}

export function readPicker(menu: HTMLElement, data: ModelPickerSection): PickerReading {
  const radios = Array.from(menu.querySelectorAll('[role="menuitemradio"]')).map((radio) => ({
    label: normalizeLabel(radio.textContent ?? ''),
    checked: radio.getAttribute('aria-checked') === 'true',
  }));
  const sliders = menu.querySelectorAll<HTMLElement>('[role="slider"]');
  let slider: PickerSlider | null = null;
  if (sliders.length === 1) {
    const element = sliders[0];
    const now = readNumber(element, 'aria-valuenow');
    const min = readNumber(element, 'aria-valuemin');
    const max = readNumber(element, 'aria-valuemax');
    if (now !== null && min !== null && max !== null) slider = { element, now, min, max };
  }
  const status = readStatus(menu, data);
  if (sliders.length === 0) {
    const view = getSiteSelectorView('chatgpt');
    const native = rowSlider(menu, DEFAULT_EFFORT_CONTROL, status);
    slider = native;
    if (view.remoteKeys.has('modelPicker.effort')) {
      const repaired = rowSlider(menu, view.profiles['modelPicker.effort'].join(','), status);
      const row = repaired?.element;
      const keys = row?.getAttribute('aria-keyshortcuts')?.split(/\s+/) ?? [];
      // The row must advertise the same native keyboard protocol as the missing slider.
      if (
        row &&
        !hasVoyagerOwner(row) &&
        row.getAttribute('role') === 'menuitem' &&
        keys.includes('ArrowLeft') &&
        keys.includes('ArrowRight') &&
        (!native || native.element === row)
      )
        slider = repaired;
    }
  }
  return { radios, slider, status };
}
