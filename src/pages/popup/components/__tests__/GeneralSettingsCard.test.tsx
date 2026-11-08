import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TranslationKey } from '@/utils/translations';

import {
  GeneralSettingsCard,
  type GeneralSettingsCardProps,
  type GeneralSettingsValues,
} from '../GeneralSettingsCard';

const translate = (key: TranslationKey): string => key;

const values: GeneralSettingsValues = {
  persistentExportToolbarEnabled: false,
  remoteAnnouncementEnabled: true,
  changelogNotifyMode: 'popup',
};

describe('GeneralSettingsCard', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (overrides: Partial<GeneralSettingsCardProps> = {}) => {
    const props: GeneralSettingsCardProps = {
      values,
      onChange: vi.fn(),
      remoteAnnouncementPermissionCta: { visible: false, onRequest: vi.fn() },
      isVisible: () => true,
      t: translate,
      ...overrides,
    };
    act(() => {
      root.render(<GeneralSettingsCard {...props} />);
    });
    return props;
  };

  const input = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)!;

  it('renders every value and reports one key per change', () => {
    const props = render();
    expect(input('persistent-export-toolbar').checked).toBe(false);
    expect(input('remote-announcement-notification').checked).toBe(true);

    act(() => input('persistent-export-toolbar').click());
    expect(props.onChange).toHaveBeenLastCalledWith({ persistentExportToolbarEnabled: true });
    const notifyChoice = (label: TranslationKey) =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
        (radio) => radio.textContent === label,
      )!;
    expect(notifyChoice('changelog_notify_mode_popup').getAttribute('aria-checked')).toBe('true');
    act(() => notifyChoice('changelog_notify_mode_off').click());
    expect(props.onChange).toHaveBeenLastCalledWith({ changelogNotifyMode: 'off' });
    expect(props.onChange).toHaveBeenCalledTimes(2);
  });

  it('leaves the switches that moved to the plugin list out of the card', () => {
    render();
    for (const id of [
      'mermaid-enabled',
      'wavedrom-enabled',
      'echarts-enabled',
      'code-block-collapse-enabled',
      'user-latex-enabled',
      'quote-reply-enabled',
      'usage-status-enabled',
      'hide-input-halo',
      'default-model-auto-apply',
      'research-pack-enabled',
      'highlights-enabled',
      'highlight-timeline-markers-enabled',
      'response-complete-notification',
    ]) {
      expect(container.querySelector(`#${id}`)).toBeNull();
    }
  });

  it('keeps the retired tab-title row disabled', () => {
    render();
    expect(input('tab-title-update').disabled).toBe(true);
    expect(input('tab-title-update').checked).toBe(false);
  });

  it('shows the announcement permission call-to-action only when asked', () => {
    render();
    expect(container.textContent).not.toContain('remoteAnnouncementSystemPermissionCta');

    const onRequest = vi.fn();
    render({ remoteAnnouncementPermissionCta: { visible: true, onRequest } });
    const cta = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('remoteAnnouncementSystemPermissionCta'),
    )!;
    act(() => cta.click());
    expect(onRequest).toHaveBeenCalledOnce();
  });

  it('leaves rows out of the DOM when the site or search rules them out', () => {
    render({ isVisible: (settingId) => settingId !== 'persistentExportToolbar' });
    expect(container.querySelector('#persistent-export-toolbar')).toBeNull();
    expect(container.querySelector('#remote-announcement-notification')).not.toBeNull();

    render({ isVisible: (settingId) => settingId !== 'enableTabTitleUpdate' });
    expect(container.querySelector('#tab-title-update')).toBeNull();
  });
});
