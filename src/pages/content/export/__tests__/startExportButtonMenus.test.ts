import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { createExportEntrypoint } from '../index';
import { resolveExportSite } from '../sites/resolveExportSite';

const startExportButton = createExportEntrypoint(resolveExportSite());

function openConversationMenu(): HTMLElement {
  const trigger = document.createElement('button');
  trigger.setAttribute('data-test-id', 'actions-menu-button');
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'true');
  trigger.setAttribute('aria-controls', 'conversation-menu');

  const pin = document.createElement('button');
  pin.className = 'mat-mdc-menu-item';
  pin.setAttribute('role', 'menuitem');
  pin.setAttribute('data-test-id', 'pin-button');
  pin.textContent = '固定';
  const content = document.createElement('div');
  content.className = 'mat-mdc-menu-content';
  content.appendChild(pin);
  const panel = document.createElement('div');
  panel.id = 'conversation-menu';
  panel.className = 'mat-mdc-menu-panel';
  panel.setAttribute('role', 'menu');
  panel.appendChild(content);

  document.body.append(trigger, panel);
  return panel;
}

afterEach(() => {
  window.dispatchEvent(new Event('beforeunload'));
  document.body.innerHTML = '';
  vi.mocked(chrome.storage.sync.get).mockReset();
});

describe('startExportButton on Gemini', () => {
  it('labels the conversation menu export item in the saved interface language', async () => {
    vi.mocked(chrome.storage.sync.get).mockImplementation(((
      _keys: unknown,
      callback?: (items: Record<string, unknown>) => void,
    ) => {
      const items = { [StorageKeys.LANGUAGE]: 'zh' };
      callback?.(items);
      return Promise.resolve(items);
    }) as unknown as typeof chrome.storage.sync.get);

    void startExportButton();
    const menu = openConversationMenu();

    await vi.waitFor(() =>
      expect(menu.querySelector('.gv-export-conversation-menu-btn')?.textContent).toContain(
        '导出对话记录',
      ),
    );
  });
});
