import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { customWebsitesIncludeHost } from '@/core/utils/customWebsites';
import { CATALOG_SITES } from '@/features/plugins/sites/siteAccessSites';
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
  /** The websites the add group offers, by address, in order. */
  const offered = () =>
    Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="group"] button'),
      (button) => button.title,
    );
  const offer = (website: string) =>
    container.querySelector<HTMLButtonElement>(`[role="group"] button[title="${website}"]`)!;
  const withCoverage = (customWebsites: string[]) => ({ ...props.coverage, customWebsites });

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    props = {
      websites: ['example.org'],
      pageWebsite: null,
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

  it('offers only sites outside the catalog that are not added yet, and adds one in a click', () => {
    expect(offered().length).toBeGreaterThan(0);
    // A supported site has a row of its own; an added website is in the list.
    for (const host of CATALOG_SITES.flatMap((site) => site.hosts)) {
      expect(customWebsitesIncludeHost(offered(), host)).toBe(false);
    }
    expect(
      offered().filter((website) =>
        customWebsitesIncludeHost(props.coverage.customWebsites, website),
      ),
    ).toEqual([]);

    const [first] = offered();
    act(() => offer(first).click());
    expect(props.coverage.toggleQuickWebsite).toHaveBeenCalledWith(first, false);

    // Added, directly or through a parent domain, each one drops out.
    const parentOrSelf = (website: string) =>
      website.split('.').length > 2 ? website.slice(website.indexOf('.') + 1) : website;
    render({ coverage: withCoverage(offered().map(parentOrSelf)) });
    expect(offered()).toEqual([]);
  });

  it('offers the open page first and once, until the list or a quick choice covers it', () => {
    render({ pageWebsite: 'chat.example.net' });
    expect(offered()[0]).toBe('chat.example.net');
    expect(offered().filter((website) => website === 'chat.example.net')).toHaveLength(1);
    act(() => offer('chat.example.net').click());
    expect(props.coverage.toggleQuickWebsite).toHaveBeenCalledWith('chat.example.net', false);

    render({ coverage: withCoverage(['example.net']) });
    expect(offered()).not.toContain('chat.example.net');

    // A page under a quick choice keeps that one chip instead of a second.
    const [quick] = offered();
    render({ pageWebsite: `chat.${quick}` });
    expect(
      offered().filter((website) => customWebsitesIncludeHost([website], `chat.${quick}`)),
    ).toEqual([quick]);
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
