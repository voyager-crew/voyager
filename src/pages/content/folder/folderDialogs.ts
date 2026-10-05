import type { Folder } from '@/core/types/folder';
import { askConfirm } from '@/core/ui/confirm';
import { getTranslationSyncUnsafe as t } from '@/utils/i18n';

import {
  type DialogView,
  dismissOnOutsideClick,
  openColorPicker,
  openInstructionsDialog,
  openMoveDialog,
} from './folderDialogViews';
import { insertCreateEditor, openRenameEditor } from './folderInlineEditors';

type FolderMenuAction = { label: string; action: () => void };

export type FolderDialogs = {
  openCreate: (
    folderList: HTMLElement | null,
    parentId: string | null,
    onSubmit: (name: string) => void,
  ) => void;
  openRename: (
    folderElement: Element | null,
    currentName: string,
    onSubmit: (name: string) => void,
  ) => void;
  openColor: (
    folderId: string,
    currentColor: string | undefined,
    event: MouseEvent,
    onSelect: (color: string) => void,
    allowToggle?: boolean,
  ) => void;
  /** `returnFocus` takes focus on close if the opener is gone (a closed native menu's item). */
  openMove: (
    folders: readonly Folder[],
    onSelect: (folderId: string) => void,
    returnFocus?: HTMLElement | null,
  ) => void;
  openInstructions: (
    instructions: string | undefined,
    onSave: (instructions: string | undefined) => Promise<boolean>,
  ) => void;
  /**
   * Asks under `anchor`, the row being removed, lined up with its inline end;
   * `onConfirm` runs only if the answer arrives before a close.
   */
  confirmFolderRemoval: (anchor: HTMLElement, onConfirm: () => void) => void;
  confirmConversationRemoval: (title: string, anchor: HTMLElement, onConfirm: () => void) => void;
  openMenu: (
    event: MouseEvent,
    items: readonly FolderMenuAction[],
    kind?: 'folder' | 'conversation',
  ) => void;
  closeInline: () => void;
  /** Close everything except the modals that hold unsaved input. */
  closeTransient: () => void;
  closeAll: () => void;
};

/** Owns temporary folder views, including listeners and deferred focus, for one runtime. */
export function createFolderDialogs(): FolderDialogs {
  const views = new Set<DialogView>();
  let activeCreate: { view: DialogView; input: HTMLInputElement } | null = null;
  let activeColor: { view: DialogView; folderId: string } | null = null;
  let conversationMenu: DialogView | null = null;
  // Removal confirms are anchored to a row, so every close ends them.
  let confirms = new AbortController();

  const askRemoval = async (
    anchor: HTMLElement,
    message: string,
    label: string,
    onConfirm: () => void,
  ): Promise<void> => {
    const { signal } = confirms;
    const answer = await askConfirm({
      message,
      anchor,
      // The row's menu or remove button sits at its inline end: answer under it.
      align: 'end',
      tone: 'danger',
      choices: [{ id: 'confirm', label }],
      signal,
    });
    if (answer === 'confirm' && !signal.aborted) onConfirm();
  };
  const endConfirms = (): void => {
    confirms.abort();
    confirms = new AbortController();
  };

  const own = (
    element: HTMLElement,
    inline = false,
    restore?: () => void,
    modal = false,
  ): DialogView => {
    const controller = new AbortController();
    const timers = new Set<number>();
    const view: DialogView = {
      element,
      inline,
      modal,
      signal: controller.signal,
      close: () => {
        if (controller.signal.aborted) return;
        controller.abort();
        for (const timer of timers) window.clearTimeout(timer);
        timers.clear();
        element.remove();
        restore?.();
        views.delete(view);
        if (activeCreate?.view === view) activeCreate = null;
        if (activeColor?.view === view) activeColor = null;
        if (conversationMenu === view) conversationMenu = null;
      },
      defer: (action, delay) => {
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          if (!controller.signal.aborted) action();
        }, delay);
        timers.add(timer);
      },
    };
    views.add(view);
    return view;
  };

  return {
    openCreate: (folderList, parentId, onSubmit) => {
      if (activeCreate && !activeCreate.view.element.isConnected) activeCreate.view.close();
      if (activeCreate) {
        activeCreate.input.focus();
        return;
      }
      if (!folderList) return;
      activeCreate = insertCreateEditor(own, folderList, parentId, onSubmit);
      activeCreate.input.focus();
    },

    openRename: (folderElement, currentName, onSubmit) =>
      openRenameEditor(own, folderElement, currentName, onSubmit),

    openColor: (folderId, currentColor, event, onSelect, allowToggle = true) => {
      if (activeColor) {
        const sameFolder = activeColor.folderId === folderId;
        activeColor.view.close();
        if (sameFolder && allowToggle) return;
      }
      const view = openColorPicker(own, currentColor, event, onSelect);
      activeColor = { view, folderId };
    },

    openMove: (folders, onSelect, returnFocus) =>
      openMoveDialog(own, folders, onSelect, returnFocus),

    openInstructions: (instructions, onSave) => openInstructionsDialog(own, instructions, onSave),

    confirmFolderRemoval: (anchor, onConfirm) =>
      void askRemoval(anchor, t('folder_delete_confirm'), t('folder_delete'), onConfirm),

    confirmConversationRemoval: (title, anchor, onConfirm) =>
      void askRemoval(
        anchor,
        t('folder_remove_conversation_confirm').replace('{title}', () => title),
        // Removing from a folder keeps the conversation, so it is not a delete.
        t('folder_remove_conversation_action'),
        onConfirm,
      ),

    openMenu: (event, items, kind = 'folder') => {
      event.stopPropagation();
      if (kind === 'conversation') conversationMenu?.close();
      const menu = document.createElement('div');
      menu.className =
        kind === 'conversation' ? 'gv-folder-menu gv-folder-conversation-menu' : 'gv-folder-menu';
      menu.style.position = 'fixed';
      menu.style.left = `${event.clientX}px`;
      menu.style.top = `${event.clientY}px`;
      const view = own(menu);
      if (kind === 'conversation') conversationMenu = view;
      for (const item of items) {
        const button = document.createElement('button');
        button.className = 'gv-folder-menu-item';
        button.textContent = item.label;
        button.addEventListener(
          'click',
          () => {
            if (kind === 'conversation') view.close();
            item.action();
            view.close();
          },
          { signal: view.signal },
        );
        menu.appendChild(button);
      }
      document.body.appendChild(menu);
      dismissOnOutsideClick(view);
    },

    closeInline: () => {
      for (const view of views) if (view.inline) view.close();
    },
    closeTransient: () => {
      endConfirms();
      for (const view of views) if (!view.modal) view.close();
    },
    closeAll: () => {
      endConfirms();
      for (const view of views) view.close();
    },
  };
}
