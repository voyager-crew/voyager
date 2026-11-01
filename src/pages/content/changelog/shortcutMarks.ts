/**
 * `:kbd:Alt+V:` markers in a release note: a keyboard shortcut written once and
 * shown in the reader's own notation, ⌥V on macOS and Alt+V elsewhere.
 *
 * Free of extension APIs and `@/` imports: the docs site renders the same
 * markers at build time, where no reader's system is known yet, with the
 * combined `Alt/⌥+V` notation the older notes already use (`Ctrl/⌘+Enter`).
 */

/** `Mod` is ⌘ on macOS and Ctrl elsewhere: the key a shortcut uses for "command". */
export type ShortcutModifier = 'Mod' | 'Ctrl' | 'Alt' | 'Shift';
export type ShortcutNotation = 'mac' | 'other' | 'both';

export interface Shortcut {
  /** Each once; `formatShortcut` puts them in each notation's own order. */
  readonly modifiers: readonly ShortcutModifier[];
  /** One printable character, upper-cased, or a named key such as `Enter`. */
  readonly key: string;
}

/** Captures the spec between `:kbd:` and the closing colon, e.g. `Mod+Shift+K`. */
export const SHORTCUT_MARKER = /:kbd:([A-Za-z0-9+/.,]+):/g;

const MODIFIERS: readonly ShortcutModifier[] = ['Mod', 'Ctrl', 'Alt', 'Shift'];
/** ⌃⌥⇧⌘, the order macOS menus use; elsewhere Ctrl leads (`Mod` is Ctrl there). */
const MAC_ORDER: readonly ShortcutModifier[] = ['Ctrl', 'Alt', 'Shift', 'Mod'];
const OTHER_ORDER: readonly ShortcutModifier[] = ['Mod', 'Ctrl', 'Alt', 'Shift'];

const MODIFIER_LABELS = {
  Ctrl: { mac: '⌃', other: 'Ctrl', both: 'Ctrl' },
  Alt: { mac: '⌥', other: 'Alt', both: 'Alt/⌥' },
  Shift: { mac: '⇧', other: 'Shift', both: 'Shift' },
  Mod: { mac: '⌘', other: 'Ctrl', both: 'Ctrl/⌘' },
} as const satisfies Record<ShortcutModifier, Record<ShortcutNotation, string>>;

const NAMED_KEYS: Readonly<Record<string, string>> = {
  enter: 'Enter',
  esc: 'Esc',
  tab: 'Tab',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
};

function isModifier(token: string): token is ShortcutModifier {
  return (MODIFIERS as readonly string[]).includes(token);
}

function keyName(token: string): string | null {
  if (token.length === 1) return token.toUpperCase();
  if (/^F([1-9]|1[0-2])$/.test(token)) return token;
  return NAMED_KEYS[token.toLowerCase()] ?? null;
}

/**
 * The shortcut a marker spec names, or `null` when the spec is not one: an
 * unknown modifier or key, a repeated modifier, `Mod` beside `Ctrl` (both are
 * Ctrl off macOS) or anything but exactly one key, written last.
 */
export function parseShortcut(spec: string): Shortcut | null {
  const tokens = spec.split('+');
  const keyToken = tokens.pop();
  if (!keyToken) return null;
  const key = keyName(keyToken);
  if (!key) return null;
  const seen = new Set<ShortcutModifier>();
  for (const token of tokens) {
    if (!isModifier(token) || seen.has(token)) return null;
    seen.add(token);
  }
  if (seen.has('Mod') && seen.has('Ctrl')) return null;
  return { modifiers: [...seen], key };
}

/** ⌥V for `mac`, Alt+V for `other`, Alt/⌥+V for `both` (a page built before it knows its reader). */
export function formatShortcut(shortcut: Shortcut, notation: ShortcutNotation): string {
  const order = notation === 'mac' ? MAC_ORDER : OTHER_ORDER;
  const modifiers = order
    .filter((modifier) => shortcut.modifiers.includes(modifier))
    .map((modifier) => MODIFIER_LABELS[modifier][notation]);
  if (notation === 'mac') return `${modifiers.join('')}${shortcut.key}`;
  return [...modifiers, shortcut.key].join('+');
}

/** Every marker spec in `text` that does not parse, for checks that fail a bad note. */
export function invalidShortcutSpecs(text: string): string[] {
  return [...text.matchAll(SHORTCUT_MARKER)]
    .map((match) => match[1])
    .filter((spec) => parseShortcut(spec) === null);
}
