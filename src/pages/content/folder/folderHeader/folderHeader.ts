/**
 * The folder section's header, shared by Gemini's sidebar and ChatGPT's sidebar
 * section: a title with its collapse control, then an ordered row of buttons.
 * A button runs its action or opens a menu; it may be a toggle (`aria-pressed`),
 * appear only while the header is in use (`reveal`), or be the header's primary
 * "create" button. Gemini styles it with the page sheet `ensureFolderHeaderStyle`
 * installs; a shadow-rooted host adds `FOLDER_HEADER_CSS` to its own sheet and
 * re-points the `--gv-folder-header-*` tokens.
 */
import { CLOUD_SYNC_PATH, CLOUD_UPLOAD_PATH } from '@/core/icons/cloudSyncPaths';
import {
  createChevronDownIcon,
  createChevronRightIcon,
  createCloudIcon,
} from '@/core/icons/folderIcons';
import { getTranslationSyncUnsafe as t } from '@/utils/i18n';

import { ensurePageSheet } from '../pageSheet';
import headerCss from './folderHeader.css?raw';
import { openFolderHeaderMenu } from './folderHeaderMenu';

export const FOLDER_HEADER_CSS = headerCss;

export const FOLDER_HEADER_CLASS = 'gv-folder-header';
const ACTIONS_CLASS = 'gv-folder-header-actions';
const ACTION_CLASS = 'gv-folder-action-btn';
const PRIMARY_CLASS = 'gv-folder-add-btn';
const REVEAL_CLASS = 'gv-folder-header-reveal';
const TOGGLE_CLASS = 'gv-folder-section-toggle';
const TITLE_TOGGLE_CLASS = `${TOGGLE_CLASS}--title`;
const LABEL_KEY_ATTR = 'data-gv-label-key';
const PAGE_STYLE_CLASS = 'gv-folder-header-style';

export type FolderHeaderMenuItem = {
  label: string;
  /** A Material Symbols ligature, for menus drawn in a page that has the font. */
  icon?: string;
  /** Constant SVG markup owned by the caller. */
  iconHtml?: string;
  action: () => void;
};

/** Opens a button's menu; Gemini passes its own header menus, others get a popover. */
export type FolderHeaderMenuOpener = (
  event: MouseEvent,
  anchor: HTMLButtonElement,
  items: readonly FolderHeaderMenuItem[],
) => void;

export type FolderHeaderAction = {
  /** The button's role classes, which callers and tests find it by. */
  className: string;
  icon: () => SVGElement;
  /** Title and accessible name; a toggle whose label follows its state sets it later. */
  labelKey?: string;
  /** "Create folder": drawn as the header's primary button. */
  primary?: boolean;
  /** Shown only while the header is hovered or focused, unless pressed. */
  reveal?: boolean;
  /** A toggle: its initial `aria-pressed`. */
  pressed?: boolean;
  hidden?: boolean;
  attributes?: Readonly<Record<string, string>>;
  onClick?: (event: MouseEvent) => void;
  /** Items to show when pressed, read at press time. */
  menu?: () => readonly FolderHeaderMenuItem[];
  /** A fuller title, read each time the pointer or focus arrives; the accessible name stays the label. */
  tooltip?: () => Promise<string>;
};

export type FolderHeaderOptions = {
  /** Extra classes on the header row. */
  className?: string;
  title: { tag: 'h1' | 'h2'; labelKey: string; className?: string };
  /**
   * `byTitle`: the title itself is the collapse button (ChatGPT's own section
   * headings work so); otherwise a chevron beside the title collapses.
   */
  collapse: { onToggle: () => void; byTitle?: boolean };
  actions: readonly FolderHeaderAction[];
  openMenu?: FolderHeaderMenuOpener;
  /** Keep header clicks from reaching the host's own handlers (a link row, a drop zone). */
  containClicks?: boolean;
};

const defaultOpenMenu: FolderHeaderMenuOpener = (_event, anchor, items) =>
  openFolderHeaderMenu(anchor, items);

function setLabel(button: HTMLElement, label: string): void {
  button.title = label;
  button.setAttribute('aria-label', label);
}

function createActionButton(
  action: FolderHeaderAction,
  options: FolderHeaderOptions,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.classList.add(
    action.primary ? PRIMARY_CLASS : ACTION_CLASS,
    ...action.className.split(/\s+/).filter(Boolean),
  );
  if (action.reveal) button.classList.add(REVEAL_CLASS);
  button.replaceChildren(action.icon());
  if (action.labelKey) {
    button.setAttribute(LABEL_KEY_ATTR, action.labelKey);
    setLabel(button, t(action.labelKey));
  }
  if (action.pressed !== undefined) button.setAttribute('aria-pressed', String(action.pressed));
  if (action.hidden) button.hidden = true;
  for (const [name, value] of Object.entries(action.attributes ?? {})) {
    button.setAttribute(name, value);
  }
  const tooltip = action.tooltip;
  if (tooltip) {
    const refresh = (): void =>
      void tooltip()
        .then((title) => {
          button.title = title;
        })
        .catch(() => {});
    button.addEventListener('mouseenter', refresh);
    button.addEventListener('focus', refresh);
  }
  const openMenu = options.openMenu ?? defaultOpenMenu;
  button.addEventListener('click', (event) => {
    if (options.containClicks) event.stopPropagation();
    if (action.menu) openMenu(event, button, action.menu());
    else action.onClick?.(event);
  });
  return button;
}

function createTitle(options: FolderHeaderOptions): HTMLElement {
  const container = document.createElement('div');
  container.className = 'title-container';
  const title = document.createElement(options.title.tag);
  title.className = ['title', options.title.className].filter(Boolean).join(' ');
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = TOGGLE_CLASS;
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    event.preventDefault();
    options.collapse.onToggle();
  });
  if (options.collapse.byTitle) {
    toggle.classList.add(TITLE_TOGGLE_CLASS);
    const label = document.createElement('span');
    label.textContent = t(options.title.labelKey);
    toggle.replaceChildren(label, createChevronDownIcon(16));
    title.append(toggle);
    container.append(title);
  } else {
    title.textContent = t(options.title.labelKey);
    toggle.replaceChildren(createChevronDownIcon(16));
    container.append(title, toggle);
  }
  title.setAttribute(LABEL_KEY_ATTR, options.title.labelKey);
  return container;
}

/** Builds the header row. Collapsed state and toggle labels are set through the helpers below. */
export function createFolderHeader(options: FolderHeaderOptions): HTMLElement {
  const header = document.createElement('div');
  header.className = [FOLDER_HEADER_CLASS, options.className].filter(Boolean).join(' ');
  const actions = document.createElement('div');
  actions.className = ACTIONS_CLASS;
  actions.append(...options.actions.map((action) => createActionButton(action, options)));
  header.append(createTitle(options), actions);
  return header;
}

/** The header's collapse control inside `root`. */
function collapseToggle(root: ParentNode): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>(`.${FOLDER_HEADER_CLASS} .${TOGGLE_CLASS}`);
}

/**
 * Shows `collapsed` on the collapse control. A chevron button is named by its
 * action; a title button keeps the section's name and states the action in its title.
 */
export function setFolderHeaderCollapsed(root: ParentNode, collapsed: boolean): void {
  const toggle = collapseToggle(root);
  if (!toggle) return;
  const label = t(collapsed ? 'pm_expand' : 'pm_collapse');
  toggle.title = label;
  toggle.setAttribute('aria-expanded', String(!collapsed));
  const chevron = collapsed ? createChevronRightIcon(16) : createChevronDownIcon(16);
  if (toggle.classList.contains(TITLE_TOGGLE_CLASS)) {
    toggle.querySelector('svg')?.replaceWith(chevron);
  } else {
    toggle.setAttribute('aria-label', label);
    toggle.replaceChildren(chevron);
  }
}

/** The header's action buttons inside `root`. */
export function folderHeaderButtons(root: ParentNode): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>(`.${ACTIONS_CLASS} button`)];
}

export function setFolderHeaderDisabled(root: ParentNode, disabled: boolean): void {
  for (const button of folderHeaderButtons(root)) button.disabled = disabled;
}

/**
 * Updates a button found by one of its role classes. A `label` replaces its
 * translated name, so `refreshFolderHeaderLanguage` leaves it to the caller.
 */
export function setFolderHeaderAction(
  root: ParentNode,
  className: string,
  state: { pressed?: boolean; hidden?: boolean; label?: string; title?: string },
): HTMLButtonElement | null {
  const button = root.querySelector<HTMLButtonElement>(`.${ACTIONS_CLASS} .${className}`);
  if (!button) return null;
  if (state.pressed !== undefined) button.setAttribute('aria-pressed', String(state.pressed));
  if (state.hidden !== undefined) button.hidden = state.hidden;
  if (state.label !== undefined) {
    button.removeAttribute(LABEL_KEY_ATTR);
    setLabel(button, state.label);
  }
  if (state.title !== undefined) button.title = state.title;
  return button;
}

/** Retranslates the title and fixed button labels; state-dependent labels are the caller's. */
export function refreshFolderHeaderLanguage(root: ParentNode): void {
  const header = root.querySelector(`.${FOLDER_HEADER_CLASS}`);
  if (!header) return;
  const title = header.querySelector(`.title[${LABEL_KEY_ATTR}]`);
  const titleKey = title?.getAttribute(LABEL_KEY_ATTR);
  if (title && titleKey) {
    const target = title.querySelector(`.${TITLE_TOGGLE_CLASS} span`) ?? title;
    target.textContent = t(titleKey);
  }
  for (const button of folderHeaderButtons(header)) {
    const key = button.getAttribute(LABEL_KEY_ATTR);
    if (key) setLabel(button, t(key));
  }
}

/** Constant markup for a menu item icon drawn from Material Symbols path data. */
export function menuIconHtml(path: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="${path}"/></svg>`;
}

/** The cloud button: one menu with Upload and Sync, whichever provider the user chose. */
export function cloudMenuAction(
  transfer: { upload: () => void; sync: () => void; tooltip?: () => Promise<string> },
  extra: Partial<Pick<FolderHeaderAction, 'reveal' | 'className'>> = {},
): FolderHeaderAction {
  return {
    className: extra.className ?? 'gv-folder-cloud-btn',
    icon: () => createCloudIcon(18),
    labelKey: 'folder_cloud',
    reveal: extra.reveal,
    tooltip: transfer.tooltip,
    // Gemini's bundled symbol font lacks these cloud glyphs.
    menu: () => [
      {
        label: t('folder_cloud_upload'),
        iconHtml: menuIconHtml(CLOUD_UPLOAD_PATH),
        action: transfer.upload,
      },
      {
        label: t('folder_cloud_sync'),
        iconHtml: menuIconHtml(CLOUD_SYNC_PATH),
        action: transfer.sync,
      },
    ],
  };
}

/** Adds the header sheet to the page once. */
export function ensureFolderHeaderStyle(doc: Document = document): void {
  ensurePageSheet(PAGE_STYLE_CLASS, headerCss, doc);
}
