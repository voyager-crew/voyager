import { hasVoyagerOwner } from '@/core/gemini/composer/ownedInput';
import { getBundledGeminiSelectorView, type GeminiSelectorView } from '@/core/gemini/selectors';
import { resolvePlacementOperation } from '@/core/selectors/placement';

import {
  hasNativeItemRole,
  hasNativeSelectedState,
  isInlineThinkingItem,
  isNativeThinkingRow,
  isNestedThinkingItem,
  readModelId,
} from './modelPickerMetadata';
import {
  assertPickerLabel,
  belongsToPickerItem,
  isNativeThinkingPane,
  isSafePickerPanel,
  isSafePickerTrigger,
} from './modelPickerSafety';
import {
  firstPickerMatch,
  hasRemotePickerProfile,
  pickerSelector,
  readPickerPill,
} from './modelPickerSelectors';
import type { DefaultModelSetting } from './preferences';

/** DOM discovery and metadata decoding; interaction state belongs to ModelPicker. */
export class ModelPickerDom {
  public constructor(public readonly view: GeminiSelectorView) {}

  private selector(key: Parameters<typeof pickerSelector>[1]): string {
    return pickerSelector(this.view, key);
  }

  public get remote(): boolean {
    return hasRemotePickerProfile(this.view);
  }

  public describeItem(item: HTMLElement) {
    if (this.remote && !(item instanceof HTMLElement)) throw new Error('Non-HTML model row');
    const kind = this.isInlineExtendedThinkingToggle(item)
      ? 'inline-thinking'
      : this.isNestedThinkingLevelItem(item)
        ? 'nested-thinking'
        : 'model';
    return {
      kind,
      id: this.getModelIdFromItem(item),
      name: this.getModelNameFromItem(item),
      thinkingLabel: this.getThinkingLevelLabel(item),
    };
  }

  public describeMenu(panel: HTMLElement) {
    if (this.remote && !isSafePickerPanel(panel, this.findSelectorButton())) {
      throw new Error('Unrelated model panel');
    }
    // Table menus share generic labels; require model-specific evidence before adding stars.
    const items = Array.from(
      panel.querySelectorAll<HTMLElement>(this.selector('modelPicker.items')),
    );
    if (this.remote) {
      const bundled = getBundledGeminiSelectorView();
      const nativeItems = Array.from(
        panel.querySelectorAll<HTMLElement>(pickerSelector(bundled, 'modelPicker.items')),
      );
      if (
        items.some((item) => !(item instanceof HTMLElement) || !hasNativeItemRole(item)) ||
        nativeItems.some((item) => !items.includes(item))
      ) {
        throw new Error('Incomplete model rows');
      }
      for (const item of items) {
        const description = this.describeItem(item);
        const thinking = description.kind !== 'model';
        if (
          item.getAttribute('value') !== 'thinking_level' &&
          !(thinking ? description.thinkingLabel : description.name)
        ) {
          throw new Error('Unreadable model row');
        }
        this.starAnchor(item, 'model');
        this.starAnchor(item, 'thinking');
      }
    }
    const kind =
      (this.remote && isNativeThinkingPane(panel)) ||
      (panel.matches(this.selector('modelPicker.overlayPane')) &&
        this.isThinkingLevelSubmenuPane(panel))
        ? 'thinking'
        : panel.querySelector(this.selector('modelPicker.modelEvidence'))
          ? 'model'
          : 'other';
    const thinkingRow = this.findThinkingLevelTriggerRow();
    const nestedThinking =
      thinkingRow &&
      panel.contains(thinkingRow) &&
      thinkingRow.querySelector(this.selector('modelPicker.thinkingItems'))
        ? thinkingRow
        : null;
    if (this.remote && nestedThinking) this.thinkingItems(nestedThinking);
    if (this.remote && kind === 'thinking') this.thinkingItems(panel);
    return {
      kind,
      items,
      inlineThinking: this.findInlineThinkingItems(panel),
      nestedThinking,
      view: this.view,
    };
  }

  public findTargetModel(panel: HTMLElement, target: DefaultModelSetting): HTMLElement | null {
    const normalize = (value: string) => value.toLowerCase().trim();
    const name = normalize(target.name);
    const items = Array.from(
      panel.querySelectorAll<HTMLElement>(this.selector('modelPicker.items')),
    ).filter(
      (item) =>
        !this.isInlineExtendedThinkingToggle(item) &&
        (!this.remote ||
          (!isNestedThinkingItem(item) &&
            item.getAttribute('value') !== 'thinking_level' &&
            hasNativeItemRole(item) &&
            Boolean(this.getModelNameFromItem(item)))),
    );
    const exact = items.find((item) =>
      target.kind === 'id'
        ? this.getModelIdFromItem(item) === target.id
        : normalize(this.getModelNameFromItem(item)) === name,
    );
    if (exact) return exact;
    if (this.remote) return null;
    // Legacy fallback also searches descriptions, with word boundaries.
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wholeWord = new RegExp(`(^|\\b)${escaped}(\\b|$)`, 'i');
    return items.find((item) => wholeWord.test(normalize(item.textContent || ''))) ?? null;
  }

  private mayContainModeSwitchContainer(root: HTMLElement): boolean {
    return (
      root.matches(this.selector('modelPicker.observerRoot')) ||
      root.closest(this.selector('modelPicker.container')) !== null
    );
  }

  public resolveAddedMenu(root: HTMLElement): HTMLElement | null {
    if (!this.mayContainModeSwitchContainer(root)) return null;
    if (
      this.view.profiles['modelPicker.legacyPanels'].some((selector) => root.matches(selector)) ||
      root.matches(this.selector('modelPicker.panelFallback'))
    ) {
      return root;
    }

    // 2026 redesign: the added node may be a cdk-overlay-pane containing gem-menu-item entries
    // (model menu) or the thinking-level submenu (no data-mode-id, but aria-controls'd by a
    // value="thinking_level" row that lives in a sibling overlay).
    if (root.matches?.(this.selector('modelPicker.overlayPane'))) {
      if (root.querySelector(this.selector('modelPicker.modelIdItem')) !== null) return root;
      if (this.isThinkingLevelSubmenuPane(root)) return root;
    }

    if (
      root.matches(this.selector('modelPicker.modelIdItem')) ||
      root.matches(this.selector('modelPicker.items'))
    ) {
      const pane = root.closest<HTMLElement>(this.selector('modelPicker.container'));
      if (pane) return pane;
    }

    const legacy = firstPickerMatch(root, this.view, 'modelPicker.legacyPanels');
    if (legacy) return legacy;

    const newItem = root.querySelector<HTMLElement>(this.selector('modelPicker.modelIdItem'));
    if (newItem) {
      const pane = newItem.closest<HTMLElement>(this.selector('modelPicker.container'));
      if (pane) return pane;
    }

    const modeItem = root.querySelector<HTMLElement>(this.selector('modelPicker.items'));
    if (modeItem) {
      const pane = modeItem.closest<HTMLElement>(this.selector('modelPicker.container'));
      if (pane) return pane;
    }

    // Thinking submenu may appear nested inside a different root (rare; observer normally sees the pane directly).
    const thinkingPane = this.findThinkingLevelSubmenuPane();
    if (thinkingPane && root.contains(thinkingPane)) return thinkingPane;

    return root.querySelector<HTMLElement>(this.selector('modelPicker.panelFallback'));
  }

  /** The menu that contains this row. */
  public menuOf(item: HTMLElement): HTMLElement | null {
    return item.closest<HTMLElement>(this.selector('modelPicker.container'));
  }

  public getModeSwitchMenuPanel(): HTMLElement | null {
    const legacy = firstPickerMatch(document, this.view, 'modelPicker.legacyPanels');
    if (legacy) return legacy;

    // 2026 redesign: any cdk-overlay-pane that contains a [data-mode-id] item is the model picker.
    const newItem = document.querySelector<HTMLElement>(
      `:is(${this.selector('modelPicker.overlayPane')}) :is(${this.selector('modelPicker.modelIdItem')})`,
    );
    if (newItem) {
      const pane = newItem.closest<HTMLElement>(this.selector('modelPicker.overlayPane'));
      if (pane) return pane;
    }

    return document.querySelector<HTMLElement>(this.selector('modelPicker.panelFallback'));
  }

  private isNestedThinkingLevelItem(item: HTMLElement): boolean {
    return isNestedThinkingItem(item);
  }

  private isInlineExtendedThinkingToggle(item: HTMLElement): boolean {
    return isInlineThinkingItem(item);
  }

  public findInlineThinkingItems(root: ParentNode): HTMLElement[] {
    return Array.from(
      root.querySelectorAll<HTMLElement>(this.selector('modelPicker.items')),
    ).filter((item) => this.isInlineExtendedThinkingToggle(item));
  }

  public isThinkingItemSelected(item: HTMLElement): boolean {
    return hasNativeSelectedState(item, 'thinking');
  }

  public isNestedThinkingItemSelected(item: HTMLElement): boolean {
    return hasNativeSelectedState(item, 'nested');
  }

  public getThinkingLevelLabel(item: HTMLElement): string {
    const titleEl = item.querySelector(this.selector('modelPicker.thinkingLabel'));
    if (this.remote && titleEl && !(titleEl instanceof HTMLElement)) {
      throw new Error('Non-HTML thinking label');
    }
    if (this.remote && titleEl instanceof HTMLElement) {
      assertPickerLabel(item, titleEl, 'thinking', this.view);
    }
    return titleEl?.textContent?.trim() || '';
  }

  public getModelNameFromItem(item: HTMLElement): string {
    const titleEl = item.querySelector(this.selector('modelPicker.modelLabel'));
    if (this.remote && titleEl && !(titleEl instanceof HTMLElement)) {
      throw new Error('Non-HTML model label');
    }
    if (this.remote && titleEl instanceof HTMLElement) {
      assertPickerLabel(item, titleEl, 'model', this.view);
    }
    return titleEl?.textContent?.trim() || '';
  }

  public getModelIdFromItem(item: HTMLElement): string | null {
    return readModelId(item);
  }

  public isModelItemSelected(item: HTMLElement): boolean {
    return hasNativeSelectedState(item, 'model');
  }

  // ==================== Thinking level helpers (2026 redesign) ====================

  /**
   * Find the "Thinking level" submenu row in any open model picker.
   * Detected by the stable attribute value="thinking_level" rendered by Gemini.
   */
  public findThinkingLevelTriggerRow(): HTMLElement | null {
    const row = document.querySelector<HTMLElement>(
      `:is(${this.selector('modelPicker.overlayPane')}) :is(${this.selector('modelPicker.thinkingRow')})`,
    );
    if (row && this.remote && !isNativeThinkingRow(row)) throw new Error('Invalid thinking row');
    return row;
  }

  /**
   * Resolve the submenu pane (the one containing Standard/Extended) by walking
   * from the Thinking level row's aria-controls to the matching menu id.
   */
  public findThinkingLevelSubmenuPane(): HTMLElement | null {
    const row = this.findThinkingLevelTriggerRow();
    const controlsId = row?.getAttribute('aria-controls');
    if (controlsId) {
      const submenu = document.getElementById(controlsId);
      if (submenu) {
        return submenu.closest<HTMLElement>(this.selector('modelPicker.overlayPane')) ?? submenu;
      }
    }
    return row?.querySelector(this.selector('modelPicker.thinkingItems')) ? row : null;
  }

  public getThinkingLevelItems(): HTMLElement[] {
    const submenu = this.findThinkingLevelSubmenuPane();
    return submenu ? this.thinkingItems(submenu) : [];
  }

  public thinkingItems(pane: HTMLElement): HTMLElement[] {
    const items = Array.from(
      pane.querySelectorAll<HTMLElement>(this.selector('modelPicker.thinkingItems')),
    );
    if (!this.remote) return items;
    const row = this.findThinkingLevelTriggerRow();
    const controlledId = row?.getAttribute('aria-controls');
    const owner = controlledId ? document.getElementById(controlledId) : row;
    if (!owner || !row) throw new Error('Unowned thinking submenu');
    const nativeItems = Array.from(
      owner.querySelectorAll<HTMLElement>(
        pickerSelector(getBundledGeminiSelectorView(), 'modelPicker.thinkingItems'),
      ),
    );
    if (
      items.some(
        (item) =>
          !(item instanceof HTMLElement) || !owner.contains(item) || !hasNativeItemRole(item),
      ) ||
      nativeItems.some((item) => !items.includes(item))
    ) {
      throw new Error('Incomplete thinking rows');
    }
    for (const item of items) {
      if (!this.getThinkingLevelLabel(item)) throw new Error('Unreadable thinking row');
      this.isNestedThinkingItemSelected(item);
      this.starAnchor(item, 'thinking');
    }
    return items;
  }

  private isThinkingLevelSubmenuPane(pane: HTMLElement): boolean {
    // The submenu pane never carries the trigger row itself — that lives only in the parent overlay.
    if (pane.querySelector(this.selector('modelPicker.thinkingRow'))) return false;
    const row = this.findThinkingLevelTriggerRow();
    const controlsId = row?.getAttribute('aria-controls');
    if (!controlsId) return false;
    const submenuEl = document.getElementById(controlsId);
    if (!submenuEl) return false;
    return pane.id === controlsId || pane.contains(submenuEl);
  }

  /**
   * Find the model selector trigger button using all known selectors.
   * Shared by `readTriggerPillLines`, `selectModel`, and `selectThinking`
   * so the fast-path check and the actual menu-opening code always agree on
   * whether the button exists (prevents unnecessary menu clicks when the button
   * is only discoverable via a selector that the fast-path didn't check — #756).
   */
  public findSelectorButton(): HTMLElement | null {
    const button = firstPickerMatch(document, this.view, 'modelPicker.trigger');
    if (button && this.remote && !isSafePickerTrigger(button)) {
      throw new Error('Unrelated picker trigger');
    }
    return button;
  }

  /**
   * Read the trigger pill's visible text. The 2026 redesign renders the model name and
   * the optional thinking level on two separate lines (innerText newline-separated).
   * Returns the raw lines so callers can match against stored labels.
   */
  public readTriggerPillLines(): string[] {
    return readPickerPill(this.findSelectorButton());
  }

  public thinkingContent(row: HTMLElement): HTMLElement | null {
    const content = row.querySelector<HTMLElement>(this.selector('modelPicker.thinkingContent'));
    if (this.remote && content) {
      if (!(content instanceof HTMLElement)) throw new Error('Non-HTML thinking content');
      const canonical = row.querySelector(
        pickerSelector(getBundledGeminiSelectorView(), 'modelPicker.thinkingContent'),
      );
      if (
        (canonical && canonical !== content) ||
        !belongsToPickerItem(content, row) ||
        hasVoyagerOwner(content, row)
      ) {
        throw new Error('Unrelated thinking hover target');
      }
    }
    return content;
  }

  public starAnchor(item: HTMLElement, kind: 'model' | 'thinking') {
    const containerKey =
      kind === 'model' ? 'modelPicker.modelTitleContainer' : 'modelPicker.thinkingTitleContainer';
    const container = resolvePlacementOperation(this.view, containerKey, (selector) =>
      item.querySelector<HTMLElement>(selector),
    );
    const title =
      container?.querySelector<HTMLElement>(
        this.selector(kind === 'model' ? 'modelPicker.modelLabel' : 'modelPicker.thinkingLabel'),
      ) ?? null;
    return { container, title };
  }
}
