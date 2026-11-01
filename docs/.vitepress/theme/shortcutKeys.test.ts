import { describe, expect, it } from 'vitest';

import { localizeShortcutKeys } from './shortcutKeys';

describe('site shortcut caps', () => {
  it.each([
    [true, '⇧⌘K'],
    [false, 'Ctrl+Shift+K'],
  ])("redraw the built page's combined notation for mac=%s as %s", (mac, label) => {
    const root = document.createElement('div');
    root.innerHTML =
      '<kbd class="gv-changelog-kbd" data-gv-keys="Mod+Shift+K">Ctrl/⌘+Shift+K</kbd>';

    localizeShortcutKeys(root, mac);

    expect(root.querySelector('kbd')?.textContent).toBe(label);
  });
});
