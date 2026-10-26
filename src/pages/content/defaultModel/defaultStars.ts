import type { GeminiSelectorView } from '@/core/gemini/selectors';
import type { Toaster } from '@/core/ui/toast/types';

import { DefaultStarView, sweepStars } from './defaultStarView';
import { ModelPicker } from './modelPicker';
import { readModelId } from './modelPickerMetadata';
import { DefaultModelPreferences } from './preferences';
import type { DefaultModelSetting, DefaultThinkingLevel, ThinkingMode } from './preferences';

export { startStaleStarSweeper } from './defaultStarView';

const CONFIRMATION_TOAST_MS = 3000;
const MENU_RENDER_DELAY_MS = 50;

export class DefaultStars {
  private observer: MutationObserver | null = null;
  private pendingMenuPanelInjections = new WeakSet<HTMLElement>();
  private menuPanelInjectAttempts = new WeakMap<HTMLElement, number>();
  private started = false;
  private readonly view = new DefaultStarView();
  private readonly timers = new Set<number>();

  public constructor(
    private readonly preferences: DefaultModelPreferences,
    private readonly picker: ModelPicker,
    private readonly toaster: Toaster,
  ) {}

  // Preferences must be loaded before observation starts.
  public start(): void {
    if (this.started) return;
    this.started = true;
    this.view.start();
    this.initObserver();
  }

  /**
   * Takes out everything this run injected: star buttons and title wrappers,
   * including those in a pane Gemini detached and may reattach later, the
   * listeners on Gemini's menu items, and pending injection retries.
   */
  public stop(): void {
    this.started = false;
    this.observer?.disconnect();
    this.observer = null;
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
    this.view.stop();
    this.pendingMenuPanelInjections = new WeakSet<HTMLElement>();
    this.menuPanelInjectAttempts = new WeakMap<HTMLElement, number>();
  }

  private initObserver() {
    // Observe only for the mode switch panel/bottom-sheet being added; Gemini UI triggers many mutations and
    // querying the entire document on every mutation can cause severe jank/crashes.
    this.observer = new MutationObserver((mutations) => {
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

  private scheduleMenuPanelInjection(menuPanel: HTMLElement) {
    // Second-line defence: even if a caller bypassed the observer-level
    // gate, never queue retry attempts when the kill switch is off.
    if (this.pendingMenuPanelInjections.has(menuPanel)) return;
    this.pendingMenuPanelInjections.add(menuPanel);

    // Allow menu content to render.
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      if (!this.started) return;

      this.pendingMenuPanelInjections.delete(menuPanel);

      void this.injectStarButtons(menuPanel).then((didInject) => {
        // Stopped while the stars were going in: queue no retry.
        if (!this.started) return;
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
    }, MENU_RENDER_DELAY_MS);
    this.timers.add(timer);
  }

  private async injectStarButtons(menuPanel: HTMLElement): Promise<boolean> {
    // When the master kill switch is off, do not just bail — actively sweep
    // any star buttons that survived from a previous on-state. Bailing left
    // residual stars clickable, which then re-entered handleStarClick and
    // produced an inconsistent multi-is-default state because the cleanup
    // re-injection short-circuited too. See issue follow-up to the
    // default-model toggle.
    if (!this.started) {
      sweepStars(menuPanel);
      return false;
    }

    const { items, kind, inlineThinking, nestedThinking, view } =
      this.picker.describeMenu(menuPanel);
    if (!items.length) return false;
    if (kind === 'thinking') return this.injectThinkingLevelStars(menuPanel, view);
    if (kind !== 'model') return false;

    // Sweep stars whose owning item is no longer in the current `items`
    // set. Gemini's Angular view recycling can leave old item elements
    // attached to the panel after a re-render; without this sweep, the
    // per-item dedup below would happily inject a fresh star into each new
    // item, leaving the orphaned old item with its own star — visually
    // duplicating the star icon.
    menuPanel.querySelectorAll('.gv-default-star-btn').forEach((star) => {
      if (!items.some((item) => item.contains(star))) star.remove();
    });

    const currentDefault = this.preferences.model;

    items.forEach((item) => this.injectModelStar(item, currentDefault, view));

    this.injectInlineExtendedThinkingStar(inlineThinking, view);
    if (!this.started) return false;
    if (nestedThinking) this.injectThinkingLevelStars(nestedThinking, view);

    return this.started;
  }

  private injectModelStar(
    item: HTMLElement,
    currentDefault: DefaultModelSetting | null,
    view: GeminiSelectorView,
  ): void {
    const description = this.picker.describeItem(item, view);
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
      this.view.updateStarState(
        item,
        this.isDefaultForItem(currentDefault, item, modelName),
        'model',
      );
      return;
    }

    const btn = this.view.createStar('model', (button) =>
      this.handleStarClick(item, description.id, modelName, button),
    );

    this.view.appendStar(item, btn, this.picker.starAnchor(item, 'model', view));
    this.view.updateStarState(
      item,
      this.isDefaultForItem(currentDefault, item, modelName),
      'model',
    );
  }

  private injectInlineExtendedThinkingStar(
    inlineItems: HTMLElement[],
    view: GeminiSelectorView,
  ): boolean {
    if (!inlineItems.length) return false;

    if (!this.started) {
      inlineItems.forEach((item) =>
        item.querySelectorAll('.gv-default-star-btn').forEach((star) => star.remove()),
      );
      return false;
    }

    // Low / Medium / High rows (Oct 2026) are a level list, not the Extended toggle.
    if (inlineItems.length > 1) {
      this.injectThinkingRowStars(inlineItems, view);
      return true;
    }
    const [item] = inlineItems;

    const label = this.picker.describeItem(item, view).thinkingLabel;
    if (!label) return false;

    let btn = item.querySelector<HTMLElement>(
      '.gv-default-star-btn[data-gv-default-kind="thinking"]',
    );
    if (!btn) {
      btn = this.view.createStar('thinking', (button) =>
        this.handleThinkingLevelStarClick(item, 0, label, button, 'extended'),
      );

      this.view.appendStar(item, btn, this.picker.starAnchor(item, 'thinking', view));
    }

    this.view.updateStarState(
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

  private injectThinkingLevelStars(
    submenuPane: HTMLElement,
    view = this.picker.describeMenu(submenuPane).view,
  ): boolean {
    // Master kill switch — see comment on `injectStarButtons`.
    if (!this.started) {
      sweepStars(submenuPane);
      return false;
    }

    const items = this.picker.thinkingItems(submenuPane, view);
    if (!items.length) return false;

    // Orphan-star sweep — same rationale as `injectStarButtons`.
    submenuPane.querySelectorAll('.gv-default-star-btn').forEach((star) => {
      if (!items.some((item) => item.contains(star))) star.remove();
    });

    this.injectThinkingRowStars(items, view);
    return true;
  }

  private injectThinkingRowStars(items: HTMLElement[], view: GeminiSelectorView): void {
    const labels = items.map((item) => this.picker.describeItem(item, view).thinkingLabel);
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
        this.view.updateStarState(item, isDefault, 'thinking');
        return;
      }

      const btn = this.view.createStar('thinking', (button) =>
        this.handleThinkingLevelStarClick(
          item,
          index,
          label,
          button,
          this.preferences.thinkingModeForRow(index, items.length),
        ),
      );

      this.view.appendStar(item, btn, this.picker.starAnchor(item, 'thinking', view));

      this.view.updateStarState(item, isDefault, 'thinking');
    });
  }

  private async handleThinkingLevelStarClick(
    item: HTMLElement,
    index: number,
    label: string,
    btn: HTMLElement,
    mode?: ThinkingMode,
  ) {
    // Stale-click guard. Stars are normally swept the instant the user
    // toggles the kill switch off, but a star inside a detached overlay
    // pane (or attached to a closure from a previous on-session) can
    // outlive the sweep. Without this guard such a click would silently
    // mutate storage even though the user has paused the feature. A star
    // left over from a stopped run gets the same treatment.
    if (!this.started) {
      item.querySelectorAll('.gv-default-star-btn').forEach((el) => el.remove());
      return;
    }
    // A recycled or reparented row must not write a preference for another level.
    if (
      !item.isConnected ||
      !item.contains(btn) ||
      !this.picker.isCurrentThinkingStar(item, index, label)
    ) {
      btn.remove();
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

    this.view.updateStarState(item, nextDefault !== null, 'thinking');

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
      const id = readModelId(item);
      return id === currentDefault.id;
    }
    return currentDefault.name === modelName;
  }

  private async handleStarClick(
    modelItem: HTMLElement,
    modelId: string | null,
    modelName: string,
    btn: HTMLElement,
  ) {
    // Stale-click guard — see comment on `handleThinkingLevelStarClick`.
    if (!this.started) {
      if (modelItem) {
        modelItem.querySelectorAll('.gv-default-star-btn').forEach((el) => el.remove());
      } else {
        btn.remove();
      }
      return;
    }

    // A star owns its captured row; a fresh remote closest() must never change that owner.
    if (
      !modelItem.isConnected ||
      !modelItem.contains(btn) ||
      !this.picker.isCurrentModelStar(modelItem, modelId, modelName)
    ) {
      btn.remove();
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
      this.view.updateStarState(
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
