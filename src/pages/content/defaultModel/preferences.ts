import { storageService } from '../../../core/services/StorageService';
import { StorageKeys } from '../../../core/types/common';

export type DefaultModelSetting =
  | { kind: 'id'; id: string; name: string; pill?: string }
  | { kind: 'name'; name: string; pill?: string };

// `pill` is the short label Gemini renders on the trigger ("Flash") for this
// model. It is learned from the page, never typed by the user — see
// `rememberTriggerPillLabel`.
type StoredDefaultModelSetting = { id: string; name: string; pill?: string };

export type ThinkingMode = 'standard' | 'extended';

// Older Gemini variants exposed a Standard / Extended submenu. The current
// picker exposes only an opt-in Extended thinking row, so keep the positional
// fields for compatibility and persist a semantic mode for the new toggle.
export type DefaultThinkingLevel = { index: number; label: string; mode?: ThinkingMode };

// Known Flash/Fast model IDs that should skip auto-selection (page defaults to these)
const FAST_MODEL_IDS = new Set([
  '56fdd199312815e2', // Gemini 2.0 Flash
]);

// Generic Flash/Fast labels that Gemini already opens with. Specific variants
// like "3.5 Flash" or "3.1 Flash-Lite" must still open the picker and confirm.
const FAST_MODEL_NAMES = new Set(['flash', 'fast', '高速', '高速モード']);

export class DefaultModelPreferences {
  private cachedModel: DefaultModelSetting | null = null;
  private cachedThinking: DefaultThinkingLevel | null = null;
  private autoApplyEnabled = true;

  public get model(): DefaultModelSetting | null {
    return this.cachedModel;
  }

  public get thinking(): DefaultThinkingLevel | null {
    return this.cachedThinking;
  }

  public get enabled(): boolean {
    return this.autoApplyEnabled;
  }

  public async load(): Promise<void> {
    await this.reloadDefaults();
    const result = await storageService.get<unknown>(StorageKeys.DEFAULT_MODEL_AUTO_APPLY);
    // Missing key remains enabled for existing users.
    this.autoApplyEnabled = !result.success || result.data !== false;
  }

  public async reloadDefaults(): Promise<{
    model: DefaultModelSetting | null;
    thinking: DefaultThinkingLevel | null;
  }> {
    const result = await storageService.get<unknown>(StorageKeys.DEFAULT_MODEL);
    const model = result.success ? this.parseStoredDefaultModel(result.data) : null;
    this.cachedModel = model;
    const thinkingResult = await storageService.get<unknown>(StorageKeys.DEFAULT_THINKING_LEVEL);
    const thinking = thinkingResult.success
      ? this.parseStoredThinkingLevel(thinkingResult.data)
      : null;
    this.cachedThinking = thinking;
    return { model, thinking };
  }

  public async persistModel(model: DefaultModelSetting | null): Promise<void> {
    this.cachedModel = model;
    if (!model) {
      await storageService.remove(StorageKeys.DEFAULT_MODEL);
    } else if (model.kind === 'id') {
      const toStore: StoredDefaultModelSetting = { id: model.id, name: model.name };
      await storageService.set(StorageKeys.DEFAULT_MODEL, toStore);
    } else {
      await storageService.set(StorageKeys.DEFAULT_MODEL, model.name);
    }
  }

  public async persistThinking(thinking: DefaultThinkingLevel | null): Promise<void> {
    this.cachedThinking = thinking;
    if (!thinking) {
      await storageService.remove(StorageKeys.DEFAULT_THINKING_LEVEL);
    } else {
      await storageService.set(StorageKeys.DEFAULT_THINKING_LEVEL, thinking);
    }
  }

  /**
   * Gemini names a model "3.8 Flash" in the picker but labels the trigger pill
   * "Flash", and nothing in the DOM links the two. `modelMatchesLines` refuses
   * to accept a bare "Flash" pill for a specific Flash variant — otherwise the
   * generic label would satisfy any of them — so such a default could never be
   * confirmed from the pill, and every new chat had to open the picker just to
   * read the row's selected state.
   *
   * The menu we already have open answers it authoritatively: this row carries
   * the stored model's id and Gemini marks it selected, so whatever the pill
   * reads right now IS that model's label. Record it, and the next fast-path
   * check confirms without opening anything. A Gemini rename only costs one
   * confirming open: the stale label stops matching and is replaced here.
   *
   * Learning the label is also the moment a legacy name-only default (older
   * builds stored just the string) gains the row's stable id.
   */
  public async rememberTriggerPillLabel(
    target: DefaultModelSetting,
    selected: { name: string; id: string | null; pill?: string },
  ): Promise<void> {
    const pill = selected.pill?.trim();
    if (!pill) return;

    // `data-mode-id` is the stable slot — the id that reads "3.8 Flash" today
    // is the one FAST_MODEL_IDS still documents as "Gemini 2.0 Flash" — so a
    // row matched by id can legitimately carry a renamed label. Take the name
    // from the row we just confirmed, which keeps a starred default readable
    // ("3.8 Flash" → "3.9 Flash") instead of freezing the name it was starred
    // under.
    const rowName = selected.name.trim();
    const name = rowName || target.name;

    // Only learn a label that reads as this model's own short form
    // ("Flash" for "3.8 Flash"). A pill that says something else is either a
    // stale render or a layout we do not understand; trusting it would teach
    // the fast path to confirm the wrong model on every later chat.
    if (!this.isWordBoundedIn(pill, name)) return;

    const id = target.kind === 'id' ? target.id : selected.id;
    if (target.pill === pill && target.name === name && (target.kind === 'id' || !id)) return;

    this.cachedModel = id ? { kind: 'id', id, name, pill } : { kind: 'name', name, pill };

    // Only the id form is persistable. A variant without `data-mode-id` keeps
    // the label for this page rather than inventing a storage shape for it.
    if (!id) return;

    const toStore: StoredDefaultModelSetting = { id, name, pill };
    try {
      await storageService.set(StorageKeys.DEFAULT_MODEL, toStore);
    } catch (e) {
      console.error('[Gemini Voyager] Failed to persist the model trigger label', e);
    }
  }

  private parseStoredThinkingLevel(value: unknown): DefaultThinkingLevel | null {
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    const index = typeof record.index === 'number' ? record.index : NaN;
    const label = typeof record.label === 'string' ? record.label.trim() : '';
    if (!Number.isFinite(index) || index < 0 || !label) return null;
    const mode = record.mode === 'standard' || record.mode === 'extended' ? record.mode : undefined;
    return { index, label, ...(mode ? { mode } : {}) };
  }

  private parseStoredDefaultModel(value: unknown): DefaultModelSetting | null {
    if (typeof value === 'string') {
      const name = value.trim();
      return name.length ? { kind: 'name', name } : null;
    }

    if (this.isStoredDefaultModelSetting(value)) {
      const id = value.id.trim();
      const name = value.name.trim();
      if (!id.length || !name.length) return null;
      const pill = typeof value.pill === 'string' ? value.pill.trim() : '';
      return pill.length ? { kind: 'id', id, name, pill } : { kind: 'id', id, name };
    }

    return null;
  }

  private isStoredDefaultModelSetting(value: unknown): value is StoredDefaultModelSetting {
    if (typeof value !== 'object' || value === null) return false;
    const record = value as Record<string, unknown>;
    return typeof record.id === 'string' && typeof record.name === 'string';
  }

  /**
   * Standard is Gemini's built-in default thinking level. The label must be
   * authoritative here: Firefox's compact picker can expose only
   * "Extended thinking", making that non-default choice index 0 (#808).
   */
  public isPageDefaultThinkingLevel(thinking: DefaultThinkingLevel | null): boolean {
    if (!thinking) return false;
    if (thinking.mode) return thinking.mode === 'standard';
    return thinking.label.toLowerCase().trim() === 'standard';
  }

  /**
   * Check if the given model is a Flash/Fast model (Gemini's default model).
   * If yes, we don't need to auto-switch since the page already defaults to it.
   */
  public isFastModel(model: DefaultModelSetting): boolean {
    if (model.kind === 'id') {
      return FAST_MODEL_IDS.has(model.id);
    }
    const normalizedName = model.name.toLowerCase().trim();
    return FAST_MODEL_NAMES.has(normalizedName);
  }

  public modelMatchesLines(target: DefaultModelSetting, lines: string[]): boolean {
    if (!lines.length) return false;
    const modelLine = lines[0].toLowerCase().trim();
    const targetName = target.name.toLowerCase().trim();
    if (!targetName || !modelLine) return false;
    const wholeWordIn = (needle: string, haystack: string) =>
      this.isWordBoundedIn(needle, haystack);
    if (modelLine === targetName) return true;
    if (wholeWordIn(targetName, modelLine)) return true;
    // A pill label learned while this exact model was Gemini's selected row is
    // proof, not a guess: it is the only thing that can tell "Flash" (the pill
    // for 3.8 Flash) apart from "Flash" (the generic label the guard below
    // refuses to trust). See `rememberTriggerPillLabel`.
    const learnedPill = target.pill?.toLowerCase().trim();
    if (learnedPill && modelLine === learnedPill) return true;
    // Gemini's trigger pill shows the short variant ("Pro", "Flash") while menu items
    // expose the full variant ("3.1 Pro", "3 Flash") that we persisted. Accept the
    // reverse direction (line is a word-bounded substring of the stored name) so the
    // fast-path correctly recognises "Pro" === stored "3.1 Pro" and stops re-clicking.
    if (['flash', 'fast'].includes(modelLine) && modelLine !== targetName) return false;
    if (modelLine.length >= 2 && wholeWordIn(modelLine, targetName)) return true;
    return false;
  }

  /**
   * Semantic mode of a row in a multi-row thinking list. The first row is
   * Gemini's implicit level (Standard, now Low: the pill shows no thinking line
   * there) and the last is the deepest (Extended, now High). Middle rows such
   * as Medium have no legacy equivalent and are matched by label.
   */
  public thinkingModeForRow(index: number, count: number): ThinkingMode | undefined {
    if (count === 1 || index === count - 1) return 'extended';
    return index === 0 ? 'standard' : undefined;
  }

  /**
   * Resolve the single row a stored thinking default points at. The label is
   * the stable key; otherwise the semantic mode, then the legacy positional
   * index, where any non-first index meant Extended (the deepest row).
   */
  public resolveThinkingRowIndex(labels: string[], target: DefaultThinkingLevel | null): number {
    if (!target || !labels.length) return -1;
    const targetLabel = target.label.toLowerCase().trim();
    const byLabel = labels.findIndex((label) => label.toLowerCase().trim() === targetLabel);
    if (byLabel !== -1) return byLabel;
    const last = labels.length - 1;
    if (target.mode) return target.mode === 'extended' ? last : 0;
    return target.index > 0 ? last : 0;
  }

  public thinkingMatchesLines(target: DefaultThinkingLevel, lines: string[]): boolean {
    // Gemini omits the thinking-level line in the trigger pill when at Standard.
    // Index 0 is not sufficient: compact pickers may contain only Extended.
    if (lines.length < 2) {
      return this.isPageDefaultThinkingLevel(target);
    }
    const thinkingLine = lines.slice(1).join(' ').toLowerCase().trim();
    return thinkingLine === target.label.toLowerCase().trim();
  }

  private isWordBoundedIn(needle: string, haystack: string): boolean {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\b)${escaped}(\\b|$)`, 'i').test(haystack);
  }

  public watchAutoApply(onChange: (enabled: boolean) => void): () => void {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'sync' && area !== 'local') return;
      const change = changes[StorageKeys.DEFAULT_MODEL_AUTO_APPLY];
      if (!change) return;
      const next = change.newValue !== false; // missing/true → enabled
      if (next === this.enabled) return;
      this.autoApplyEnabled = next;
      onChange(next);
    };
    try {
      chrome.storage.onChanged.addListener(listener);
    } catch {
      // chrome.storage may be unavailable in certain test contexts; safe to ignore.
    }
    return () => {
      try {
        chrome.storage.onChanged.removeListener(listener);
      } catch {
        // Extension context may have been invalidated.
      }
    };
  }
}
