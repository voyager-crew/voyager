import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getInitialThemeMode, getNextThemeMode, resolveIsDark, useDarkMode } from '../useDarkMode';

function stubSystemTheme(dark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mediaQuery = {
    matches: dark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
  } as unknown as MediaQueryList;
  vi.stubGlobal('matchMedia', () => mediaQuery);
  return {
    emit(matches: boolean) {
      for (const listener of listeners) {
        listener({ matches } as MediaQueryListEvent);
      }
    },
  };
}

describe('theme mode helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to auto when no preference was stored', () => {
    expect(getInitialThemeMode()).toBe('auto');
  });

  it('prefers the saved three-state mode over the legacy boolean', () => {
    localStorage.setItem('themeMode', 'dark');
    localStorage.setItem('darkMode', 'false');
    expect(getInitialThemeMode()).toBe('dark');
  });

  it('migrates the legacy darkMode boolean', () => {
    localStorage.setItem('darkMode', 'true');
    expect(getInitialThemeMode()).toBe('dark');

    localStorage.setItem('darkMode', 'false');
    expect(getInitialThemeMode()).toBe('light');
  });

  it('cycles in visual order: light → auto → dark', () => {
    expect(getNextThemeMode('light')).toBe('auto');
    expect(getNextThemeMode('auto')).toBe('dark');
    expect(getNextThemeMode('dark')).toBe('light');
  });

  it('resolves auto against the system preference', () => {
    stubSystemTheme(true);
    expect(resolveIsDark('auto')).toBe(true);
    expect(resolveIsDark('light')).toBe(false);
    expect(resolveIsDark('dark')).toBe(true);
  });
});

describe('useDarkMode', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.documentElement.classList.remove('dark');
    vi.unstubAllGlobals();
  });

  function Harness() {
    const { themeMode, isDark, toggleDarkMode } = useDarkMode();
    return (
      <div>
        <span data-testid="mode">{themeMode}</span>
        <span data-testid="isDark">{String(isDark)}</span>
        <button data-testid="toggle" type="button" onClick={(e) => toggleDarkMode(e)}>
          Toggle
        </button>
      </div>
    );
  }

  function render() {
    act(() => root.render(<Harness />));
    return {
      mode: () => container.querySelector('[data-testid="mode"]')!.textContent,
      isDark: () => container.querySelector('[data-testid="isDark"]')!.textContent,
      toggle: container.querySelector<HTMLButtonElement>('[data-testid="toggle"]')!,
    };
  }

  it('starts in auto, follows the system, and cycles through the three modes', () => {
    stubSystemTheme(true);
    const ui = render();

    expect(ui.mode()).toBe('auto');
    expect(ui.isDark()).toBe('true');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    act(() => ui.toggle.click());
    expect(ui.mode()).toBe('dark');
    expect(localStorage.getItem('themeMode')).toBe('dark');

    act(() => ui.toggle.click());
    expect(ui.mode()).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    act(() => ui.toggle.click());
    expect(ui.mode()).toBe('auto');
    expect(localStorage.getItem('themeMode')).toBe('auto');
  });

  it('updates the page while auto is active and ignores system changes otherwise', () => {
    const system = stubSystemTheme(true);
    const ui = render();

    act(() => system.emit(false));
    expect(ui.isDark()).toBe('false');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    act(() => ui.toggle.click()); // auto -> dark, fixed
    expect(ui.mode()).toBe('dark');

    act(() => system.emit(false));
    expect(ui.isDark()).toBe('true');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('honours the legacy boolean as a fixed theme', () => {
    stubSystemTheme(true);
    localStorage.setItem('darkMode', 'false');
    const ui = render();

    expect(ui.mode()).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
