import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TranslationKey } from '@/utils/translations';

import { OtherWebsitesSection, type OtherWebsitesSectionProps } from '../OtherWebsitesSection';

const translate = (key: TranslationKey): string => key;

describe('OtherWebsitesSection', () => {
  let root: Root;
  let container: HTMLDivElement;
  let props: OtherWebsitesSectionProps;
  const render = (overrides: Partial<OtherWebsitesSectionProps> = {}) => {
    props = { ...props, ...overrides };
    act(() => root.render(<OtherWebsitesSection {...props} />));
  };
  const quickChoices = () =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('[role="group"] button')).map(
      (button) => button.textContent,
    );

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    props = {
      websites: ['example.org'],
      onRemove: vi.fn(async () => {}),
      coverage: {
        customWebsites: ['claude.ai', 'example.org'],
        newWebsiteInput: 'example.com',
        websiteError: 'permissionDenied',
        onWebsiteInputChange: vi.fn(),
        handleAddWebsite: vi.fn(async () => {}),
        toggleQuickWebsite: vi.fn(async () => {}),
      },
      t: translate,
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    render();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('offers quick choices only for sites outside the catalog that are not added yet', () => {
    expect(quickChoices().sort()).toEqual(['Midjourney', 'NotebookLM', 'Qwen']);
    act(() =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="group"] button'))
        .find((button) => button.textContent === 'Qwen')!
        .click(),
    );
    expect(props.coverage.toggleQuickWebsite).toHaveBeenCalledWith('qwen.ai', false);

    // A broader entry already covers NotebookLM.
    render({ coverage: { ...props.coverage, customWebsites: ['qwen.ai', 'google.com'] } });
    expect(quickChoices()).toEqual(['Midjourney']);
  });

  it('keeps removal, input editing, Enter and the error on the website controller', () => {
    const remove = Array.from(container.querySelectorAll('li button'))[0] as HTMLButtonElement;
    act(() => remove.click());
    expect(props.onRemove).toHaveBeenCalledWith('example.org', expect.any(Function));
    const input = container.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(input.value).toBe('example.com');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'next.example',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(props.coverage.onWebsiteInputChange).toHaveBeenCalledWith('next.example');
    expect(props.coverage.handleAddWebsite).toHaveBeenCalledOnce();
    expect(container.querySelector('p.text-destructive')?.textContent).toBe('permissionDenied');
  });
});
