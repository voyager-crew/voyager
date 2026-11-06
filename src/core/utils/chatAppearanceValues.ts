/**
 * Ranges, defaults and the one reading rule for Gemini's chat appearance
 * settings (chat and edit input width, font size, line height, paragraph
 * spacing).
 *
 * The native modules, the packaged official plugins' value bindings and the
 * chat width plugin handler all read stored values through these functions,
 * so a stored value renders the same whoever runs the feature. The rule:
 * anything that is not a finite number reads as the default; a number is
 * rounded, then clamped to its range.
 */

export interface ChatAppearanceRange {
  readonly min: number;
  readonly max: number;
  readonly default: number;
}

export const CHAT_WIDTH_PERCENT: ChatAppearanceRange = { min: 30, max: 100, default: 70 };
export const EDIT_INPUT_WIDTH_PERCENT: ChatAppearanceRange = { min: 30, max: 100, default: 60 };
export const CHAT_FONT_SIZE_PERCENT: ChatAppearanceRange = { min: 80, max: 150, default: 100 };
export const CHAT_LINE_HEIGHT_PERCENT: ChatAppearanceRange = { min: 120, max: 220, default: 160 };
export const CHAT_PARAGRAPH_SPACING_PX: ChatAppearanceRange = { min: 0, max: 24, default: 12 };

/** Both widths were once stored in px against this content width; such values are above 100. */
const LEGACY_WIDTH_BASELINE_PX = 1200;

function clampRounded(value: number, range: ChatAppearanceRange): number {
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

function normalizeIn(range: ChatAppearanceRange, stored: unknown): number {
  if (typeof stored !== 'number' || !Number.isFinite(stored)) return range.default;
  return clampRounded(stored, range);
}

function normalizeWidthPercent(range: ChatAppearanceRange, stored: unknown): number {
  if (typeof stored !== 'number' || !Number.isFinite(stored)) return range.default;
  if (stored > range.max) {
    return clampRounded((stored / LEGACY_WIDTH_BASELINE_PX) * 100, range);
  }
  return clampRounded(stored, range);
}

export function normalizeChatWidthPercent(stored: unknown): number {
  return normalizeWidthPercent(CHAT_WIDTH_PERCENT, stored);
}

export function normalizeEditInputWidthPercent(stored: unknown): number {
  return normalizeWidthPercent(EDIT_INPUT_WIDTH_PERCENT, stored);
}

export function normalizeChatFontSizePercent(stored: unknown): number {
  return normalizeIn(CHAT_FONT_SIZE_PERCENT, stored);
}

export function normalizeChatLineHeightPercent(stored: unknown): number {
  return normalizeIn(CHAT_LINE_HEIGHT_PERCENT, stored);
}

export function normalizeParagraphSpacingPx(stored: unknown): number {
  return normalizeIn(CHAT_PARAGRAPH_SPACING_PX, stored);
}

/**
 * Whether a stored chat width differs from the default. Before the width had
 * its own switch, a customized width meant "on"; the switch is derived from
 * this when it has never been stored.
 */
export function isCustomizedChatWidth(stored: unknown): boolean {
  return (
    typeof stored === 'number' && normalizeChatWidthPercent(stored) !== CHAT_WIDTH_PERCENT.default
  );
}

/** The same upgrade rule for the edit input width, whose switch also came after its slider. */
export function isCustomizedEditInputWidth(stored: unknown): boolean {
  return (
    typeof stored === 'number' &&
    normalizeEditInputWidthPercent(stored) !== EDIT_INPUT_WIDTH_PERCENT.default
  );
}

export interface ChatWidthSwitchInput {
  /** `gvChatWidthEnabled` as stored; `undefined` when it has never been stored or was removed. */
  readonly storedSwitch: unknown;
  /** `geminiChatWidth` as stored. */
  readonly storedWidth: unknown;
  /** Whether `gvChatWidthEnabled` changed (a removal included) while this page lived. */
  readonly switchChangedLive: boolean;
  /** Whether `geminiChatWidth` changed while this page lived. */
  readonly widthChangedLive: boolean;
}

/**
 * Whether the chat width feature is on, as the native module decides it.
 *
 * A stored switch decides alone (`=== true`). A switch never stored follows
 * the width the page first read: a customized width meant "on" before the
 * switch existed. That holds only for the first read: the native module
 * decides once, so a switch deleted while the page lives reads off, and so
 * does a missing switch once the width has changed live (the module had
 * already decided from the earlier width, and a customized one would have
 * stored the switch as on).
 */
export function isChatWidthSwitchOn(input: ChatWidthSwitchInput): boolean {
  return isWidthSwitchOn(input, isCustomizedChatWidth);
}

/**
 * Whether the edit input width feature is on, as its native module decided:
 * the chat width rule over `gvEditInputWidthEnabled` and `geminiEditInputWidth`.
 */
export function isEditInputWidthSwitchOn(input: ChatWidthSwitchInput): boolean {
  return isWidthSwitchOn(input, isCustomizedEditInputWidth);
}

export function isWidthSwitchOn(
  input: ChatWidthSwitchInput,
  isCustomized: (stored: unknown) => boolean,
): boolean {
  if (input.storedSwitch !== undefined) return input.storedSwitch === true;
  if (input.switchChangedLive || input.widthChangedLive) return false;
  return isCustomized(input.storedWidth);
}
