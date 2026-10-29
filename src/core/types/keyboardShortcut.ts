/**
 * Keyboard Shortcut Types
 * Defines types for configurable keyboard shortcuts
 *
 * Supports:
 * - Single key mode (e.g., j/k for vim-style navigation)
 * - Combination key mode (e.g., Alt + Arrow keys)
 * - Repeated key sequences (e.g., gg / GG)
 * - Fully customizable by user
 */

/**
 * Modifier keys for shortcuts
 */
export type ModifierKey = 'Alt' | 'Ctrl' | 'Shift' | 'Meta';

/**
 * Any key can be used for shortcuts
 * We use string to support any keyboard key
 */
export type ShortcutKey = string;

/**
 * Shortcut action types
 */
export type ShortcutAction =
  | 'timeline:previous'
  | 'timeline:next'
  | 'timeline:first'
  | 'timeline:last'
  | 'panel:toggle';

/**
 * Individual keyboard shortcut configuration
 */
export interface KeyboardShortcut {
  action: ShortcutAction;
  modifiers: ModifierKey[];
  key: ShortcutKey;
  /** Physical key for modifier shortcuts whose event.key changes with the keyboard layout. */
  code?: string;
  sequenceLength?: number;
}

/** Build a recorder's binding from the actual event rather than reconstructing its action id. */
export function keyboardShortcutFromEvent({
  event,
  action,
  sequenceLength = 1,
}: {
  event: KeyboardEvent;
  action: ShortcutAction;
  sequenceLength?: number;
}): KeyboardShortcut {
  const modifiers: ModifierKey[] = [];
  if (event.altKey) modifiers.push('Alt');
  if (event.ctrlKey) modifiers.push('Ctrl');
  if (event.shiftKey) modifiers.push('Shift');
  if (event.metaKey) modifiers.push('Meta');
  const legacyArrows: Readonly<Record<string, string>> = {
    Up: 'ArrowUp',
    Down: 'ArrowDown',
    Left: 'ArrowLeft',
    Right: 'ArrowRight',
  };
  return {
    action,
    key: Object.hasOwn(legacyArrows, event.key) ? legacyArrows[event.key] : event.key,
    modifiers,
    // Option changes event.key on macOS; retain the observed physical key for modifiers.
    ...(modifiers.length > 0 && event.code && event.code !== 'Unidentified'
      ? { code: event.code }
      : {}),
    sequenceLength,
  };
}

/**
 * Keyboard event matcher result
 */
export interface ShortcutMatch {
  action: ShortcutAction;
  event: KeyboardEvent;
}

/**
 * Complete shortcuts configuration (single set, user-customizable)
 */
export interface KeyboardShortcutConfig {
  previous: KeyboardShortcut;
  next: KeyboardShortcut;
  first: KeyboardShortcut;
  last: KeyboardShortcut;
}

/** The popup's timeline editor can keep using its four-key config until it adds the panel row. */
export interface ResolvedKeyboardShortcutConfig extends KeyboardShortcutConfig {
  panelToggle: KeyboardShortcut;
}

export type KeyboardShortcutConfigInput = KeyboardShortcutConfig &
  Partial<Pick<ResolvedKeyboardShortcutConfig, 'panelToggle'>>;

/**
 * Storage format for shortcuts
 */
export interface KeyboardShortcutStorage {
  shortcuts: KeyboardShortcutConfigInput;
  enabled: boolean;
}

export const TIMELINE_SHORTCUT_ACTIONS = [
  'timeline:previous',
  'timeline:next',
  'timeline:first',
  'timeline:last',
] as const satisfies readonly ShortcutAction[];

export const DEFAULT_KEYBOARD_SHORTCUTS: ResolvedKeyboardShortcutConfig = {
  previous: { action: 'timeline:previous', modifiers: [], key: 'k' },
  next: { action: 'timeline:next', modifiers: [], key: 'j' },
  first: { action: 'timeline:first', modifiers: [], key: 'g', sequenceLength: 2 },
  last: { action: 'timeline:last', modifiers: ['Shift'], key: 'G', sequenceLength: 2 },
  panelToggle: { action: 'panel:toggle', modifiers: ['Alt'], key: 'V', code: 'KeyV' },
};

function codeForKey(key: string): string {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return key === ' ' ? 'Space' : key;
}

/** Shared by save validation and editors; modifier order does not change a binding. */
export function keyboardShortcutBindingsEqual(a: KeyboardShortcut, b: KeyboardShortcut): boolean {
  const sameKey =
    a.code && b.code
      ? a.code === b.code
      : a.key === b.key ||
        (a.code !== undefined && a.code === codeForKey(b.key)) ||
        (b.code !== undefined && b.code === codeForKey(a.key));
  return (
    sameKey &&
    (a.sequenceLength ?? 1) === (b.sequenceLength ?? 1) &&
    a.modifiers.every((modifier) => b.modifiers.includes(modifier)) &&
    b.modifiers.every((modifier) => a.modifiers.includes(modifier))
  );
}

export function findKeyboardShortcutConflict(
  config: ResolvedKeyboardShortcutConfig,
): readonly [ShortcutAction, ShortcutAction] | null {
  const shortcuts = Object.values(config);
  for (const [index, shortcut] of shortcuts.entries()) {
    for (const candidate of shortcuts.slice(index + 1)) {
      if (keyboardShortcutBindingsEqual(shortcut, candidate))
        return [shortcut.action, candidate.action];
    }
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isModifierKey(value: unknown): value is ModifierKey {
  return value === 'Alt' || value === 'Ctrl' || value === 'Shift' || value === 'Meta';
}

function isShortcutOverride(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    (value.action === undefined || typeof value.action === 'string') &&
    (value.modifiers === undefined ||
      (Array.isArray(value.modifiers) && value.modifiers.every(isModifierKey))) &&
    (value.key === undefined || (typeof value.key === 'string' && value.key.length > 0)) &&
    (value.code === undefined || (typeof value.code === 'string' && value.code.length > 0)) &&
    (value.sequenceLength === undefined ||
      (typeof value.sequenceLength === 'number' &&
        Number.isInteger(value.sequenceLength) &&
        value.sequenceLength > 0))
  );
}

/** Validate a backup without filling defaults or dropping fields an older/newer build saved. */
export function isRestorableKeyboardShortcutStorage(value: unknown): boolean {
  if (!isObject(value) || !isObject(value.shortcuts)) return false;
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') return false;
  const shortcuts = value.shortcuts;
  return Object.keys(DEFAULT_KEYBOARD_SHORTCUTS).every(
    (key) => shortcuts[key] === undefined || isShortcutOverride(shortcuts[key]),
  );
}

function normalizeShortcut(value: unknown, fallback: KeyboardShortcut): KeyboardShortcut {
  const shortcut = isObject(value) ? value : {};
  const modifiers =
    Array.isArray(shortcut.modifiers) && shortcut.modifiers.every(isModifierKey)
      ? shortcut.modifiers
      : fallback.modifiers;
  const key =
    typeof shortcut.key === 'string' && shortcut.key.length > 0 ? shortcut.key : fallback.key;
  const sequenceLength =
    typeof shortcut.sequenceLength === 'number' &&
    Number.isInteger(shortcut.sequenceLength) &&
    shortcut.sequenceLength > 0
      ? shortcut.sequenceLength
      : (fallback.sequenceLength ?? 1);
  const usesFallbackBinding =
    key === fallback.key &&
    sequenceLength === (fallback.sequenceLength ?? 1) &&
    modifiers.length === fallback.modifiers.length &&
    modifiers.every((modifier) => fallback.modifiers.includes(modifier));
  return {
    action: fallback.action,
    modifiers: [...modifiers],
    key,
    ...(typeof shortcut.code === 'string' && shortcut.code.length > 0
      ? { code: shortcut.code }
      : usesFallbackBinding && fallback.code
        ? { code: fallback.code }
        : {}),
    sequenceLength,
  };
}

/** Parse stored/legacy config once; the panel fallback also preserves it across old UI saves. */
export function normalizeKeyboardShortcutConfig(
  value: unknown,
  panelFallback: KeyboardShortcut = DEFAULT_KEYBOARD_SHORTCUTS.panelToggle,
): ResolvedKeyboardShortcutConfig {
  const config = isObject(value) ? value : {};
  // The config slot owns action identity, including a panel binding swapped by an old editor.
  const panel = isShortcutOverride(config.panelToggle) ? config.panelToggle : undefined;
  return {
    previous: normalizeShortcut(config.previous, DEFAULT_KEYBOARD_SHORTCUTS.previous),
    next: normalizeShortcut(config.next, DEFAULT_KEYBOARD_SHORTCUTS.next),
    first: normalizeShortcut(config.first, DEFAULT_KEYBOARD_SHORTCUTS.first),
    last: normalizeShortcut(config.last, DEFAULT_KEYBOARD_SHORTCUTS.last),
    panelToggle: normalizeShortcut(
      panel,
      panel === undefined ? panelFallback : DEFAULT_KEYBOARD_SHORTCUTS.panelToggle,
    ),
  };
}
