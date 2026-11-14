import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FLOATING_PANEL_CLASS,
  click,
  destroyMountedPanels,
  keydown,
  mountPanel,
  panelRoot,
  requireElement,
} from './__tests__/floatingPanelHarness';
import { createFolderDialogs } from './folderDialogs';

vi.mock('@/utils/i18n', () => ({
  getTranslationSync: (key: string) => key,
  getTranslationSyncUnsafe: (key: string) => key,
}));

afterEach(() => {
  destroyMountedPanels();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const composing = (key: string): KeyboardEvent =>
  new KeyboardEvent('keydown', { key, isComposing: true, bubbles: true, composed: true });

describe('folder name inputs while an IME composes', () => {
  it('leaves Enter and Escape to the IME in the folder tree, then submits on the next Enter', () => {
    const onCreateFolder = vi.fn();
    const handle = mountPanel({ onCreateFolder });
    click(requireElement(panelRoot(handle), `.${FLOATING_PANEL_CLASS}__icon-button--create`));
    const input = requireElement<HTMLInputElement>(
      panelRoot(handle),
      `.${FLOATING_PANEL_CLASS}__inline-input`,
    );
    input.value = '工作';
    input.dispatchEvent(composing('Enter'));
    input.dispatchEvent(composing('Escape'));

    expect(onCreateFolder).not.toHaveBeenCalled();
    expect(input.isConnected).toBe(true);

    keydown(input, 'Enter');
    expect(onCreateFolder).toHaveBeenCalledWith('工作', null);
  });

  it("leaves Enter and Escape to the IME in Gemini's sidebar rename", () => {
    document.body.innerHTML = `
      <div class="gv-folder-list">
        <div data-folder-id="parent">
          <div class="gv-folder-item-header"><span class="gv-folder-name">Original</span></div>
        </div>
      </div>`;
    const dialogs = createFolderDialogs();
    const onSubmit = vi.fn();
    dialogs.openRename(
      requireElement(document.body, '[data-folder-id="parent"]'),
      'Original',
      onSubmit,
    );
    const input = requireElement<HTMLInputElement>(document.body, '.gv-folder-rename-input');
    input.value = '工作';
    input.dispatchEvent(composing('Enter'));
    // Safari can end composition before the candidate-confirming key arrives.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 229 }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(input.isConnected).toBe(true);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('工作');
    dialogs.closeAll();
  });
});
