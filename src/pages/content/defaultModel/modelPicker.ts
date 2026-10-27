// Model-menu locking adapts interaction ideas from Gemini Helper by urzeye
// (https://greasyfork.org/scripts/558318-gemini-helper, https://github.com/urzeye/tampermonkey-scripts).
import { getGeminiSelectorView, type GeminiSelectorView } from '@/core/gemini/selectors';
import { logger } from '@/core/services/LoggerService';

import { ModelPickerDom } from './modelPickerDom';
import { isInlineThinkingItem } from './modelPickerMetadata';
import {
  readModelChoice,
  readModelPicker,
  readNestedThinkingChoice,
  readThinkingChoice,
} from './modelPickerOperations';
import { readPickerPill } from './modelPickerSelectors';
import { DefaultModelPreferences } from './preferences';
import type { DefaultModelSetting, DefaultThinkingLevel } from './preferences';

// Retry policy and composer focus belong to the automatic-application state machine.
export type PickerInteraction = {
  /** Retired sessions may not click, persist, focus or close a menu after an await. */
  isCurrent: () => boolean;
  shouldYield: () => boolean;
  stop: () => void;
  failed: () => void;
  resetFailures: () => void;
  focusInput: () => void;
};

const MENU_POLL_INTERVAL_MS = 50;
export type ThinkingPickResult = 'switched' | 'unchanged' | 'cancelled';

function pause(ms: number): Promise<void> {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

type ModelChoice = ReturnType<typeof readModelChoice>['value'];
type ThinkingChoice = ReturnType<typeof readThinkingChoice>['value'];
type NestedThinkingChoice = ReturnType<typeof readNestedThinkingChoice>['value'];

export class ModelPicker {
  private isLocked = false;

  public constructor(private readonly preferences: DefaultModelPreferences) {}

  private readView(): GeminiSelectorView {
    return getGeminiSelectorView();
  }

  public async selectModel(
    targetModel: DefaultModelSetting,
    interaction: PickerInteraction,
  ): Promise<'switched' | 'already-selected' | 'failed' | 'cancelled'> {
    if (!interaction.isCurrent()) return 'cancelled';
    const opening = this.readTrigger();
    const trigger = opening.value.button;
    if (!trigger || !opening.value.lines.length) return 'failed';
    if (this.preferences.modelMatchesLines(targetModel, opening.value.lines)) {
      interaction.stop();
      return 'already-selected';
    }
    if (interaction.shouldYield()) {
      interaction.stop();
      return 'failed';
    }
    if (this.isLocked) return 'failed';
    this.isLocked = true;
    try {
      trigger.click();
      const accepted = await this.waitForModelChoice(
        opening.view,
        trigger,
        targetModel,
        interaction.isCurrent,
      );
      if (!interaction.isCurrent()) return 'cancelled';
      // The menu may repaint selected state while the await resumes; reread before acting.
      const choice = accepted ? readModelChoice(accepted.view, trigger, targetModel).value : null;
      if (
        !choice?.item ||
        !choice.description ||
        !choice.panel.isConnected ||
        !choice.panel.contains(choice.item)
      ) {
        document.body.click();
        interaction.failed();
        return 'failed';
      }
      if (!choice.selected) {
        choice.item.click();
        interaction.focusInput();
        return 'switched';
      }
      document.body.click();
      interaction.stop();
      await this.preferences.rememberTriggerPillLabel(targetModel, {
        name: choice.description.name,
        id: choice.description.id,
        pill: readPickerPill(trigger)[0],
      });
      if (!interaction.isCurrent()) return 'cancelled';
      return 'already-selected';
    } catch (error) {
      logger.warn('Auto model lock failed', { error: String(error) });
      return 'failed';
    } finally {
      this.isLocked = false;
    }
  }

  public async selectThinking(
    target: DefaultThinkingLevel,
    interaction: PickerInteraction,
  ): Promise<ThinkingPickResult> {
    if (!interaction.isCurrent()) return 'cancelled';
    if (interaction.shouldYield()) {
      interaction.stop();
      return 'unchanged';
    }
    if (this.isLocked) return 'unchanged';
    this.isLocked = true;
    try {
      const opening = this.readTrigger();
      const trigger = opening.value.button;
      if (!trigger) return 'unchanged';
      trigger.click();
      const accepted = await this.waitForThinkingChoice(
        opening.view,
        trigger,
        interaction.isCurrent,
      );
      if (!interaction.isCurrent()) return 'cancelled';
      const choice = accepted ? readThinkingChoice(accepted.view, trigger).value : null;
      if (!choice?.panel.isConnected) {
        document.body.click();
        interaction.failed();
        return 'unchanged';
      }
      if (choice.items.length) {
        const index =
          choice.items.length === 1
            ? 0
            : this.preferences.resolveThinkingRowIndex(choice.labels, target);
        const item = choice.items[index];
        if (!item || !choice.panel.contains(item)) {
          document.body.click();
          interaction.failed();
          return 'unchanged';
        }
        return this.applyThinkingItem(item, choice.selected[index], interaction);
      }
      const row = choice.row;
      if (!row) {
        document.body.click();
        interaction.stop();
        return 'unchanged';
      }
      if (!row.isConnected) {
        document.body.click();
        return 'unchanged';
      }
      this.openThinkingLevelSubmenu(row, choice.content);
      const acceptedNested = await this.waitForNestedThinkingChoice(
        choice.view,
        trigger,
        row,
        interaction.isCurrent,
      );
      if (!interaction.isCurrent()) return 'cancelled';
      const nested = acceptedNested
        ? readNestedThinkingChoice(acceptedNested.view, trigger, row).value
        : null;
      if (!nested?.pane.isConnected) {
        document.body.click();
        interaction.failed();
        return 'unchanged';
      }
      // A submenu that mounted without levels is not a failed open.
      if (!nested.items.length) {
        document.body.click();
        return 'unchanged';
      }
      const index = this.preferences.resolveThinkingRowIndex(nested.labels, target);
      const item = nested.items[index];
      if (!item || !nested.pane.contains(item)) {
        document.body.click();
        interaction.failed();
        return 'unchanged';
      }
      return this.applyThinkingItem(item, nested.selected[index], interaction);
    } catch (error) {
      logger.warn('Auto thinking-level lock failed', { error: String(error) });
      return 'unchanged';
    } finally {
      this.isLocked = false;
    }
  }

  private applyThinkingItem(
    item: HTMLElement,
    selected: boolean,
    interaction: PickerInteraction,
  ): 'switched' | 'unchanged' {
    if (!selected) {
      item.click();
      document.body.click();
      interaction.focusInput();
      interaction.resetFailures();
      return 'switched';
    }
    document.body.click();
    interaction.resetFailures();
    interaction.stop();
    return 'unchanged';
  }

  private async waitForModelChoice(
    view: GeminiSelectorView,
    trigger: HTMLElement,
    target: DefaultModelSetting,
    isCurrent: () => boolean,
  ): Promise<ModelChoice> {
    const startedAt = Date.now();
    while (isCurrent() && Date.now() - startedAt < 1500) {
      const choice = readModelChoice(view, trigger, target).value;
      if (choice?.panel.isConnected) return choice;
      await pause(MENU_POLL_INTERVAL_MS);
    }
    return null;
  }

  private async waitForThinkingChoice(
    view: GeminiSelectorView,
    trigger: HTMLElement,
    isCurrent: () => boolean,
  ): Promise<ThinkingChoice> {
    const startedAt = Date.now();
    while (isCurrent() && Date.now() - startedAt < 1500) {
      const choice = readThinkingChoice(view, trigger).value;
      if (choice?.panel.isConnected) return choice;
      await pause(MENU_POLL_INTERVAL_MS);
    }
    return null;
  }

  private async waitForNestedThinkingChoice(
    view: GeminiSelectorView,
    trigger: HTMLElement,
    row: HTMLElement,
    isCurrent: () => boolean,
  ): Promise<NestedThinkingChoice> {
    const startedAt = Date.now();
    while (isCurrent() && Date.now() - startedAt < 1500) {
      const choice = readNestedThinkingChoice(view, trigger, row).value;
      if (choice?.pane.isConnected && choice.items.length) return choice;
      await pause(MENU_POLL_INTERVAL_MS);
    }
    return null;
  }

  private openThinkingLevelSubmenu(thinkingRow: HTMLElement, content: HTMLElement | null): void {
    const targets = content && content !== thinkingRow ? [thinkingRow, content] : [thinkingRow];
    const mouseInit: MouseEventInit = { bubbles: true, cancelable: true };
    const enterInit: MouseEventInit = { bubbles: false, cancelable: true };
    for (const target of targets) {
      if ('PointerEvent' in window) {
        const pointerInit: PointerEventInit = {
          bubbles: true,
          cancelable: true,
          pointerType: 'mouse',
        };
        target.dispatchEvent(new PointerEvent('pointerover', pointerInit));
        target.dispatchEvent(new PointerEvent('pointerenter', { ...pointerInit, bubbles: false }));
        target.dispatchEvent(new PointerEvent('pointermove', pointerInit));
      }
      target.dispatchEvent(new MouseEvent('mouseover', mouseInit));
      target.dispatchEvent(new MouseEvent('mouseenter', enterInit));
      target.dispatchEvent(new MouseEvent('mousemove', mouseInit));
    }
    thinkingRow.focus({ preventScroll: true });
    thinkingRow.click();
  }

  private readTrigger() {
    return readModelPicker(
      this.readView(),
      (dom) => {
        const button = dom.findSelectorButton();
        return { button, lines: readPickerPill(button) };
      },
      (value) => Boolean(value.button && value.lines.length),
    );
  }

  public describeItem(item: HTMLElement, view?: GeminiSelectorView) {
    if (view) return new ModelPickerDom(view).describeItem(item);
    return readModelPicker(
      this.readView(),
      (dom) => dom.describeItem(item),
      (value) => Boolean(value.kind === 'model' ? value.name : value.thinkingLabel),
    ).value;
  }

  public describeMenu(panel: HTMLElement, view = this.readView()) {
    return readModelPicker(
      view,
      (dom) => dom.describeMenu(panel),
      (menu) => menu.kind !== 'other' && menu.items.length > 0,
    ).value;
  }

  public resolveAddedMenu(root: HTMLElement): HTMLElement | null {
    return readModelPicker(
      this.readView(),
      (dom) => {
        const panel = dom.resolveAddedMenu(root);
        if (panel && dom.remote) dom.describeMenu(panel);
        return panel;
      },
      (panel) => panel !== null,
    ).value;
  }

  public getModeSwitchMenuPanel(): HTMLElement | null {
    return readModelPicker(
      this.readView(),
      (dom) => {
        const panel = dom.getModeSwitchMenuPanel();
        if (panel && dom.remote && dom.describeMenu(panel).kind !== 'model') return null;
        return panel;
      },
      (panel) => panel !== null,
    ).value;
  }

  public findThinkingLevelSubmenuPane(): HTMLElement | null {
    return readModelPicker(
      this.readView(),
      (dom) => {
        const pane = dom.findThinkingLevelSubmenuPane();
        if (pane && dom.remote) dom.describeMenu(pane);
        return pane;
      },
      (pane) => pane !== null,
    ).value;
  }

  public readTriggerPillLines(): string[] {
    return this.readTrigger().value.lines;
  }

  public thinkingItems(pane: HTMLElement, view: GeminiSelectorView): HTMLElement[] {
    return new ModelPickerDom(view).thinkingItems(pane);
  }

  public starAnchor(item: HTMLElement, kind: 'model' | 'thinking', view: GeminiSelectorView) {
    return new ModelPickerDom(view).starAnchor(item, kind);
  }

  /** The clicked star keeps the item it was attached to, never a newly matched ancestor. */
  public isCurrentModelStar(item: HTMLElement, id: string | null, name: string): boolean {
    return readModelPicker(
      this.readView(),
      (dom) => {
        // The star's own menu, not whichever menu the page lists first.
        const panel = dom.menuOf(item);
        if (!panel || !panel.isConnected) return false;
        const menu = dom.describeMenu(panel);
        const description = dom.describeItem(item);
        return (
          menu.kind === 'model' &&
          menu.items.includes(item) &&
          description.kind === 'model' &&
          description.id === id &&
          description.name === name
        );
      },
      Boolean,
    ).value;
  }

  public isCurrentThinkingStar(item: HTMLElement, index: number, label: string): boolean {
    return readModelPicker(
      this.readView(),
      (dom) => {
        let items: HTMLElement[];
        if (isInlineThinkingItem(item)) {
          const panel = dom.menuOf(item);
          if (!panel || !panel.isConnected) return false;
          dom.describeMenu(panel);
          items = dom.findInlineThinkingItems(panel);
        } else {
          const pane = dom.findThinkingLevelSubmenuPane();
          if (!pane || !pane.isConnected) return false;
          items = dom.getThinkingLevelItems();
        }
        return items[index] === item && dom.getThinkingLevelLabel(item) === label;
      },
      Boolean,
    ).value;
  }
}
