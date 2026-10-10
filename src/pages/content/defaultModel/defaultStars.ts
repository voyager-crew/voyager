import type { Toaster } from '@/core/ui/toast/types';

import { ModelPicker } from './modelPicker';
import { DefaultModelPreferences } from './preferences';
import type { DefaultModelSetting, DefaultThinkingLevel, ThinkingMode } from './preferences';

const MODE_ITEM_SELECTOR = '[role="menuitemradio"], [role="menuitem"]';
const DEFAULT_MODEL_UI_SELECTOR = '.gv-default-star-btn';
const CONFIRMATION_TOAST_MS = 3000;

export class DefaultStars {
  private observer: MutationObserver | null = null;
  private pendingMenuPanelInjections = new WeakSet<HTMLElement>();
  private menuPanelInjectAttempts = new WeakMap<HTMLElement, number>();
  private started = false;

  public constructor(
    private readonly preferences: DefaultModelPreferences,
    private readonly picker: ModelPicker,
    private readonly toaster: Toaster,
  ) {}

  // Preferences must be loaded before observation starts.
  public start(): void {
    this.started = true;
    if (!this.preferences.enabled) this.sweep();
    this.initObserver();
  }

  public stop(): void {
    this.started = false;
    this.observer?.disconnect();
    this.observer = null;
    this.pendingMenuPanelInjections = new WeakSet<HTMLElement>();
    this.menuPanelInjectAttempts = new WeakMap<HTMLElement, number>();
  }

  private initObserver() {
    // Observe only for the mode switch panel/bottom-sheet being added; Gemini UI triggers many mutations and
    // querying the entire document on every mutation can cause severe jank/crashes.
    this.observer = new MutationObserver((mutations) => {
      // When the kill switch is off, still walk added subtrees so we can
      // sweep stale star buttons that were sitting inside a detached CDK
      // overlay pane at toggle-off time and get reattached now. Without
      // this, the storage-onChanged sweep misses them and the user sees
      // stars come back the moment they reopen the menu.
      if (!this.preferences.enabled) {
        for (const mutation of mutations) {
          for (const node of Array.from(mutation.addedNodes)) {
            if (!(node instanceof HTMLElement)) continue;
            if (!this.mayContainDefaultModelUi(node)) continue;
            this.sweep(node);
          }
        }
        return;
      }

      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (!(node instanceof HTMLElement)) continue;
          const menuPanel = this.picker.resolveAddedMenu(node);

          if (menuPanel) {
            this.scheduleMenuPanelInjection(menuPanel);
          }
        }
      }
    });

    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  // Single chokepoint for "remove all extension-injected UI inside this
  // subtree". Used at init time, on flip-off via storage onChanged, and on
  // the observer's off-state path so that detached → reattached CDK panes
  // get cleaned up too.
  public sweep(root: ParentNode = document) {
    root.querySelectorAll('.gv-default-star-btn').forEach((el) => el.remove());
  }

  private mayContainDefaultModelUi(root: HTMLElement): boolean {
    return (
      root.matches(DEFAULT_MODEL_UI_SELECTOR) || !!root.querySelector(DEFAULT_MODEL_UI_SELECTOR)
    );
  }

  private scheduleMenuPanelInjection(menuPanel: HTMLElement) {
    // Second-line defence: even if a caller bypassed the observer-level
    // gate, never queue retry attempts when the kill switch is off.
    if (!this.preferences.enabled) return;
    if (this.pendingMenuPanelInjections.has(menuPanel)) return;
    this.pendingMenuPanelInjections.add(menuPanel);

    const delayMs = 50; // allow menu content to render
    window.setTimeout(() => {
      if (!this.started) return;

      this.pendingMenuPanelInjections.delete(menuPanel);

      void this.injectStarButtons(menuPanel).then((didInject) => {
        if (didInject) {
          this.menuPanelInjectAttempts.delete(menuPanel);
          return;
        }

        if (!menuPanel.isConnected) return;

        const attempts = (this.menuPanelInjectAttempts.get(menuPanel) ?? 0) + 1;
        this.menuPanelInjectAttempts.set(menuPanel, attempts);

        const maxAttempts = 10;
        if (attempts < maxAttempts) {
          this.scheduleMenuPanelInjection(menuPanel);
        }
      });
    }, delayMs);
  }

  private async injectStarButtons(menuPanel: HTMLElement): Promise<boolean> {
    // When the master kill switch is off, do not just bail — actively sweep
    // any star buttons that survived from a previous on-state. Bailing left
    // residual stars clickable, which then re-entered handleStarClick and
    // produced an inconsistent multi-is-default state because the cleanup
    // re-injection short-circuited too. See issue follow-up to the
    // default-model toggle.
    if (!this.preferences.enabled) {
      this.sweep(menuPanel);
      return false;
    }

    const { items, kind } = this.picker.describeMenu(menuPanel);
    if (!items.length) return false;
    if (kind === 'thinking') return this.injectThinkingLevelStars(menuPanel);
    if (kind !== 'model') return false;

    // Sweep stars whose owning item is no longer in the current `items`
    // set. Gemini's Angular view recycling can leave old item elements
    // attached to the panel after a re-render; without this sweep, the
    // per-item dedup below would happily inject a fresh star into each new
    // item, leaving the orphaned old item with its own star — visually
    // duplicating the star icon.
    const currentItems = new Set<Element>(Array.from(items));
    menuPanel.querySelectorAll('.gv-default-star-btn').forEach((star) => {
      const owner = star.closest(MODE_ITEM_SELECTOR);
      if (!owner || !currentItems.has(owner)) {
        star.remove();
      }
    });

    const currentDefault = this.preferences.model;

    items.forEach((item) => this.injectModelStar(item, currentDefault));

    await this.injectInlineExtendedThinkingStar(menuPanel);
    await this.injectNestedThinkingLevelStars(menuPanel);

    return true;
  }

  private injectModelStar(item: HTMLElement, currentDefault: DefaultModelSetting | null): void {
    const description = this.picker.describeItem(item);
    if (description.kind === 'inline-thinking') {
      // The toggle's jslog metadata contains the current model id. A model
      // star injected by an older build therefore looks valid by id, but its
      // click handler writes the wrong storage key. Replace it with the
      // dedicated thinking-preference star below.
      item
        .querySelectorAll<HTMLElement>(
          '.gv-default-star-btn:not([data-gv-default-kind="thinking"])',
        )
        .forEach((star) => star.remove());
      return;
    }

    if (description.kind === 'nested-thinking') {
      // Gemini now renders Standard/Extended inline under the Thinking level row.
      // Those child rows may still carry model-like metadata, so keep them out
      // of the model default path and let the thinking-level injector own them.
      item.querySelectorAll('.gv-default-star-btn').forEach((star) => star.remove());
      return;
    }

    // Skip submenu triggers (e.g. "Thinking level" → Standard/Extended in the 2026 redesign).
    // Real model rows always resolve to a stable model id; submenu rows do not.
    if (item.getAttribute('aria-haspopup') === 'true') return;
    if (item.getAttribute('role') === 'menuitem' && !description.id) {
      // role=menuitem without any resolvable id is either a submenu opener or a non-model entry.
      // role=menuitemradio (legacy variant) may legitimately lack data-mode-id, so we keep it.
      return;
    }

    const modelName = description.name;
    if (!modelName) return;

    // Avoid duplicates
    if (item.querySelector('.gv-default-star-btn')) {
      // Update state
      this.updateStarState(item, this.isDefaultForItem(currentDefault, item, modelName), 'model');
      return;
    }

    const btn = this.createStar('model', (button) => this.handleStarClick(modelName, button));

    this.appendStar(item, btn, 'model');
    this.updateStarState(item, this.isDefaultForItem(currentDefault, item, modelName), 'model');
  }

  private async injectNestedThinkingLevelStars(menuPanel: HTMLElement): Promise<void> {
    const thinkingRow = this.picker.describeMenu(menuPanel).nestedThinking;
    if (thinkingRow) await this.injectThinkingLevelStars(thinkingRow);
  }

  private async injectInlineExtendedThinkingStar(menuPanel: HTMLElement): Promise<boolean> {
    const inlineItems = this.picker.describeMenu(menuPanel).inlineThinking;
    if (!inlineItems.length) return false;

    if (!this.preferences.enabled) {
      inlineItems.forEach((item) =>
        item.querySelectorAll('.gv-default-star-btn').forEach((star) => star.remove()),
      );
      return false;
    }

    // Low / Medium / High rows (Oct 2026) are a level list, not the Extended toggle.
    if (inlineItems.length > 1) {
      this.injectThinkingRowStars(inlineItems);
      return true;
    }
    const [item] = inlineItems;

    const label = this.picker.describeItem(item).thinkingLabel;
    if (!label) return false;

    let btn = item.querySelector<HTMLElement>(
      '.gv-default-star-btn[data-gv-default-kind="thinking"]',
    );
    if (!btn) {
      btn = this.createStar('thinking', (button) =>
        this.handleThinkingLevelStarClick(0, label, button, 'extended'),
      );

      this.appendStar(item, btn, 'thinking');
    }

    this.updateStarState(
      item,
      this.isInlineExtendedThinkingDefault(this.preferences.thinking, label),
      'thinking',
    );
    return true;
  }

  private isInlineExtendedThinkingDefault(
    currentDefault: DefaultThinkingLevel | null,
    label: string,
  ): boolean {
    if (!currentDefault) return false;
    if (currentDefault.mode) return currentDefault.mode === 'extended';
    if (currentDefault.label.toLowerCase().trim() === label.toLowerCase().trim()) return true;
    // Legacy submenu storage used index 1 for Extended. Do not treat an
    // unmatched index 0 as Extended: that may be a localized Standard value.
    return !this.preferences.isPageDefaultThinkingLevel(currentDefault) && currentDefault.index > 0;
  }

  private async injectThinkingLevelStars(submenuPane: HTMLElement): Promise<boolean> {
    // Master kill switch — see comment on `injectStarButtons`.
    if (!this.preferences.enabled) {
      this.sweep(submenuPane);
      return false;
    }

    const items = Array.from(
      submenuPane.querySelectorAll<HTMLElement>('gem-menu-item, [role="menuitem"]'),
    );
    if (!items.length) return false;

    // Orphan-star sweep — same rationale as `injectStarButtons`.
    const currentItems = new Set<Element>(items);
    submenuPane.querySelectorAll('.gv-default-star-btn').forEach((star) => {
      const owner = star.closest('gem-menu-item, [role="menuitem"]');
      if (!owner || !currentItems.has(owner)) {
        star.remove();
      }
    });

    this.injectThinkingRowStars(items);
    return true;
  }

  private injectThinkingRowStars(items: HTMLElement[]): void {
    const labels = items.map((item) => this.picker.describeItem(item).thinkingLabel);
    // Resolve the single default row up front. Deciding per-item let a drifted
    // stored index light up a second star alongside the label match — the
    // "both thinking levels selected" bug.
    const defaultIndex = this.preferences.resolveThinkingRowIndex(
      labels,
      this.preferences.thinking,
    );

    items.forEach((item, index) => {
      const label = labels[index];
      if (!label) return;

      const isDefault = index === defaultIndex;

      if (item.querySelector('.gv-default-star-btn')) {
        this.updateStarState(item, isDefault, 'thinking');
        return;
      }

      const btn = this.createStar('thinking', (button) =>
        this.handleThinkingLevelStarClick(
          index,
          label,
          button,
          this.preferences.thinkingModeForRow(index, items.length),
        ),
      );

      this.appendStar(item, btn, 'thinking');

      this.updateStarState(item, isDefault, 'thinking');
    });
  }

  private updateStarState(item: HTMLElement, isDefault: boolean, kind: 'model' | 'thinking') {
    const btn = item.querySelector('.gv-default-star-btn') as HTMLElement | null;
    if (!btn) return;
    this.bindStarOwnerHover(item, btn);
    if (!btn.hasAttribute('data-event-bound')) {
      btn.setAttribute('data-event-bound', 'true');
      btn.addEventListener('mousedown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => e.stopPropagation());
    }
    if (isDefault) {
      btn.classList.add('is-default');
      btn.innerHTML = this.getStarIcon(true);
      btn.title = chrome.i18n.getMessage(
        kind === 'model' ? 'cancelDefaultModel' : 'cancelDefaultThinkingLevel',
      );
    } else {
      btn.classList.remove('is-default');
      btn.innerHTML = this.getStarIcon(false);
      btn.title = chrome.i18n.getMessage(
        kind === 'model' ? 'setAsDefaultModel' : 'setAsDefaultThinkingLevel',
      );
    }
  }

  private async handleThinkingLevelStarClick(
    index: number,
    label: string,
    btn: HTMLElement,
    mode?: ThinkingMode,
  ) {
    // Stale-click guard. Stars are normally swept the instant the user
    // toggles the kill switch off, but a star inside a detached overlay
    // pane (or attached to a closure from a previous on-session) can
    // outlive the sweep. Without this guard such a click would silently
    // mutate storage even though the user has paused the feature.
    if (!this.preferences.enabled) {
      btn
        .closest('[role="menuitemradio"], [role="menuitem"], gem-menu-item')
        ?.querySelectorAll('.gv-default-star-btn')
        .forEach((el) => el.remove());
      return;
    }
    // The star's own class is the source of truth for whether THIS row is the
    // current default — re-deriving it from (index,label) is exactly what let a
    // drifted index treat two rows as default.
    const isCurrentlyDefault = btn.classList.contains('is-default');
    const nextDefault: DefaultThinkingLevel | null = isCurrentlyDefault
      ? null
      : { index, label, ...(mode ? { mode } : {}) };

    const persistence = this.preferences.persistThinking(nextDefault);

    const itemEl = btn.closest('gem-menu-item, [role="menuitem"]');
    if (itemEl instanceof HTMLElement) {
      this.updateStarState(itemEl, nextDefault !== null, 'thinking');
    }

    if (nextDefault) {
      this.showToast(chrome.i18n.getMessage('defaultThinkingLevelSet', [label]));
    } else {
      this.showToast(chrome.i18n.getMessage('defaultThinkingLevelCleared'));
    }

    const submenu = this.picker.findThinkingLevelSubmenuPane();
    if (submenu) {
      void this.injectThinkingLevelStars(submenu);
    } else {
      // Inline level rows share the model menu; refresh it so the previous default unstars.
      const menuPanel = this.picker.getModeSwitchMenuPanel();
      if (menuPanel) void this.injectStarButtons(menuPanel);
    }

    await persistence;
  }

  private isDefaultForItem(
    currentDefault: DefaultModelSetting | null,
    item: HTMLElement,
    modelName: string,
  ): boolean {
    if (!currentDefault) return false;
    if (currentDefault.kind === 'id') {
      const id = this.picker.describeItem(item).id;
      return id === currentDefault.id;
    }
    return currentDefault.name === modelName;
  }

  private createStar(
    kind: 'model' | 'thinking',
    onClick: (button: HTMLButtonElement) => Promise<void>,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'gv-default-star-btn';
    btn.dataset.gvDefaultKind = kind;
    btn.innerHTML = this.getStarIcon(false);
    btn.title = chrome.i18n.getMessage(
      kind === 'model' ? 'setAsDefaultModel' : 'setAsDefaultThinkingLevel',
    );
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      event.preventDefault();
      await onClick(btn);
    });
    return btn;
  }

  private appendStar(item: HTMLElement, btn: HTMLElement, kind: 'model' | 'thinking'): void {
    const container = item.querySelector(
      kind === 'model' ? '.title-and-description, .label-container' : '.label-container',
    );
    const title = container?.querySelector(
      kind === 'model'
        ? '.mode-title, .gds-title-m, .gds-label-l, .label'
        : '.label, .gds-title-m, .gds-label-l',
    );
    if (!container || !title) {
      (container ?? item).appendChild(btn);
      return;
    }
    const parent = title.parentElement;
    let wrapper = container.querySelector<HTMLElement>('.gv-title-wrapper');
    if (!wrapper && parent?.classList.contains('gv-title-wrapper')) wrapper = parent;
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'gv-title-wrapper';
      wrapper.style.cssText = 'display: flex; align-items: center; width: 100%;';
      if (parent) parent.insertBefore(wrapper, title);
      else container.appendChild(wrapper);
      wrapper.appendChild(title);
    }
    wrapper.appendChild(btn);
  }

  private bindStarOwnerHover(item: HTMLElement, btn: HTMLElement) {
    if (btn.hasAttribute('data-hover-bound')) return;
    btn.setAttribute('data-hover-bound', 'true');

    item.addEventListener('mouseenter', () => {
      btn.classList.add('is-owner-hovered');
    });
    item.addEventListener('mouseleave', () => {
      btn.classList.remove('is-owner-hovered');
    });
    item.addEventListener('focusin', () => {
      btn.classList.add('is-owner-hovered');
    });
    item.addEventListener('focusout', (event) => {
      const nextTarget = event.relatedTarget;
      if (!(nextTarget instanceof Node) || !item.contains(nextTarget)) {
        btn.classList.remove('is-owner-hovered');
      }
    });
  }

  private getStarIcon(filled: boolean): string {
    if (filled) {
      return `<svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" fill="currentColor"></path></svg>`;
    } else {
      return `<svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" fill="none" stroke="currentColor" stroke-width="1.5"></path></svg>`;
    }
  }

  private async handleStarClick(modelName: string, btn: HTMLElement) {
    const closestItem = btn.closest(MODE_ITEM_SELECTOR);
    const modelItem = closestItem instanceof HTMLElement ? closestItem : null;
    const modelId = modelItem ? this.picker.describeItem(modelItem).id : null;

    // Stale-click guard — see comment on `handleThinkingLevelStarClick`.
    if (!this.preferences.enabled) {
      if (modelItem) {
        modelItem.querySelectorAll('.gv-default-star-btn').forEach((el) => el.remove());
      } else {
        btn.remove();
      }
      return;
    }

    // 1. Optimistic UI Update (Instant feedback)
    const isCurrentlyDefault = modelItem
      ? this.isDefaultForItem(this.preferences.model, modelItem, modelName)
      : this.preferences.model?.kind === 'name'
        ? this.preferences.model.name === modelName
        : false;

    const nextDefault: DefaultModelSetting | null = isCurrentlyDefault
      ? null
      : modelId
        ? { kind: 'id', id: modelId, name: modelName }
        : { kind: 'name', name: modelName };

    // Update cache immediately
    const persistence = this.preferences.persistModel(nextDefault);

    // Update current button immediately
    if (modelItem) {
      this.updateStarState(
        modelItem,
        this.isDefaultForItem(nextDefault, modelItem, modelName),
        'model',
      );
    }

    // Show Toast immediately
    if (nextDefault) {
      this.showToast(chrome.i18n.getMessage('defaultModelSet', [modelName]));
    } else {
      this.showToast(chrome.i18n.getMessage('defaultModelCleared'));
    }

    // Update other buttons (e.g. if switching from A to B)
    const menuPanel = this.picker.getModeSwitchMenuPanel();
    if (menuPanel) {
      // Re-run injection to update all other buttons based on new cache
      void this.injectStarButtons(menuPanel as HTMLElement);
    }

    await persistence;
  }

  private showToast(message: string) {
    // One channel: setting, then clearing, a default replaces the earlier note.
    this.toaster.show({ message, channel: 'default-model', durationMs: CONFIRMATION_TOAST_MS });
  }
}
