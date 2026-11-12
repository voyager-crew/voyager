/**
 * The folder settings popover's content: conversation order, where subfolders
 * sit, the display settings, and on Gemini the sidebar width. A site renders it into its own
 * popover; one sheet styles it on the page and in a shadow root alike.
 */
import browser from 'webextension-polyfill';

import { createMinusIcon, createPlusIcon } from '@/core/icons/folderIcons';
import { StorageKeys } from '@/core/types/common';
import type { ConversationSortMode } from '@/features/folder/model/folderData';
import {
  type SubfolderPlacement,
  toSubfolderPlacement,
} from '@/features/folder/model/subfolderPlacement';
import { getTranslationSyncUnsafe as t } from '@/utils/i18n';

import {
  FOLDER_DISPLAY_SETTINGS,
  type FolderDisplaySetting,
  clampFolderDisplay,
} from '../folderDisplay';
import { openFolderHeaderPopover } from '../folderHeader/folderHeaderMenu';
import { ensurePageSheet } from '../pageSheet';
import settingsCss from './folderSettings.css?raw';

const GEMINI_SIDEBAR_WIDTH_MIN_PX = 180;
const GEMINI_SIDEBAR_WIDTH_MAX_PX = 540;
const GEMINI_SIDEBAR_WIDTH_DEFAULT_PX = 312;
const GEMINI_SIDEBAR_WIDTH_STEP_PX = 8;
const LEGACY_SIDEBAR_WIDTH_MAX_PERCENT = 45;
const LEGACY_SIDEBAR_WIDTH_BASELINE_PX = 1200;

export const FOLDER_SETTINGS_CSS = settingsCss;
export const FOLDER_SETTINGS_CLASS = 'gv-folder-settings-menu';
const PAGE_STYLE_CLASS = 'gv-folder-settings-style';

export type FolderSettingsOptions = {
  sortMode: ConversationSortMode;
  onSortModeChange: (mode: ConversationSortMode) => void;
  /** Gemini's sidebar width; the other sites' sidebars are not Voyager's to size. */
  sidebarWidth?: boolean;
  /** The page has Material Symbols (Gemini), so the steppers use ligatures; elsewhere SVG. */
  symbolFont?: boolean;
  /**
   * The value a display setting shows until the user stores one, by storage
   * key: the site's own metric, which its tree keeps while the key is unset.
   */
  displayDefaults?: Readonly<Partial<Record<string, number>>>;
};

/** Adds the settings sheet to the page once, for a popover in page DOM. */
export function ensureFolderSettingsStyle(doc: Document = document): void {
  ensurePageSheet(PAGE_STYLE_CLASS, settingsCss, doc);
}

/**
 * Opens the settings below `anchor`, a header button, in the header menus'
 * body-level popover: for a site whose folders live in a shadow root.
 */
export function openFolderSettingsPopover(
  anchor: HTMLButtonElement,
  options: FolderSettingsOptions,
): void {
  openFolderHeaderPopover(anchor, {
    popup: 'dialog',
    css: settingsCss,
    fill: (container) => {
      container.classList.add(FOLDER_SETTINGS_CLASS);
      container.setAttribute('aria-label', t('folder_settings'));
      renderFolderSettings(container, options);
      return container.querySelector<HTMLButtonElement>('.gv-folder-sort-option.is-active');
    },
  });
}

/** Fills `menu`, a popover carrying `FOLDER_SETTINGS_CLASS`, with the settings rows. */
export function renderFolderSettings(menu: HTMLElement, options: FolderSettingsOptions): void {
  menu.appendChild(createConversationSortSettingsRow(options.sortMode, options.onSortModeChange));
  menu.appendChild(createSubfolderPlacementSettingsRow());
  if (options.sidebarWidth) menu.appendChild(createSidebarWidthSettingsRow());
  for (const setting of FOLDER_DISPLAY_SETTINGS) {
    const defaultValue = options.displayDefaults?.[setting.storageKey] ?? setting.defaultValue;
    menu.appendChild(
      createSettingsStepperRow({ ...setting, defaultValue }, options.symbolFont === true),
    );
  }
  // Disabled stepper buttons can retarget a click in some browsers.
  // Keep interactions with the entire settings panel inside this popover.
  menu.addEventListener('click', (click) => click.stopPropagation());
}

function createConversationSortSettingsRow(
  initialMode: ConversationSortMode,
  onSortModeChange: (mode: ConversationSortMode) => void,
): HTMLElement {
  return createSegmentedSettingsRow('folder_sort', initialMode, onSortModeChange, [
    ['manual', 'folder_sort_manual'],
    ['recent', 'folder_sort_recent'],
  ]).row;
}

/** Subfolders above or below a folder's conversations; every site's tree follows the stored value. */
function createSubfolderPlacementSettingsRow(): HTMLElement {
  const persist = (placement: SubfolderPlacement) => {
    try {
      void browser.storage.sync
        .set({ [StorageKeys.FOLDER_SUBFOLDER_PLACEMENT]: placement })
        .catch((error) => {
          console.warn('[FolderSettings] Failed to save subfolder placement:', error);
        });
    } catch (error) {
      console.warn('[FolderSettings] Failed to save subfolder placement:', error);
    }
  };
  const { row, select } = createSegmentedSettingsRow<SubfolderPlacement>(
    'folder_subfolder_placement',
    'first',
    persist,
    [
      ['first', 'folder_subfolder_placement_first'],
      ['last', 'folder_subfolder_placement_last'],
    ],
  );
  try {
    void browser.storage.sync
      .get({ [StorageKeys.FOLDER_SUBFOLDER_PLACEMENT]: 'first' })
      .then((result) =>
        select(toSubfolderPlacement(result?.[StorageKeys.FOLDER_SUBFOLDER_PLACEMENT])),
      )
      .catch((error) => {
        console.warn('[FolderSettings] Failed to load subfolder placement:', error);
      });
  } catch {
    // The default stays selected.
  }
  return row;
}

/** A label and a set of exclusive options; `select` shows a value without reporting it. */
function createSegmentedSettingsRow<T extends string>(
  labelKey: string,
  initial: T,
  onChange: (value: T) => void,
  choices: readonly (readonly [T, string])[],
): { row: HTMLElement; select: (value: T) => void } {
  let current = initial;
  const row = document.createElement('div');
  row.className = 'gv-folder-settings-row gv-folder-sort-settings-row';

  const label = document.createElement('span');
  label.className = 'gv-folder-settings-label';
  label.textContent = t(labelKey);

  const options = document.createElement('div');
  options.className = 'gv-folder-sort-options';
  options.setAttribute('role', 'group');
  options.setAttribute('aria-label', t(labelKey));

  const buttons = new Map<T, HTMLButtonElement>();
  const render = () => {
    buttons.forEach((button, value) => {
      const active = current === value;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };

  for (const [value, optionLabelKey] of choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gv-folder-sort-option';
    button.textContent = t(optionLabelKey);
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      current = value;
      onChange(value);
      render();
    });
    buttons.set(value, button);
    options.appendChild(button);
  }

  render();
  row.append(label, options);
  return {
    row,
    select: (value) => {
      current = value;
      render();
    },
  };
}

function createSidebarWidthSettingsRow(): HTMLElement {
  const clampWidth = (value: number) =>
    Math.min(GEMINI_SIDEBAR_WIDTH_MAX_PX, Math.max(GEMINI_SIDEBAR_WIDTH_MIN_PX, Math.round(value)));
  const normalizeStoredWidth = (value: unknown) => {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return GEMINI_SIDEBAR_WIDTH_DEFAULT_PX;
    if (numeric <= LEGACY_SIDEBAR_WIDTH_MAX_PERCENT) {
      return clampWidth((numeric / 100) * LEGACY_SIDEBAR_WIDTH_BASELINE_PX);
    }
    return clampWidth(numeric);
  };

  const row = document.createElement('div');
  row.className = 'gv-folder-settings-row gv-folder-width-settings-row';

  const header = document.createElement('div');
  header.className = 'gv-folder-width-settings-header';

  const label = document.createElement('span');
  label.className = 'gv-folder-settings-label';
  label.textContent = t('sidebarWidth');

  const controls = document.createElement('div');
  controls.className = 'gv-folder-width-settings-controls';

  const value = document.createElement('output');
  value.className = 'gv-folder-width-value';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'gv-folder-width-switch';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-label', t('sidebarWidth'));

  const knob = document.createElement('span');
  knob.className = 'gv-folder-width-switch-knob';
  toggle.appendChild(knob);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'gv-folder-width-slider';
  slider.min = String(GEMINI_SIDEBAR_WIDTH_MIN_PX);
  slider.max = String(GEMINI_SIDEBAR_WIDTH_MAX_PX);
  slider.step = String(GEMINI_SIDEBAR_WIDTH_STEP_PX);
  slider.setAttribute('aria-label', t('sidebarWidth'));

  let current = GEMINI_SIDEBAR_WIDTH_DEFAULT_PX;
  let enabled = false;

  const render = () => {
    const progress =
      ((current - GEMINI_SIDEBAR_WIDTH_MIN_PX) /
        (GEMINI_SIDEBAR_WIDTH_MAX_PX - GEMINI_SIDEBAR_WIDTH_MIN_PX)) *
      100;
    value.textContent = `${current}px`;
    slider.value = String(current);
    slider.disabled = !enabled;
    slider.setAttribute('aria-valuetext', `${current}px`);
    slider.style.setProperty('--gv-folder-width-progress', `${progress}%`);
    toggle.setAttribute('aria-checked', String(enabled));
    row.classList.toggle('is-disabled', !enabled);
  };

  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    enabled = !enabled;
    render();
    try {
      void browser.storage.sync
        .set({ [StorageKeys.SIDEBAR_WIDTH_ENABLED]: enabled })
        .catch((error) => {
          console.warn('[FolderSettings] Failed to toggle sidebar width:', error);
        });
    } catch (error) {
      console.warn('[FolderSettings] Failed to toggle sidebar width:', error);
    }
  });

  slider.addEventListener('input', (event) => {
    event.stopPropagation();
    current = clampWidth(Number((event.currentTarget as HTMLInputElement).value));
    render();
  });

  slider.addEventListener('change', (event) => {
    event.stopPropagation();
    try {
      void browser.storage.sync.set({ [StorageKeys.SIDEBAR_WIDTH]: current }).catch((error) => {
        console.warn('[FolderSettings] Failed to save sidebar width:', error);
      });
    } catch (error) {
      console.warn('[FolderSettings] Failed to save sidebar width:', error);
    }
  });

  try {
    void browser.storage.sync
      .get({
        [StorageKeys.SIDEBAR_WIDTH]: GEMINI_SIDEBAR_WIDTH_DEFAULT_PX,
        [StorageKeys.SIDEBAR_WIDTH_ENABLED]: false,
      })
      .then((result) => {
        current = normalizeStoredWidth(result?.[StorageKeys.SIDEBAR_WIDTH]);
        enabled = result?.[StorageKeys.SIDEBAR_WIDTH_ENABLED] === true;
        render();
      })
      .catch((error) => {
        console.warn('[FolderSettings] Failed to load sidebar width:', error);
      });
  } catch {
    // Fall through to the defaults rendered below.
  }

  controls.append(value, toggle);
  header.append(label, controls);
  row.append(header, slider);
  render();
  return row;
}

function stepIcon(step: 'remove' | 'add', symbolFont: boolean): Node {
  if (!symbolFont) return step === 'add' ? createPlusIcon(16) : createMinusIcon(16);
  const icon = document.createElement('mat-icon');
  icon.setAttribute('role', 'img');
  icon.className = 'mat-icon notranslate google-symbols mat-ligature-font mat-icon-no-color';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = step;
  return icon;
}

function createSettingsStepperRow(config: FolderDisplaySetting, symbolFont: boolean): HTMLElement {
  const { labelKey, storageKey, min, max, defaultValue, unit } = config;
  const clamp = (n: unknown) => clampFolderDisplay(config, n);

  const row = document.createElement('div');
  row.className = 'gv-folder-settings-row';

  const label = document.createElement('span');
  label.className = 'gv-folder-settings-label';
  label.textContent = t(labelKey);

  const stepper = document.createElement('div');
  stepper.className = 'gv-folder-stepper';

  const minus = document.createElement('button');
  minus.className = 'gv-folder-stepper-btn';
  minus.type = 'button';
  minus.appendChild(stepIcon('remove', symbolFont));
  minus.title = t('folder_item_font_size_decrease');

  const value = document.createElement('span');
  value.className = 'gv-folder-stepper-value';

  const plus = document.createElement('button');
  plus.className = 'gv-folder-stepper-btn';
  plus.type = 'button';
  plus.appendChild(stepIcon('add', symbolFont));
  plus.title = t('folder_item_font_size_increase');

  let current = defaultValue;

  const render = () => {
    value.textContent = unit ? `${current}${unit}` : `${current}`;
    minus.disabled = current <= min;
    plus.disabled = current >= max;
  };

  const persist = (next: number) => {
    current = clamp(next);
    render();
    try {
      void chrome.storage.sync.set({ [storageKey]: current });
    } catch (err) {
      console.warn(`[FolderSettings] Failed to save ${storageKey}:`, err);
    }
  };

  minus.addEventListener('click', (e) => {
    e.stopPropagation();
    persist(current - 1);
  });
  plus.addEventListener('click', (e) => {
    e.stopPropagation();
    persist(current + 1);
  });

  try {
    void chrome.storage.sync.get({ [storageKey]: defaultValue }).then((res) => {
      current = clamp((res as Record<string, unknown>)?.[storageKey]);
      render();
    });
  } catch {
    // Fall through to default render below.
  }
  render();

  stepper.appendChild(minus);
  stepper.appendChild(value);
  stepper.appendChild(plus);

  row.appendChild(label);
  row.appendChild(stepper);
  return row;
}
