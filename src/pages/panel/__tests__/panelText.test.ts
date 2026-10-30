import { describe, expect, it } from 'vitest';

import type { KeyboardShortcut } from '@/core/types/keyboardShortcut';

import { shortcutLabel } from '../panelText';

describe('shortcutLabel', () => {
  it('names the letter a non-QWERTY layout prints, not the physical key', () => {
    // AZERTY: the key printing "A" sits where QWERTY has Q.
    const shortcut: KeyboardShortcut = {
      action: 'panel:toggle',
      key: 'a',
      code: 'KeyQ',
      modifiers: ['Alt'],
    };
    expect(shortcutLabel(shortcut, false)).toBe('Alt+A');
    expect(shortcutLabel(shortcut, true)).toBe('⌥A');
  });
});
