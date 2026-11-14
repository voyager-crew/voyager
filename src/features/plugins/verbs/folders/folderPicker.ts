/**
 * "Move to folder" picker for a plugin site's folders. It carries its own sheet
 * in a shadow surface (scheme, RTL and the key guard come with it), so the
 * page's CSS cannot restyle it. Its class and ids keep the names ChatGPT's
 * folders first gave them.
 */
import type { Folder, FolderData } from '@/core/types/folder';
import { buildFolderIndex } from '@/features/folder/model/folderIndex';
import { attachShadowSurface } from '@/pages/content/folder/shadowHost';
import { getTranslationSyncUnsafe as t } from '@/utils/i18n';

import pickerCss from './folderPicker.css?raw';

export const FOLDER_PICKER_CLASS = 'gv-chatgpt-folder-picker';

interface FolderOption {
  readonly folder: Folder;
  readonly level: number;
  readonly path: string;
  /** `path` as the search compares it. */
  readonly searchKey: string;
}

function normalizePath(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/\s*\/\s*/g, '/');
}

/**
 * The folders the sidebar tree shows, in its order and under the parents it
 * shows them, with their depth and full path. Reads the shared layout, so
 * orphans, repeated ids and parent cycles resolve as they do in the tree.
 */
function listFolders(data: FolderData): FolderOption[] {
  const { roots, children } = buildFolderIndex(data).layout();
  const options: FolderOption[] = [];
  const visit = (folders: readonly Folder[], level: number, parentPath: string) => {
    for (const folder of folders) {
      const path = parentPath ? `${parentPath} / ${folder.name}` : folder.name;
      options.push({ folder, level, path, searchKey: normalizePath(path) });
      visit(children.get(folder.id) ?? [], level + 1, path);
    }
  };
  visit(roots, 0, '');
  return options;
}

export interface FolderPickerHandle {
  close(): void;
}

/**
 * Opens the picker over the page, titled `heading`; `onSelect` runs once with
 * the chosen folder.
 * The caller closes the picker it opened: any other picker on the page belongs
 * to another runtime and is left alone.
 */
export function openFolderPicker(
  data: FolderData,
  onSelect: (folderId: string) => void,
  heading: string = t('conversation_move_to_folder_title'),
): FolderPickerHandle {
  const host = document.createElement('div');
  host.className = FOLDER_PICKER_CLASS;
  const surface = attachShadowSurface(host, pickerCss);
  const previousFocus = document.activeElement;

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const dialog = document.createElement('div');
  dialog.className = 'dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'gv-chatgpt-folder-picker-title');
  const title = document.createElement('div');
  title.className = 'title';
  title.id = 'gv-chatgpt-folder-picker-title';
  title.textContent = heading;
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'search';
  search.placeholder = t('timelinePreviewSearch');
  search.setAttribute('aria-label', t('timelinePreviewSearch'));
  const list = document.createElement('div');
  list.className = 'list';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'cancel';
  cancel.textContent = t('pm_cancel');

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    surface.disconnect();
    host.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  };

  const options = listFolders(data);
  // Each row is built once, when a search first shows it, and reused after.
  const items = new Map<FolderOption, HTMLButtonElement>();
  const render = (): void => {
    const query = normalizePath(search.value);
    const visible = options.filter((option) => option.searchKey.includes(query));
    list.replaceChildren(
      ...visible.map((option) => {
        const cached = items.get(option);
        if (cached) return cached;
        const { folder, level, path } = option;
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'item';
        item.style.paddingInlineStart = `${level * 16 + 12}px`;
        item.dataset.folderId = folder.id;
        item.setAttribute('aria-label', path);
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = folder.name;
        item.append(name);
        if (level > 0) {
          const location = document.createElement('span');
          location.className = 'path';
          location.textContent = path;
          item.append(location);
        }
        item.addEventListener('click', () => {
          close();
          onSelect(folder.id);
        });
        items.set(option, item);
        return item;
      }),
    );
    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = t('timelinePreviewNoResults');
      list.append(empty);
    }
  };

  search.addEventListener('input', render);
  cancel.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  });

  render();
  dialog.append(title, search, list, cancel);
  overlay.append(dialog);
  surface.root.append(overlay);
  document.body.append(host);
  search.focus();
  return { close };
}
