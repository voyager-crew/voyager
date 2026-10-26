import { createFolderIcon } from '@/core/icons/folderIcons';
import type { Folder } from '@/core/types/folder';
import { getTranslationSyncUnsafe } from '@/utils/i18n';

import { getFolderColor, isDarkMode } from '../folder/folderColors';
import { newChatFolderIsFor, pendingNewChatFolder, takeNewChatFolder } from './pendingFolder';
import { startPickerWork, waitForProjectAnchor } from './pickerWork';
import { readProjectPlacement } from './placement';

/**
 * Folders and the account they belong to, read together in one step: an
 * account read later may already be another one's.
 */
export interface FolderSnapshot {
  readonly account: string | null;
  readonly folders: readonly Folder[];
}

interface FolderProjectPickerOptions {
  loadFolders: () => Promise<FolderSnapshot>;
  /** The folders already loaded, read without loading again (a load may announce itself). */
  loadedFolders?: () => FolderSnapshot;
  /**
   * Whose folders the picker lists now. Options are listed for the account
   * read with them and picked only while the page still shows it; a handoff
   * from another account is not taken.
   */
  currentAccount?: () => string | null;
  canMount: () => boolean;
  onAccountChange?: (listener: () => void) => () => void;
  /** `account`: whose folders `folder` came from (its snapshot's). */
  onSelect: (folder: Folder | null, source: 'user' | 'pending', account: string | null) => void;
}

function t(key: string): string {
  return getTranslationSyncUnsafe(key);
}

/** Shows the selected folder on the chip: a line folder icon and its name. */
function showSelectedFolder(chip: HTMLButtonElement, folder: Folder): void {
  const icon = createFolderIcon(16);
  icon.classList.add('gv-fp-chip-icon');
  const label = document.createElement('span');
  label.className = 'gv-fp-chip-label';
  label.textContent = folder.name;
  chip.replaceChildren(icon, label);
  chip.dataset.selected = folder.id;
}

export function createFolderProjectPicker(options: FolderProjectPickerOptions): {
  show: () => Promise<void>;
  remove: () => void;
  /** Takes the folder this tab's "New chat in this folder" handed off, on the picker shown or one it shows. */
  applyPending: () => Promise<void>;
  /** Tries a handoff the mounted picker could not take yet again, on the loaded folders; mounts nothing. */
  retryPending: () => Promise<void>;
  /** Shows no folder chosen again, as after another account took the page. */
  resetChoice: () => void;
  /** Closes options listed for an account the page no longer shows. */
  dropStaleOptions: () => void;
} {
  let pickerContainer: HTMLElement | null = null;
  let pickerCleanup: (() => void) | null = null;
  let pickerChip: HTMLButtonElement | null = null;
  let pickerDropdown: HTMLElement | null = null;
  /** Whose folders the open options list; `undefined` while none are listed. */
  let listedAccount: string | null | undefined;
  let listing: ReturnType<typeof startPickerWork> | null = null;
  let mounting: ReturnType<typeof startPickerWork> | null = null;
  let pending: ReturnType<typeof startPickerWork> | null = null;

  const accountNow = (): string | null => options.currentAccount?.() ?? null;
  /** Whether options read for `account` may still be picked. */
  const stillShows = (account: string | null): boolean =>
    !options.currentAccount || accountNow() === account;

  function closeDropdown(): void {
    listing?.cancel();
    listing = null;
    listedAccount = undefined;
    if (!pickerDropdown) return;
    pickerDropdown.hidden = true;
    pickerDropdown.replaceChildren();
    pickerChip?.setAttribute('aria-expanded', 'false');
  }

  function dropStaleOptions(): void {
    if (listedAccount !== undefined && !stillShows(listedAccount)) closeDropdown();
  }

  async function populateDropdown(
    dropdown: HTMLElement,
    chip: HTMLButtonElement,
    isCurrent: () => boolean,
  ): Promise<void> {
    dropdown.innerHTML = '';
    const { account, folders: allFolders } = await options.loadFolders();
    if (!isCurrent() || !stillShows(account)) return;
    listedAccount = account;
    // A handoff the first mount could not take (its folders had not loaded) takes them now.
    const pendingId = pendingFolderFor(account);
    const pending = pendingId ? allFolders.find((folder) => folder.id === pendingId) : undefined;
    if (pending && takeNewChatFolder(pending.id)) {
      options.onSelect(pending, 'pending', account);
      showSelectedFolder(chip, pending);
    }

    if (allFolders.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'gv-fp-item';
      empty.textContent = t('folderAsProject_noFolder');
      dropdown.appendChild(empty);
      return;
    }

    // Index children by parentId for tree traversal
    const childrenOf = new Map<string, (typeof allFolders)[number][]>();
    for (const f of allFolders) {
      const key = f.parentId ?? '__root__';
      if (!childrenOf.has(key)) childrenOf.set(key, []);
      childrenOf.get(key)!.push(f);
    }

    // Handler for selecting a folder
    const selectFolder = (folder: (typeof allFolders)[number]) => {
      // Listed for another account than the page shows now: not this one's folder.
      if (!stillShows(account)) {
        closeDropdown();
        return;
      }
      showSelectedFolder(chip, folder);
      dropdown.hidden = true;
      chip.setAttribute('aria-expanded', 'false');
      options.onSelect(folder, 'user', account);
    };

    // "No folder" / clear selection option
    const noneItem = document.createElement('button');
    noneItem.className = 'gv-fp-item';
    noneItem.type = 'button';
    noneItem.setAttribute('role', 'option');
    noneItem.textContent = t('folderAsProject_noFolder');
    noneItem.addEventListener('click', () => {
      chip.textContent = t('folderAsProject_selectFolder');
      chip.removeAttribute('data-selected');
      dropdown.hidden = true;
      chip.setAttribute('aria-expanded', 'false');
      options.onSelect(null, 'user', account);
    });
    dropdown.appendChild(noneItem);

    /**
     * Render folder items for a given parent level.
     *
     * @param parentId - Parent folder ID, or '__root__' for top-level
     * @param container - DOM element to append items to
     */
    const renderLevel = (parentId: string, container: HTMLElement) => {
      const siblings = childrenOf.get(parentId) ?? [];
      for (const folder of siblings) {
        const hasChildren = childrenOf.has(folder.id);

        const row = document.createElement('div');
        row.className = 'gv-fp-tree-row';

        const item = document.createElement('button');
        item.className = 'gv-fp-item';
        item.type = 'button';
        item.setAttribute('role', 'option');
        item.dataset.folderId = folder.id;

        if (folder.color && folder.color !== 'default') {
          const dot = document.createElement('span');
          dot.className = 'gv-fp-color-dot';
          dot.style.backgroundColor = getFolderColor(folder.color, isDarkMode());
          item.appendChild(dot);
        }

        const label = document.createElement('span');
        label.textContent = folder.name;
        item.appendChild(label);

        item.addEventListener('click', () => selectFolder(folder));
        row.appendChild(item);

        if (hasChildren) {
          const arrow = document.createElement('button');
          arrow.className = 'gv-fp-expand-btn';
          arrow.type = 'button';
          arrow.setAttribute('aria-label', t('folderAsProject_expand'));
          arrow.setAttribute('aria-expanded', 'false');
          arrow.innerHTML =
            '<svg class="gv-fp-expand-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z"/></svg>';

          const sublist = document.createElement('div');
          sublist.className = 'gv-fp-sublist';
          sublist.hidden = true;

          arrow.addEventListener('click', (e) => {
            e.stopPropagation();
            const expanding = sublist.hidden;
            sublist.hidden = !expanding;
            arrow.classList.toggle('gv-fp-expand-btn--open', expanding);
            arrow.setAttribute('aria-expanded', String(expanding));
            arrow.setAttribute(
              'aria-label',
              expanding ? t('folderAsProject_collapse') : t('folderAsProject_expand'),
            );
            // Lazy render children on first expand
            if (expanding && sublist.children.length === 0) {
              renderLevel(folder.id, sublist);
            }
          });

          row.appendChild(arrow);
          container.appendChild(row);
          container.appendChild(sublist);
        } else {
          container.appendChild(row);
        }
      }
    };

    renderLevel('__root__', dropdown);
  }

  function buildFolderPicker(): {
    element: HTMLElement;
    chip: HTMLButtonElement;
    cleanup: () => void;
  } {
    const container = document.createElement('div');
    container.className = 'gv-fp-picker-container';

    const chip = document.createElement('button');
    chip.className = 'gv-fp-chip';
    chip.type = 'button';
    chip.setAttribute('aria-haspopup', 'listbox');
    chip.setAttribute('aria-expanded', 'false');
    chip.textContent = t('folderAsProject_selectFolder');

    // Match font-size from the model picker button so it scales with Gemini's CSS
    const modelBtn = readProjectPlacement('project.fontSource');
    if (modelBtn) {
      chip.style.fontSize = getComputedStyle(modelBtn).fontSize;
    }

    const dropdown = document.createElement('div');
    pickerDropdown = dropdown;
    dropdown.className = 'gv-fp-dropdown';
    dropdown.setAttribute('role', 'listbox');
    dropdown.hidden = true;

    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !dropdown.hidden;
      if (!isOpen) {
        listing?.cancel();
        listing = startPickerWork({
          onAccountChange: options.onAccountChange,
          currentAccount: options.currentAccount,
          run: (_signal, isCurrent) => populateDropdown(dropdown, chip, isCurrent),
        });
      }
      if (isOpen) closeDropdown();
      dropdown.hidden = isOpen;
      chip.setAttribute('aria-expanded', String(!isOpen));
    });

    const closeOnOutsideClick = (e: MouseEvent) => {
      if (!container.contains(e.target as Node)) {
        closeDropdown();
      }
    };
    document.addEventListener('click', closeOnOutsideClick);

    container.appendChild(chip);
    container.appendChild(dropdown);
    return {
      element: container,
      chip,
      cleanup: () => document.removeEventListener('click', closeOnOutsideClick),
    };
  }

  // ============================================================================
  // Pending folder selection (from "New chat in folder" menu)
  // ============================================================================

  /**
   * Selects the folder this tab's "New chat in this folder" handed off
   * (`pendingFolder.ts`). The handoff is taken only once the folder is among
   * the ones this page can file into; until then it stays for the next try.
   */
  function pendingFolderFor(account: string | null): string | null {
    const pendingId = pendingNewChatFolder();
    return pendingId && newChatFolderIsFor(account) ? pendingId : null;
  }

  async function applyPendingFolderSelection(
    chip: HTMLButtonElement,
    isCurrent: () => boolean,
    snapshot: () => Promise<FolderSnapshot> | FolderSnapshot = options.loadFolders,
  ): Promise<void> {
    if (!pendingFolderFor(accountNow())) return;
    const { account, folders } = await snapshot();
    // A finished load cannot take a handoff for a removed picker or another account.
    if (!isCurrent() || !stillShows(account) || !chip.isConnected) return;
    const pendingId = pendingFolderFor(account);
    const folder = pendingId ? folders.find((f) => f.id === pendingId) : undefined;
    if (!folder || !takeNewChatFolder(folder.id)) return;

    options.onSelect(folder, 'pending', account);

    showSelectedFolder(chip, folder);
  }

  // ============================================================================
  // Picker lifecycle
  // ============================================================================

  function remove(): void {
    mounting?.cancel();
    mounting = null;
    pending?.cancel();
    pending = null;
    pickerCleanup?.();
    pickerCleanup = null;
    pickerContainer?.remove();
    pickerContainer = null;
    pickerChip = null;
    // The removed dropdown goes with its picker; a load still running lists nothing.
    listing?.cancel();
    listing = null;
    listedAccount = undefined;
    pickerDropdown = null;
  }

  function applyPendingTo(chip: HTMLButtonElement, snapshot = options.loadFolders): Promise<void> {
    pending?.cancel();
    pending = startPickerWork({
      onAccountChange: options.onAccountChange,
      currentAccount: options.currentAccount,
      run: (_signal, isCurrent) => applyPendingFolderSelection(chip, isCurrent, snapshot),
    });
    return pending.done;
  }

  async function mount(signal: AbortSignal, isCurrent: () => boolean): Promise<void> {
    let anchor = await waitForProjectAnchor(
      () => readProjectPlacement('project.modelAnchor'),
      5000,
      signal,
    );
    if (!isCurrent() || !options.canMount()) return;
    if (!anchor?.parentElement) {
      anchor = await waitForProjectAnchor(
        () => readProjectPlacement('project.inputAnchor'),
        3000,
        signal,
      );
    }
    // Old waits must not attach a picker after a route/account change or an off/on cycle.
    if (
      !isCurrent() ||
      !anchor?.parentElement ||
      !options.canMount() ||
      document.querySelector('.gv-fp-picker-container')
    )
      return;
    const { element, cleanup, chip } = buildFolderPicker();
    anchor.parentElement.insertBefore(element, anchor);
    pickerContainer = element;
    pickerCleanup = cleanup;
    pickerChip = chip;
    void applyPendingTo(chip);
  }

  async function show(): Promise<void> {
    if (pickerContainer) return;
    if (!mounting)
      mounting = startPickerWork({
        onAccountChange: options.onAccountChange,
        currentAccount: options.currentAccount,
        run: mount,
      });
    const current = mounting;
    await current.done;
    if (mounting === current) mounting = null;
  }

  async function retryPending(): Promise<void> {
    if (!pickerChip || !pickerContainer?.isConnected) return;
    // Called after load: loading again would announce another load.
    await applyPendingTo(
      pickerChip,
      async () => options.loadedFolders?.() ?? options.loadFolders(),
    );
  }

  function resetChoice(): void {
    closeDropdown();
    if (!pickerChip) return;
    pickerChip.textContent = t('folderAsProject_selectFolder');
    pickerChip.removeAttribute('data-selected');
  }

  async function applyPending(): Promise<void> {
    if (pickerChip && pickerContainer?.isConnected) await applyPendingTo(pickerChip);
    else await show();
  }

  return { show, remove, applyPending, retryPending, resetChoice, dropStaleOptions };
}
