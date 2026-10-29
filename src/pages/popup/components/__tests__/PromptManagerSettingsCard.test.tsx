import React, { act, createRef } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TranslationKey } from '@/utils/translations';

import {
  PromptManagerSettingsCard,
  type PromptManagerSettingsCardProps,
} from '../PromptManagerSettingsCard';

const translate = (key: TranslationKey): string => key;

describe('PromptManagerSettingsCard', () => {
  let root: Root;
  let container: HTMLDivElement;
  let props: PromptManagerSettingsCardProps;
  const render = (overrides: Partial<PromptManagerSettingsCardProps> = {}) => {
    props = { ...props, ...overrides };
    act(() => root.render(<PromptManagerSettingsCard {...props} />));
  };

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    props = {
      settings: {
        values: {
          hidePromptManager: false,
          promptTriggerMascotLogo: false,
          slashPromptEnabled: true,
          promptInsertOnClickEnabled: false,
        },
        onChange: vi.fn(),
      },
      transfer: {
        busy: false,
        cloudUnavailable: false,
        status: null,
        inputRef: createRef<HTMLInputElement>(),
        onExport: vi.fn(async () => {}),
        onImport: vi.fn(async () => {}),
        onCloudPull: vi.fn(async () => {}),
        onCloudPush: vi.fn(async () => {}),
      },
      t: translate,
      isVisible: () => true,
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

  it('renders all flag values and reports just the toggled setting', () => {
    const input = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)!;
    expect(input('hide-prompt-manager').checked).toBe(false);
    expect(input('prompt-trigger-mascot-logo').checked).toBe(false);
    expect(input('slash-prompt-enabled').checked).toBe(true);
    expect(input('prompt-insert-on-click').checked).toBe(false);
    act(() => input('prompt-trigger-mascot-logo').click());
    expect(props.settings.onChange).toHaveBeenCalledWith({ promptTriggerMascotLogo: true });
    act(() => input('prompt-insert-on-click').click());
    expect(props.settings.onChange).toHaveBeenCalledWith({ promptInsertOnClickEnabled: true });
  });

  it('retains the shared transfer panel while applying search visibility', () => {
    const exportButton = Array.from(container.querySelectorAll('button')).find(
      (item) => item.textContent === 'pm_export',
    )!;
    act(() => exportButton.click());
    expect(props.transfer.onExport).toHaveBeenCalledOnce();
    render({
      isVisible: (id) => !['promptTriggerMascotLogo', 'promptDataMigration'].includes(id),
    });
    expect(container.querySelector('#prompt-trigger-mascot-logo')).toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.querySelector('#slash-prompt-enabled')).not.toBeNull();
  });
});
