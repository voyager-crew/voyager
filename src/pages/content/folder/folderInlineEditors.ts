import { isImeKeyEvent } from '@/core/services/composer/sendKeys/sendKeyIntent';
import { getTranslationSyncUnsafe as t } from '@/utils/i18n';

import type { DialogView, OwnDialogView } from './folderDialogViews';

function createInlineButtons(container: HTMLElement) {
  const save = document.createElement('button');
  save.className = 'gv-folder-inline-btn gv-folder-inline-save';
  save.innerHTML =
    '<mat-icon class="mat-icon notranslate google-symbols mat-ligature-font mat-icon-no-color" role="img" aria-hidden="true">check</mat-icon>';
  const cancel = document.createElement('button');
  cancel.className = 'gv-folder-inline-btn gv-folder-inline-cancel';
  cancel.innerHTML =
    '<mat-icon class="mat-icon notranslate google-symbols mat-ligature-font mat-icon-no-color" role="img" aria-hidden="true">close</mat-icon>';
  container.append(save, cancel);
  return { save, cancel };
}

/** Enter or save submits a trimmed, non-empty name; Escape and cancel close without submitting. */
function bindNameInput(
  view: DialogView,
  input: HTMLInputElement,
  buttons: { save: HTMLElement; cancel: HTMLElement },
  onSubmit: (name: string) => void,
): void {
  const submit = () => {
    const name = input.value.trim();
    view.close();
    if (name) onSubmit(name);
  };
  buttons.save.addEventListener('click', submit, { signal: view.signal });
  buttons.cancel.addEventListener('click', view.close, { signal: view.signal });
  input.addEventListener(
    'keydown',
    (event) => {
      // Enter or Escape while an IME composes picks or drops a candidate, not the name.
      if (isImeKeyEvent(event)) return;
      if (event.key === 'Enter') submit();
      else if (event.key === 'Escape') view.close();
    },
    { signal: view.signal },
  );
}

/** Inserts the new-folder name editor; the caller records it as active, then focuses it. */
export function insertCreateEditor(
  own: OwnDialogView,
  folderList: HTMLElement,
  parentId: string | null,
  onSubmit: (name: string) => void,
): { view: DialogView; input: HTMLInputElement } {
  const container = document.createElement('div');
  container.className = 'gv-folder-inline-input';
  const view = own(container, true);
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'gv-folder-name-input';
  input.placeholder = t('folder_name_prompt');
  input.maxLength = 50;
  container.appendChild(input);
  const buttons = createInlineButtons(container);
  buttons.save.title = t('pm_save');
  buttons.cancel.title = t('pm_cancel');
  bindNameInput(view, input, buttons, onSubmit);

  const parent = parentId ? folderList.querySelector(`[data-folder-id="${parentId}"]`) : null;
  if (parent) {
    const content = parent.querySelector('.gv-folder-content');
    if (content) content.prepend(container);
    else parent.insertAdjacentElement('afterend', container);
  } else if (parentId) {
    folderList.appendChild(container);
  } else {
    folderList.prepend(container);
  }
  return { view, input };
}

/** Replaces a folder's name with an editor; closing it restores the original name. */
export function openRenameEditor(
  own: OwnDialogView,
  folderElement: Element | null,
  currentName: string,
  onSubmit: (name: string) => void,
): void {
  const name = folderElement?.querySelector('.gv-folder-name');
  if (!name) return;
  const container = document.createElement('span');
  container.className = 'gv-folder-rename-inline';
  const view = own(container, true, () => {
    name.textContent = currentName;
    name.classList.remove('gv-hidden');
  });
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'gv-folder-rename-input';
  input.value = currentName;
  input.maxLength = 50;
  container.appendChild(input);
  bindNameInput(view, input, createInlineButtons(container), onSubmit);
  name.classList.add('gv-hidden');
  name.insertAdjacentElement('afterend', container);
  input.focus();
  input.select();
}
