import { CLOUD_SYNC_PATH, CLOUD_UPLOAD_PATH } from '@/core/icons/cloudSyncPaths';
import { ROOT_CONVERSATIONS_ID } from '@/features/folder/constants';
import type { ConversationIdentity } from '@/features/folder/model/conversationStars';
import type { ConversationSortMode } from '@/features/folder/model/folderData';
import { FOLDER_SITE_POLICIES } from '@/features/folder/owner/folderOwnerPolicy';

import { clearOfPromptTrigger } from '../prompt/triggerClearance';
import panelCss from './floatingPanel.css?raw';
import { type FolderDropTarget, folderDropTargetAt } from './floatingTree/dropTargets';
import { FLOATING_PANEL_CLASS, type TreeActions, t } from './floatingTree/shared';
import { mountFolderTree } from './floatingTree/treeController';
import { attachShadowSurface } from './shadowHost';
import type { FolderData } from './types';

export { FLOATING_PANEL_CLASS };

export type FloatingPanelPos = { x: number; y: number };
export type FloatingPanelSize = { w: number; h: number };

/** A header button a site adds before the create (+) button. */
export type FloatingPanelHeaderAction = {
  /** BEM modifier: `gv-floating-folder-panel__icon-button--<modifier>`. */
  modifier: string;
  labelKey: string;
  /** Material Symbols path data, viewBox `0 -960 960 960`. */
  iconPath: string;
  onClick: () => void;
};

export type MountArgs = TreeActions & {
  data: FolderData;
  /** Gemini's Drive buttons; a site without Drive sync passes `false`. Defaults to on. */
  cloudActions?: boolean;
  headerActions?: readonly FloatingPanelHeaderAction[];
  /** Hint rows under the header; defaults to Gemini's move and gesture hints. */
  hintKeys?: readonly string[];
  /** Defaults to Gemini's root bucket. */
  rootBucketId?: string;
  /** Which rows are one conversation, sharing one star; defaults to Gemini's. */
  conversationIdentity?: ConversationIdentity;
  dataReady?: boolean;
  conversationSortMode?: ConversationSortMode;
  storedPos?: FloatingPanelPos | null;
  storedSize?: FloatingPanelSize | null;
  onPosChange?: (pos: FloatingPanelPos) => void;
  onSizeChange?: (size: FloatingPanelSize) => void;
  onClose?: () => void;
  onCloudUpload?: () => void;
  onCloudSync?: () => void;
  getCloudUploadTooltip?: () => Promise<string>;
  getCloudSyncTooltip?: () => Promise<string>;
};

export type FloatingPanelMountArgs = MountArgs;

export type FloatingPanelHandle = {
  element: HTMLElement;
  setDataReady: (ready: boolean) => void;
  /** The folder drop target under a viewport point, for a drag driven by pointer events. */
  dropTargetAt: (x: number, y: number) => FolderDropTarget | null;
  update: (data: FolderData, conversationSortMode?: ConversationSortMode) => void;
  /** Replaces account data and discards transient edits without changing panel geometry. */
  reset: (data: FolderData, conversationSortMode?: ConversationSortMode) => void;
  destroy: () => void;
};

const MIN_MARGIN = 8;
const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 420;
const MIN_PANEL_WIDTH = 280;
const MIN_PANEL_HEIGHT = 320;
const MAX_PANEL_WIDTH = 640;
const VIEWPORT_SIZE_MARGIN = 32;
const SIZE_CHANGE_DEBOUNCE_MS = 300;
const DEFAULT_HINT_KEYS = ['floatingPanelMoveHint', 'floatingPanelGestureHint'];
const HINT_ICONS = ['i', '?'];

function clampPos(pos: FloatingPanelPos, width: number, height: number): FloatingPanelPos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    x: Math.max(MIN_MARGIN, Math.min(pos.x, Math.max(MIN_MARGIN, vw - width - MIN_MARGIN))),
    y: Math.max(MIN_MARGIN, Math.min(pos.y, Math.max(MIN_MARGIN, vh - height - MIN_MARGIN))),
  };
}

function clampSize(size: FloatingPanelSize): FloatingPanelSize {
  const maxWidth = Math.max(
    MIN_PANEL_WIDTH,
    Math.min(MAX_PANEL_WIDTH, window.innerWidth - VIEWPORT_SIZE_MARGIN),
  );
  const maxHeight = Math.max(MIN_PANEL_HEIGHT, window.innerHeight - VIEWPORT_SIZE_MARGIN);

  return {
    w: Math.max(MIN_PANEL_WIDTH, Math.min(size.w, maxWidth)),
    h: Math.max(MIN_PANEL_HEIGHT, Math.min(size.h, maxHeight)),
  };
}

function getPanelSize(panel: HTMLElement): FloatingPanelSize {
  const rect = panel.getBoundingClientRect();
  return clampSize({
    w: Math.round(rect.width || panel.offsetWidth || DEFAULT_WIDTH),
    h: Math.round(rect.height || panel.offsetHeight || DEFAULT_HEIGHT),
  });
}

function isSameSize(a: FloatingPanelSize, b: FloatingPanelSize): boolean {
  return a.w === b.w && a.h === b.h;
}

function defaultPos(size: FloatingPanelSize): FloatingPanelPos {
  return clearOfPromptTrigger({
    x: Math.max(MIN_MARGIN, window.innerWidth - size.w - 24),
    y: Math.max(MIN_MARGIN, window.innerHeight - size.h - 24),
    ...size,
  });
}

function createIconButton(
  modifier: string,
  labelKey: string,
  text: string,
  onClick: (e: MouseEvent) => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `${FLOATING_PANEL_CLASS}__icon-button ${FLOATING_PANEL_CLASS}__icon-button--${modifier}`;
  button.setAttribute('aria-label', t(labelKey));
  button.title = t(labelKey);
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

function createSvgIconButton(
  modifier: string,
  labelKey: string,
  pathData: string,
  onClick: (e: MouseEvent) => void,
): HTMLButtonElement {
  const button = createIconButton(modifier, labelKey, '', onClick);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('height', '20px');
  svg.setAttribute('viewBox', '0 -960 960 960');
  svg.setAttribute('width', '20px');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathData);
  svg.appendChild(path);
  button.appendChild(svg);
  return button;
}

function updateTooltipOnHover(
  button: HTMLButtonElement,
  getTooltip: (() => Promise<string>) | undefined,
): void {
  if (!getTooltip) return;

  button.addEventListener('mouseenter', () => {
    void getTooltip()
      .then((tooltip) => {
        button.title = tooltip;
      })
      .catch(() => {});
  });
}

function createHintRow(key: string, iconText: string): HTMLElement {
  const row = document.createElement('div');
  row.className = `${FLOATING_PANEL_CLASS}__move-hint`;

  const icon = document.createElement('span');
  icon.className = `${FLOATING_PANEL_CLASS}__move-hint-icon`;
  icon.textContent = iconText;
  icon.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.className = `${FLOATING_PANEL_CLASS}__move-hint-text`;
  text.textContent = t(key);

  row.appendChild(icon);
  row.appendChild(text);
  return row;
}

function createHintStack(keys: readonly string[]): HTMLElement {
  const stack = document.createElement('div');
  stack.className = `${FLOATING_PANEL_CLASS}__hint-stack`;
  keys.forEach((key, index) => stack.appendChild(createHintRow(key, HINT_ICONS[index] ?? 'i')));
  return stack;
}

export function mountFloatingPanel({
  data,
  cloudActions = true,
  headerActions: siteActions = [],
  hintKeys = DEFAULT_HINT_KEYS,
  dataReady = true,
  conversationSortMode = 'manual',
  rootBucketId = ROOT_CONVERSATIONS_ID,
  conversationIdentity = FOLDER_SITE_POLICIES.gemini,
  storedPos,
  storedSize,
  onPosChange,
  onSizeChange,
  onClose,
  onNavigate,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  confirmFolderRemoval,
  onRemoveConversation,
  onToggleStar,
  onToggleFolderPinned,
  onToggleFolderExpanded,
  confirmConversationRemoval,
  onMoveConversation,
  onSetFolderColor,
  onAddCurrentConversation,
  onDrop,
  onCloudUpload,
  onCloudSync,
  getCloudUploadTooltip,
  getCloudSyncTooltip,
}: MountArgs): FloatingPanelHandle {
  const existing = document.querySelector(`.${FLOATING_PANEL_CLASS}`);
  if (existing) existing.remove();

  const panel = document.createElement('div');
  panel.className = FLOATING_PANEL_CLASS;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', t('floatingPanelTitle'));

  const header = document.createElement('div');
  header.className = `${FLOATING_PANEL_CLASS}__header`;

  const title = document.createElement('div');
  title.className = `${FLOATING_PANEL_CLASS}__title`;
  title.textContent = t('floatingPanelTitle');

  const headerActions = document.createElement('div');
  headerActions.className = `${FLOATING_PANEL_CLASS}__header-actions`;

  if (cloudActions) {
    const cloudUploadBtn = createSvgIconButton(
      'cloud-upload',
      'floatingPanelCloudUpload',
      CLOUD_UPLOAD_PATH,
      (e) => {
        e.stopPropagation();
        onCloudUpload?.();
      },
    );
    updateTooltipOnHover(cloudUploadBtn, getCloudUploadTooltip);

    const cloudSyncBtn = createSvgIconButton(
      'cloud-sync',
      'floatingPanelCloudSync',
      CLOUD_SYNC_PATH,
      (e) => {
        e.stopPropagation();
        onCloudSync?.();
      },
    );
    updateTooltipOnHover(cloudSyncBtn, getCloudSyncTooltip);

    headerActions.appendChild(cloudUploadBtn);
    headerActions.appendChild(cloudSyncBtn);
  }

  for (const action of siteActions) {
    headerActions.appendChild(
      createSvgIconButton(action.modifier, action.labelKey, action.iconPath, (e) => {
        e.stopPropagation();
        action.onClick();
      }),
    );
  }

  const createBtn = createIconButton('create', 'floatingPanelCreateFolder', '+', (e) => {
    e.stopPropagation();
    tree.apply({ inlineEditor: { mode: 'create', parentId: null }, contextMenu: null });
  });

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = `${FLOATING_PANEL_CLASS}__close`;
  closeBtn.setAttribute('aria-label', t('floatingPanelClose'));
  closeBtn.textContent = '×';

  header.appendChild(title);
  headerActions.appendChild(createBtn);
  headerActions.appendChild(closeBtn);
  header.appendChild(headerActions);

  const body = document.createElement('div');
  body.className = `${FLOATING_PANEL_CLASS}__body`;

  const setDataReady = (ready: boolean): void => {
    body.inert = !ready;
    body.setAttribute('aria-busy', String(!ready));
    headerActions
      .querySelectorAll<HTMLButtonElement>(`.${FLOATING_PANEL_CLASS}__icon-button`)
      .forEach((button) => {
        button.disabled = !ready;
      });
  };
  setDataReady(dataReady);

  const surface = attachShadowSurface(panel, panelCss);
  surface.root.append(header, createHintStack(hintKeys), body);

  const initialSize = clampSize(storedSize ?? { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT });
  const initialPos = clampPos(storedPos ?? defaultPos(initialSize), initialSize.w, initialSize.h);
  panel.style.left = `${initialPos.x}px`;
  panel.style.top = `${initialPos.y}px`;
  panel.style.width = `${initialSize.w}px`;
  panel.style.height = `${initialSize.h}px`;

  // Drag support — header is the grabbable handle. Panel dimensions are read
  // once at drag start and reused on every move: interleaving offsetWidth/
  // offsetHeight reads with style writes inside pointermove forces a layout
  // pass per event (the panel doesn't resize mid-drag anyway).
  let dragState: { offsetX: number; offsetY: number; width: number; height: number } | null = null;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return; // primary button only — no right/middle drags
    const target = e.target as HTMLElement;
    if (target.closest(`.${FLOATING_PANEL_CLASS}__close`)) return;
    if (target.closest(`.${FLOATING_PANEL_CLASS}__icon-button`)) return;
    const rect = panel.getBoundingClientRect();
    dragState = {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width || panel.offsetWidth,
      height: rect.height || panel.offsetHeight,
    };
    header.setPointerCapture(e.pointerId);
    header.classList.add(`${FLOATING_PANEL_CLASS}__header--dragging`);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragState) return;
    const next = clampPos(
      { x: e.clientX - dragState.offsetX, y: e.clientY - dragState.offsetY },
      dragState.width,
      dragState.height,
    );
    panel.style.left = `${next.x}px`;
    panel.style.top = `${next.y}px`;
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!dragState) return;
    dragState = null;
    try {
      header.releasePointerCapture(e.pointerId);
    } catch {}
    header.classList.remove(`${FLOATING_PANEL_CLASS}__header--dragging`);
    onPosChange?.({ x: panel.offsetLeft, y: panel.offsetTop });
  };

  header.addEventListener('pointerdown', onPointerDown);
  header.addEventListener('pointermove', onPointerMove);
  header.addEventListener('pointerup', onPointerUp);
  header.addEventListener('pointercancel', onPointerUp);

  let lastCommittedSize = initialSize;
  let sizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  const commitObservedSize = (size: FloatingPanelSize) => {
    if (isSameSize(size, lastCommittedSize)) return;
    lastCommittedSize = size;
    onSizeChange?.(size);
  };

  const scheduleSizeCommit = (size: FloatingPanelSize) => {
    if (isSameSize(size, lastCommittedSize)) return;
    if (sizeDebounceTimer) clearTimeout(sizeDebounceTimer);
    sizeDebounceTimer = setTimeout(() => {
      sizeDebounceTimer = null;
      commitObservedSize(getPanelSize(panel));
    }, SIZE_CHANGE_DEBOUNCE_MS);
  };

  const resizeObserver =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          const nextSize = getPanelSize(panel);
          const nextPos = clampPos(
            { x: panel.offsetLeft, y: panel.offsetTop },
            nextSize.w,
            nextSize.h,
          );
          panel.style.left = `${nextPos.x}px`;
          panel.style.top = `${nextPos.y}px`;
          scheduleSizeCommit(nextSize);
        })
      : null;
  resizeObserver?.observe(panel);

  const actions: TreeActions = {
    onNavigate,
    onCreateFolder,
    onRenameFolder,
    onDeleteFolder,
    confirmFolderRemoval,
    onRemoveConversation,
    confirmConversationRemoval,
    onToggleStar,
    onToggleFolderPinned,
    onToggleFolderExpanded,
    onMoveConversation,
    onSetFolderColor,
    onAddCurrentConversation,
    onDrop,
  };
  const tree = mountFolderTree({
    body,
    boundary: panel,
    focusRoot: surface.root,
    data,
    rootBucketId,
    conversationSortMode,
    actions,
    site: { conversationIdentity },
  });

  const onResize = () => {
    const clamped = clampPos(
      { x: panel.offsetLeft, y: panel.offsetTop },
      panel.offsetWidth,
      panel.offsetHeight,
    );
    panel.style.left = `${clamped.x}px`;
    panel.style.top = `${clamped.y}px`;
  };
  window.addEventListener('resize', onResize);

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    destroy();
    onClose?.();
  });

  const destroy = () => {
    window.removeEventListener('resize', onResize);
    resizeObserver?.disconnect();
    if (sizeDebounceTimer) {
      clearTimeout(sizeDebounceTimer);
      sizeDebounceTimer = null;
    }
    tree.destroy();
    surface.disconnect();
    panel.remove();
  };

  document.body.appendChild(panel);

  return {
    element: panel,
    setDataReady,
    dropTargetAt: (x, y) => folderDropTargetAt(surface.root, x, y),
    reset: tree.reset,
    update: tree.update,
    destroy,
  };
}
