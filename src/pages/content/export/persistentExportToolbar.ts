// Persistent top-right export toolbar.
// Mounted as a fallback when Gemini's logo (the usual injection point for the
// inline export dropdown) is absent — e.g. after the lr26 UI refresh removed
// [data-test-id="logo"] — and as the only export entry on other hosts. Calls
// back into showExportDialog when clicked. Where it sits is `toolbarPlacement.ts`.
import { createDownloadIcon } from '@/core/icons/promptManagerIcons';

import { turnSelectorFor } from './toolbarAvoidance';
import { isToolbarPlaced, startToolbarPlacement, stopToolbarPlacement } from './toolbarPlacement';
import { readToolbarSpot, writeToolbarSpot } from './toolbarPosition';

export type PersistentExportToolbarOptions = {
  label: string;
  tooltip: string;
  onClick: () => void;
  /**
   * The host site's id: stamped as `data-gv-platform` for per-site styles,
   * and the key the user's dragged spot is remembered under. Without it the
   * toolbar can still be dragged, but its spot is not remembered.
   */
  siteId?: string;
  /** The host's conversation turns; controls inside them are never avoided. */
  turnSelector?: string;
};

const TOOLBAR_CLASS = 'gv-persistent-export-toolbar';
const BUTTON_CLASS = 'gv-persistent-export-btn';
const ICON_CLASS = 'gv-persistent-export-icon';
const LABEL_CLASS = 'gv-persistent-export-label';
/** Hides the toolbar until its remembered spot is read, so it does not jump there visibly. */
const PLACING_CLASS = 'gv-persistent-export-toolbar--placing';
const PLACING_TIMEOUT_MS = 800;

type OwnedToolbarRoot = HTMLDivElement & { _gvOwner?: symbol; _gvRevealTimer?: number };
type ToolbarButton = HTMLButtonElement & { _gvOnClick?: () => void };

function placeToolbar(
  root: OwnedToolbarRoot,
  button: HTMLElement,
  options: PersistentExportToolbarOptions,
): void {
  // A remount keeps the toolbar where it already is.
  if (isToolbarPlaced(root)) return;
  const siteId = options.siteId;
  const placement = startToolbarPlacement(root, {
    handle: button,
    turnSelector: turnSelectorFor(options.turnSelector),
    onSpotChange: (spot) => {
      if (siteId) void writeToolbarSpot(siteId, spot);
    },
  });
  if (!siteId) return;
  root.classList.add(PLACING_CLASS);
  const reveal = () => root.classList.remove(PLACING_CLASS);
  // Storage that never answers must not keep the only export entry hidden.
  root._gvRevealTimer = window.setTimeout(reveal, PLACING_TIMEOUT_MS);
  void readToolbarSpot(siteId).then((spot) => {
    window.clearTimeout(root._gvRevealTimer);
    if (spot && isToolbarPlaced(root)) placement.restoreSpot(spot);
    reveal();
  });
}

function removeToolbarRoot(root: OwnedToolbarRoot): void {
  window.clearTimeout(root._gvRevealTimer);
  stopToolbarPlacement(root);
  try {
    root.remove();
  } catch {}
}

function buildToolbarDom(options: PersistentExportToolbarOptions): {
  root: HTMLDivElement;
  button: HTMLButtonElement;
  labelEl: HTMLSpanElement;
} {
  const root = document.createElement('div');
  root.className = TOOLBAR_CLASS;
  root.setAttribute('data-gv-component', 'persistent-export-toolbar');
  if (options.siteId) root.setAttribute('data-gv-platform', options.siteId);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = BUTTON_CLASS;
  button.title = options.tooltip;
  button.setAttribute('aria-label', options.tooltip);

  // A line icon, like the host header's own Share.
  const icon = createDownloadIcon(18);
  icon.classList.add(ICON_CLASS);

  const labelEl = document.createElement('span');
  labelEl.className = LABEL_CLASS;
  labelEl.textContent = options.label;

  button.appendChild(icon);
  button.appendChild(labelEl);
  root.appendChild(button);

  return { root, button, labelEl };
}

export type PersistentExportToolbarHandle = {
  root: HTMLDivElement;
  button: HTMLButtonElement;
  setText(label: string, tooltip: string): void;
  remove(): void;
};

// Remounts replace the handler and owner so late cleanup cannot remove the replacement.
export function mountPersistentExportToolbar(
  options: PersistentExportToolbarOptions,
): PersistentExportToolbarHandle {
  const owner = Symbol('persistent-export-toolbar-owner');
  const existing = document.querySelector(`.${TOOLBAR_CLASS}`) as OwnedToolbarRoot | null;
  if (existing) {
    const button = existing.querySelector(`.${BUTTON_CLASS}`) as ToolbarButton;
    const labelEl = existing.querySelector(`.${LABEL_CLASS}`) as HTMLSpanElement;
    button.title = options.tooltip;
    button.setAttribute('aria-label', options.tooltip);
    if (labelEl) labelEl.textContent = options.label;
    existing._gvOwner = owner;
    button._gvOnClick = options.onClick;
    placeToolbar(existing, button, options);
    return {
      root: existing,
      button,
      setText(label, tooltip) {
        button.title = tooltip;
        button.setAttribute('aria-label', tooltip);
        if (labelEl) labelEl.textContent = label;
      },
      remove() {
        if (existing._gvOwner === owner) removeToolbarRoot(existing);
      },
    };
  }

  const { root: plainRoot, button: plainButton, labelEl } = buildToolbarDom(options);
  const root = plainRoot as OwnedToolbarRoot;
  const button = plainButton as ToolbarButton;
  root._gvOwner = owner;
  button._gvOnClick = options.onClick;

  const swallow = (e: Event) => {
    try {
      e.stopPropagation();
    } catch {}
  };
  ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach((type) => {
    button.addEventListener(type, swallow, true);
  });
  button.addEventListener('click', (ev) => {
    swallow(ev);
    try {
      button._gvOnClick?.();
    } catch (err) {
      try {
        console.error('[Gemini Voyager] Persistent export toolbar click failed:', err);
      } catch {}
    }
  });

  document.body.appendChild(root);
  placeToolbar(root, button, options);

  return {
    root,
    button,
    setText(label, tooltip) {
      button.title = tooltip;
      button.setAttribute('aria-label', tooltip);
      labelEl.textContent = label;
    },
    remove() {
      if (root._gvOwner === owner) removeToolbarRoot(root);
    },
  };
}

/**
 * Open the export flow through the mounted toolbar, exactly as a click on it
 * would. Returns false when no toolbar is mounted (the page holds nothing to
 * export), so callers outside the page can explain why nothing opened.
 */
export function openPersistentExportToolbar(): boolean {
  const button = document.querySelector<HTMLButtonElement>(`.${TOOLBAR_CLASS} .${BUTTON_CLASS}`);
  if (!button) return false;
  button.click();
  return true;
}
