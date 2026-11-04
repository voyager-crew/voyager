import { describe, expect, it, vi } from 'vitest';

import { createThemeToggle, getNextPromptTheme } from '../promptThemeToggle';

const polyfill = vi.hoisted(() => ({
  storage: { onChanged: { addListener: () => {}, removeListener: () => {} } } as
    | { onChanged: { addListener: () => void; removeListener: () => void } }
    | undefined,
}));

vi.mock('webextension-polyfill', () => ({ default: polyfill }));
vi.mock('../promptPrefs', () => ({
  readSyncedChoice: () => Promise.resolve(null),
  writeSyncedChoice: () => Promise.resolve(),
}));

describe('getNextPromptTheme', () => {
  it('cycles in visual order: light → auto → dark', () => {
    expect(getNextPromptTheme('light')).toBe('auto');
    expect(getNextPromptTheme('auto')).toBe('dark');
    expect(getNextPromptTheme('dark')).toBe('light');
  });
});

describe('createThemeToggle', () => {
  it('destroys without throwing after an extension reload removed browser.storage', () => {
    const toggle = createThemeToggle({
      panel: document.createElement('div'),
      t: (key) => key,
      pageScheme: () => 'light',
    });
    polyfill.storage = undefined;

    expect(() => toggle.destroy()).not.toThrow();
  });
});
