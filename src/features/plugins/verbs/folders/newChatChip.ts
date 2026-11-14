/**
 * The folder chip on a plugin site's new chat: a small tab on the composer's
 * top edge, at its start, that shows which folder the conversation the first
 * send creates goes into. Its name opens the folder picker, × drops the
 * folder; with no folder pending it offers one, muted, wherever the user has
 * folders. It shows only on the new-chat page and follows the composer the way
 * the counter badge does: anchored on the composer root above any ancestor
 * that clips, and re-bound once the page settles after the host re-renders.
 */
import { createFolderIcon, createXIcon } from '@/core/icons/folderIcons';
import { findComposer } from '@/core/services/composer';
import {
  type AnchorPosition,
  composerRootOf,
  positionAnchor,
  unclippedAnchor,
} from '@/core/services/composer/composerAnchor';
import type { Machine } from '@/features/plugins/runtime/stateMachine';
import { attachShadowSurface } from '@/pages/content/folder/shadowHost';
import { watchRouteChanges } from '@/pages/content/utils/routeWatcher';
import { getTranslationSyncUnsafe as t, onCachedLanguageChange } from '@/utils/i18n';

import type { FolderPickerHandle } from './folderPicker';
import chipCss from './newChatChip.css?raw';
import type { NewChatEvent, NewChatPort, NewChatState } from './newChatFiling';

export const NEW_CHAT_CHIP_CLASS = 'gv-new-chat-folder-chip';
/** Added to a statically positioned anchor while it holds the chip. */
const ANCHOR_CLASS = 'gv-new-chat-folder-chip-anchor';
/** `contentStyle.css` is not on every plugin site, so the anchor's one rule comes with the chip. */
const ANCHOR_CSS = `.${ANCHOR_CLASS} { position: relative !important; }`;
/** SPA navigation replaces the composer; the chip follows once the page settles. */
const REBIND_DELAY_MS = 250;
/** Room the chip takes above its anchor: `bottom: calc(100% + 4px)` and a 26px tab. */
const CHIP_CLEARANCE_PX = 30;

type ChipMachine = Pick<Machine<NewChatState, NewChatEvent>, 'state' | 'send' | 'subscribe'>;

type ChipView =
  | { readonly kind: 'none' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'folder'; readonly name: string; readonly editable: boolean };

/** What the chip shows for `state`. */
function chipView(port: NewChatPort, state: NewChatState): ChipView {
  if (!port.isNewChat(location.href)) return { kind: 'none' };
  const name = state.status === 'idle' ? null : port.folderName(state.folderId);
  if (name !== null) {
    // A sent chat's folder is settled; the chip only shows it until the route names the chat.
    return { kind: 'folder', name, editable: state.status === 'composing' };
  }
  return port.hasFolders() ? { kind: 'empty' } : { kind: 'none' };
}

function button(className: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  return element;
}

/** Mounts the chip; the returned function removes it and everything it holds. */
export function mountNewChatChip(port: NewChatPort, machine: ChipMachine): () => void {
  const host = document.createElement('div');
  host.className = NEW_CHAT_CHIP_CLASS;
  const surface = attachShadowSurface(host, chipCss);
  const anchorStyle = document.createElement('style');
  anchorStyle.setAttribute('data-gv-plugin-scope', '');
  anchorStyle.textContent = ANCHOR_CSS;
  document.head.append(anchorStyle);

  const chip = document.createElement('div');
  chip.className = 'chip';
  const pick = button('pick');
  const label = document.createElement('span');
  label.className = 'label';
  pick.append(createFolderIcon(14), label);
  const clear = button('clear');
  clear.append(createXIcon(14));
  chip.append(pick, clear);
  surface.root.append(chip);

  let anchor: HTMLElement | null = null;
  let anchorPosition: AnchorPosition | undefined;
  let picker: FolderPickerHandle | null = null;
  let rebindTimer: ReturnType<typeof setTimeout> | undefined;

  const closePicker = (): void => {
    picker?.close();
    picker = null;
  };

  const releaseAnchor = (): void => {
    host.remove();
    anchorPosition?.release();
    anchor = null;
    anchorPosition = undefined;
  };

  const place = (): void => {
    const field = findComposer(port.composer, { requireVisible: false });
    const root = composerRootOf(field, port.composerRoot);
    const next = root && unclippedAnchor(root, window, CHIP_CLEARANCE_PX);
    if (next !== anchor) {
      releaseAnchor();
      anchor = next;
      if (anchor) anchorPosition = positionAnchor(anchor, window, ANCHOR_CLASS, host);
    }
    anchorPosition?.reapply();
    if (anchor && host.parentElement !== anchor) anchor.append(host);
  };

  const render = (): void => {
    const state = machine.state;
    // The folder was deleted while the new chat waited for it.
    if (state.status === 'composing' && port.folderName(state.folderId) === null) {
      machine.send({ type: 'choose', folderId: null });
    }
    const view = chipView(port, state);
    if (view.kind === 'none') {
      closePicker();
      releaseAnchor();
      return;
    }
    chip.toggleAttribute('data-empty', view.kind === 'empty');
    label.textContent = view.kind === 'folder' ? view.name : t('folder_title');
    pick.title = t('folderAsProject_selectFolder');
    pick.disabled = view.kind === 'folder' && !view.editable;
    clear.hidden = view.kind !== 'folder';
    clear.disabled = view.kind === 'folder' && !view.editable;
    clear.setAttribute('aria-label', t('folderAsProject_noFolder'));
    clear.title = t('folderAsProject_noFolder');
    if (view.kind === 'folder' && !view.editable) closePicker();
    place();
  };

  pick.addEventListener('click', () => {
    closePicker();
    picker = port.pickFolder((folderId) => {
      picker = null;
      // The picker may outlive the new chat it was opened on.
      if (port.isNewChat(location.href)) machine.send({ type: 'choose', folderId });
    });
  });
  clear.addEventListener('click', () => machine.send({ type: 'choose', folderId: null }));
  // The chip sits inside the composer: the host's own handlers there (focus the prompt on
  // a press) must not take the press, nor the picker's focus, from it.
  for (const type of ['pointerdown', 'mousedown', 'click'] as const) {
    chip.addEventListener(type, (event) => event.stopPropagation());
  }

  const isOwnRecord = (record: MutationRecord): boolean =>
    [...record.addedNodes, ...record.removedNodes].every((node) => node === host);
  const pageObserver = new MutationObserver((records) => {
    if (records.every(isOwnRecord)) return;
    clearTimeout(rebindTimer);
    // The folders' own section re-renders here too, so a renamed or first folder shows.
    rebindTimer = setTimeout(render, REBIND_DELAY_MS);
  });
  pageObserver.observe(document.body, { childList: true, subtree: true });
  const stopRoutes = watchRouteChanges(render);
  const stopState = machine.subscribe(render);
  const stopLanguage = onCachedLanguageChange(render);
  render();

  return () => {
    pageObserver.disconnect();
    clearTimeout(rebindTimer);
    stopRoutes();
    stopState();
    stopLanguage();
    closePicker();
    releaseAnchor();
    surface.disconnect();
    anchorStyle.remove();
  };
}
