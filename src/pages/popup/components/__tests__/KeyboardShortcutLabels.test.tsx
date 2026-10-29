/**
 * How the popup's shortcut editor labels a binding recorded with macOS
 * Option, which turns the typed character into "∫" or "√": by the key
 * pressed (⌥B), while other layouts keep the character on their key.
 */
import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { keyboardShortcutService } from '@/core/services/KeyboardShortcutService';
import { StorageKeys } from '@/core/types/common';
import { DEFAULT_KEYBOARD_SHORTCUTS } from '@/core/types/keyboardShortcut';

import { KeyboardShortcutSettings } from '../KeyboardShortcutSettings';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en', t: (key: string) => key }),
}));

let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(async () => {
  keyboardShortcutService.destroy();
  vi.stubGlobal('chrome', undefined);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
  localStorage.clear();
  await keyboardShortcutService.resetToDefaults();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  keyboardShortcutService.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root.render(<KeyboardShortcutSettings />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function labels(): string[] {
  return Array.from(container.querySelectorAll('button'), (button) => button.textContent ?? '');
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === label,
  );
  if (!found) throw new Error(`No button labelled ${label}: ${labels().join(', ')}`);
  return found;
}

async function record(rowLabel: string, init: KeyboardEventInit): Promise<void> {
  await act(async () => button(rowLabel).click());
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe('shortcut labels', () => {
  it('labels Option+B recorded for the panel as ⌥B, and Option+P for Previous as ⌥P', async () => {
    await render();

    await record('⌥V', { key: '∫', code: 'KeyB', altKey: true });
    await record('k', { key: 'π', code: 'KeyP', altKey: true });

    expect(labels()).toContain('⌥B');
    expect(labels()).toContain('⌥P');
    expect(labels().some((label) => /[∫π]/.test(label))).toBe(false);
    expect(keyboardShortcutService.getConfig().config.panelToggle).toMatchObject({
      key: '∫',
      code: 'KeyB',
    });
  });

  it('labels stored Option+V and Option+1 by their keys and keeps a non-US layout’s character', async () => {
    localStorage.setItem(
      StorageKeys.TIMELINE_SHORTCUTS,
      JSON.stringify({
        enabled: true,
        shortcuts: {
          ...DEFAULT_KEYBOARD_SHORTCUTS,
          previous: {
            action: 'timeline:previous',
            modifiers: ['Alt'],
            key: 'ö',
            code: 'Semicolon',
          },
          first: {
            action: 'timeline:first',
            modifiers: ['Alt'],
            key: '¡',
            code: 'Digit1',
            sequenceLength: 1,
          },
          panelToggle: { action: 'panel:toggle', modifiers: ['Alt'], key: '√', code: 'KeyV' },
        },
      }),
    );
    await keyboardShortcutService.init();
    await render();

    expect(labels()).toContain('⌥V');
    expect(labels()).toContain('⌥1');
    expect(labels()).toContain('⌥ö');
  });
});
