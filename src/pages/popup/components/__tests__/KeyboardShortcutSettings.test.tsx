import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KeyboardShortcutSettings } from '../KeyboardShortcutSettings';

const {
  initMock,
  getConfigMock,
  setEnabledMock,
  saveConfigMock,
  resetToDefaultsMock,
  formatShortcutMock,
} = vi.hoisted(() => ({
  initMock: vi.fn().mockResolvedValue(undefined),
  getConfigMock: vi.fn(),
  setEnabledMock: vi.fn().mockResolvedValue(undefined),
  saveConfigMock: vi.fn().mockResolvedValue(undefined),
  resetToDefaultsMock: vi.fn().mockResolvedValue(undefined),
  formatShortcutMock: vi.fn(
    (shortcut: { key: string; modifiers: string[]; sequenceLength?: number }) =>
      shortcut.sequenceLength === 2
        ? shortcut.key.repeat(2)
        : [...shortcut.modifiers, shortcut.key].join('+'),
  ),
}));

const PANEL_DEFAULT = {
  action: 'panel:toggle',
  modifiers: ['Alt'],
  key: 'V',
  code: 'KeyV',
  sequenceLength: 1,
};

const TIMELINE_DEFAULTS = {
  previous: { action: 'timeline:previous', modifiers: [], key: 'k', sequenceLength: 1 },
  next: { action: 'timeline:next', modifiers: [], key: 'j', sequenceLength: 1 },
  first: { action: 'timeline:first', modifiers: [], key: 'g', sequenceLength: 2 },
  last: { action: 'timeline:last', modifiers: ['Shift'], key: 'G', sequenceLength: 2 },
};

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    setLanguage: vi.fn(),
    t: (key: string) => key,
  }),
}));

vi.mock('@/core/services/KeyboardShortcutService', () => ({
  keyboardShortcutService: {
    init: initMock,
    getConfig: getConfigMock,
    setEnabled: setEnabledMock,
    saveConfig: saveConfigMock,
    resetToDefaults: resetToDefaultsMock,
    formatShortcut: formatShortcutMock,
  },
}));

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('KeyboardShortcutSettings', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);

    getConfigMock.mockReturnValue({
      enabled: true,
      config: { ...TIMELINE_DEFAULTS, panelToggle: PANEL_DEFAULT },
    });
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root.unmount();
      });
    }
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('allows editing the last-node repeated shortcut and swaps conflicts', async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<KeyboardShortcutSettings />);
    });
    await flushMicrotasks();

    const lastButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'GG',
    );
    expect(lastButton).toBeTruthy();

    await act(async () => {
      lastButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'g',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flushMicrotasks();

    expect(saveConfigMock).toHaveBeenCalledWith(
      {
        previous: { action: 'timeline:previous', modifiers: [], key: 'k', sequenceLength: 1 },
        next: { action: 'timeline:next', modifiers: [], key: 'j', sequenceLength: 1 },
        first: {
          action: 'timeline:first',
          modifiers: ['Shift'],
          key: 'G',
          sequenceLength: 2,
        },
        last: { action: 'timeline:last', modifiers: [], key: 'g', sequenceLength: 2 },
        panelToggle: PANEL_DEFAULT,
      },
      true,
    );
  });

  it('records the panel shortcut by its physical key even with the timeline shortcuts off', async () => {
    getConfigMock.mockReturnValue({
      enabled: false,
      config: { ...TIMELINE_DEFAULTS, panelToggle: PANEL_DEFAULT },
    });
    await render();
    expect(buttonLabelled('k'), 'timeline rows stay hidden while shortcuts are off').toBeFalsy();

    await click(buttonLabelled('Alt+V'));
    // macOS Option+B types "∫"; the binding keeps that character and the key it was pressed on.
    // The formatter is mocked here; KeyboardShortcutLabels.test.tsx shows the real label, ⌥B.
    await press({ key: '∫', code: 'KeyB', altKey: true });

    expect(saveConfigMock).toHaveBeenCalledWith(
      {
        ...TIMELINE_DEFAULTS,
        panelToggle: {
          action: 'panel:toggle',
          modifiers: ['Alt'],
          key: '∫',
          code: 'KeyB',
          sequenceLength: 1,
        },
      },
      false,
    );
    expect(buttonLabelled('Alt+∫')).toBeTruthy();
  });

  it("moves the panel's binding aside when Option+V is recorded for another action", async () => {
    await render();

    await click(buttonLabelled('k'));
    await press({ key: '√', code: 'KeyV', altKey: true });

    // The swap names each slot's own action, so the panel keeps panel:toggle.
    expect(saveConfigMock).toHaveBeenCalledWith(
      {
        ...TIMELINE_DEFAULTS,
        previous: {
          action: 'timeline:previous',
          modifiers: ['Alt'],
          key: '√',
          code: 'KeyV',
          sequenceLength: 1,
        },
        panelToggle: { action: 'panel:toggle', modifiers: [], key: 'k', sequenceLength: 1 },
      },
      true,
    );
  });

  it('shows a refused save and keeps listening for another key', async () => {
    saveConfigMock.mockRejectedValueOnce(new Error('Shortcut already bound'));
    await render();

    await click(buttonLabelled('Alt+V'));
    await press({ key: 'j' });

    expect(container.querySelector('[role="alert"]')?.textContent).toBe('shortcutInUse');
    expect(buttonLabelled('shortcutPressKey'), 'still recording').toBeTruthy();

    // Alt+P where Alt types no character of its own: the key is the one typed.
    await press({ key: 'p', code: 'KeyP', altKey: true });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(buttonLabelled('Alt+p')).toBeTruthy();
  });

  it('switches the panel to vv and back to Alt+V', async () => {
    await render();
    const vv = container.querySelector<HTMLInputElement>('#shortcuts-panel-vv');
    expect(vv?.checked).toBe(false);

    await click(vv);
    expect(saveConfigMock).toHaveBeenLastCalledWith(
      {
        ...TIMELINE_DEFAULTS,
        panelToggle: { action: 'panel:toggle', modifiers: [], key: 'v', sequenceLength: 2 },
      },
      true,
    );
    expect(buttonLabelled('vv')).toBeTruthy();
    expect(vv?.checked).toBe(true);

    await click(vv);
    expect(saveConfigMock).toHaveBeenLastCalledWith(
      {
        ...TIMELINE_DEFAULTS,
        panelToggle: { action: 'panel:toggle', modifiers: ['Alt'], key: 'V', code: 'KeyV' },
      },
      true,
    );
    expect(vv?.checked).toBe(false);
  });

  async function render(): Promise<void> {
    await act(async () => {
      root = createRoot(container);
      root.render(<KeyboardShortcutSettings />);
    });
    await flushMicrotasks();
  }

  function buttonLabelled(text: string): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === text,
    );
  }

  async function click(element: Element | null | undefined): Promise<void> {
    expect(element).toBeTruthy();
    await act(async () => {
      element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushMicrotasks();
  }

  async function press(init: KeyboardEventInit): Promise<void> {
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
      );
    });
    await flushMicrotasks();
  }
});
