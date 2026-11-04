import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FontSizeValue } from '../font-size-value';

describe('precise font size input', () => {
  const commit = vi.fn();
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    commit.mockClear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root.render(
        <FontSizeValue
          label="Font size"
          resetLabel="Reset to 100%"
          value={102.5}
          min={80}
          max={150}
          onCommit={commit}
        />,
      ),
    );
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  const type = (value: string) => {
    const input = container.querySelector('input')!;
    act(() => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return input;
  };

  it.each([
    ['200', 150],
    ['50', 80],
    ['102.54', 102.5],
    ['102.56', 102.6],
  ] as const)('clamps and rounds %s after editing finishes', (raw, expected) => {
    const input = type(raw);
    expect(commit).not.toHaveBeenCalled();
    act(() => input.blur());
    expect(input.value).toBe(String(expected));
    if (expected === 102.5) expect(commit).not.toHaveBeenCalled();
    else expect(commit).toHaveBeenCalledExactlyOnceWith(expected);
  });

  it('restores the saved decimal when cleared or cancelled', () => {
    const input = type('');
    act(() => input.blur());
    expect(input.value).toBe('102.5');
    type('130');
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    act(() => input.blur());
    expect(input.value).toBe('102.5');
    expect(commit).not.toHaveBeenCalled();
  });
});
