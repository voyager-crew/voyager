/** The shell's strings and the shortcut as it shows in a key cap. */
import {
  keyboardShortcutService,
  printedShortcutKey,
} from '@/core/services/KeyboardShortcutService';
import { getTranslationSync } from '@/utils/i18n';

import type messages from './messages/en.json';

declare module '@/utils/translations' {
  interface PrimitiveMessages {
    panelShell: typeof messages;
  }
}

export type ShellTextKey = keyof typeof messages;

export function shellText(key: ShellTextKey): string {
  return getTranslationSync(key);
}

/** The panel shortcut for a key cap: ⌥V on macOS, Alt+V elsewhere, vv when chosen instead. */
export function panelShortcutLabel(): string {
  const { config } = keyboardShortcutService.getConfig();
  return keyboardShortcutService.formatShortcut(config.panelToggle).replace(/ \+ /g, '+');
}

/** The panel shortcut as `aria-keyshortcuts` spells it; null for a typed sequence such as vv. */
export function panelShortcutAria(): string | null {
  const { panelToggle } = keyboardShortcutService.getConfig().config;
  if ((panelToggle.sequenceLength ?? 1) > 1) return null;
  const modifiers = panelToggle.modifiers.map((modifier) =>
    modifier === 'Ctrl' ? 'Control' : modifier,
  );
  return [...modifiers, printedShortcutKey(panelToggle) ?? panelToggle.key.toUpperCase()].join('+');
}

/** A key cap reads left to right on every keyboard, in an Arabic sentence too. */
export function shortcutCap(shortcut: string): HTMLElement {
  const cap = document.createElement('kbd');
  cap.dir = 'ltr';
  cap.textContent = shortcut;
  return cap;
}

/** `{shortcut}` in `template` as a key cap, with the text around it; never concatenated copy. */
export function withShortcutCap(template: string, shortcut: string): Node[] {
  const [before, ...rest] = template.split('{shortcut}');
  if (rest.length === 0) return [document.createTextNode(template)];
  return [
    document.createTextNode(before),
    shortcutCap(shortcut),
    document.createTextNode(rest.join(shortcut)),
  ];
}
