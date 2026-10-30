import { printedShortcutKey } from '@/core/services/KeyboardShortcutService';
import type { KeyboardShortcut, ModifierKey } from '@/core/types/keyboardShortcut';
import type { AppLanguage } from '@/utils/language';
import { getLoadedTranslations, getPluralTranslation } from '@/utils/translations';

import type messages from './messages/en.json';

declare module '@/utils/translations' {
  interface PrimitiveMessages {
    panel: typeof messages;
  }
}

/** "{count} on" under a supported site, in the plural form the language uses for `count`. */
export function featuresOnLabel(language: AppLanguage, count: number): string {
  return getPluralTranslation({
    language,
    key: 'panelFeaturesOn',
    count,
    translations: getLoadedTranslations(language) ?? getLoadedTranslations('en'),
  });
}

const MODIFIER_ORDER: readonly ModifierKey[] = ['Ctrl', 'Alt', 'Shift', 'Meta'];
const MAC_MODIFIERS: Readonly<Record<ModifierKey, string>> = {
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Meta: '⌘',
};
const OTHER_MODIFIERS: Readonly<Record<ModifierKey, string>> = {
  Ctrl: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
  Meta: 'Win',
};

/** Option+V reads "√" in `key` on macOS; the core rule names the letter its code prints. */
function keyName(shortcut: KeyboardShortcut): string {
  const { key } = shortcut;
  return printedShortcutKey(shortcut) ?? (key.length === 1 ? key.toUpperCase() : key);
}

/** ⌥V on macOS and Alt+V elsewhere, as the key cap and tooltips show the panel shortcut. */
export function shortcutLabel(shortcut: KeyboardShortcut, mac: boolean): string {
  const modifiers = MODIFIER_ORDER.filter((modifier) => shortcut.modifiers.includes(modifier));
  const repeat = shortcut.sequenceLength ?? 1;
  if (modifiers.length === 0 && repeat > 1) return shortcut.key.repeat(repeat);
  const key = keyName(shortcut);
  if (mac) return `${modifiers.map((modifier) => MAC_MODIFIERS[modifier]).join('')}${key}`;
  return [...modifiers.map((modifier) => OTHER_MODIFIERS[modifier]), key].join('+');
}

/** `{name}` placeholders, filled once each, so a value containing `$` stays literal. */
export function fillPlaceholders(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? values[name] : match,
  );
}
