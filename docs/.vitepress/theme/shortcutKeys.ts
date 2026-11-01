/**
 * The changelog's key caps in the reader's own notation. The page is built
 * with the combined `Alt/⌥+V` (`changelog.ts`); once the content has mounted,
 * and so after hydration, each cap is redrawn as ⌥V on macOS or Alt+V elsewhere.
 * Running after mount keeps the server markup and the hydrated markup identical.
 */
import { isMac } from '../../../src/core/utils/browser';
import { formatShortcut, parseShortcut } from '../../../src/pages/content/changelog/shortcutMarks';

export function localizeShortcutKeys(root: ParentNode, mac: boolean = isMac()): void {
  for (const kbd of root.querySelectorAll<HTMLElement>('kbd.gv-changelog-kbd[data-gv-keys]')) {
    const shortcut = parseShortcut(kbd.dataset.gvKeys ?? '');
    if (shortcut) kbd.textContent = formatShortcut(shortcut, mac ? 'mac' : 'other');
  }
}
