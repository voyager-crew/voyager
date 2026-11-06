import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDarkMode } from '../useDarkMode';

function stubSystemTheme(dark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  vi.stubGlobal('matchMedia', () => ({
    matches: dark,
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.delete(listener),
  }));
  return (matches: boolean) => {
    for (const listener of listeners) listener({ matches } as MediaQueryListEvent);
  };
}

function Toggle() {
  const { toggleDarkMode } = useDarkMode();
  return <button onClick={() => toggleDarkMode()}>Toggle</button>;
}

/** The Welcome page's shape: the page holds a hook instance and the toggle holds its own. */
function Page() {
  useDarkMode();
  return <Toggle />;
}

describe('useDarkMode', () => {
  let container: HTMLDivElement;
  let root: Root;
  const isDark = () => document.documentElement.classList.contains('dark');

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.documentElement.classList.remove('dark');
    vi.unstubAllGlobals();
  });

  it('follows the system theme while nothing has been picked', () => {
    const emit = stubSystemTheme(true);
    act(() => root.render(<Page />));
    expect(isDark()).toBe(true);
    expect(localStorage.getItem('darkMode')).toBeNull();

    act(() => emit(false));
    expect(isDark()).toBe(false);
    act(() => emit(true));
    expect(isDark()).toBe(true);
  });

  it('keeps a picked theme when the system theme changes', () => {
    const emit = stubSystemTheme(true);
    act(() => root.render(<Page />));

    act(() => container.querySelector('button')!.click());
    expect(isDark()).toBe(false);
    expect(localStorage.getItem('darkMode')).toBe('false');

    act(() => emit(true));
    act(() => emit(false));
    act(() => emit(true));
    expect(isDark()).toBe(false);
    expect(localStorage.getItem('darkMode')).toBe('false');
  });

  it('keeps honoring a theme saved by an earlier version', () => {
    localStorage.setItem('darkMode', 'false');
    const emit = stubSystemTheme(true);
    act(() => root.render(<Page />));
    expect(isDark()).toBe(false);

    act(() => emit(true));
    expect(isDark()).toBe(false);
  });
});
