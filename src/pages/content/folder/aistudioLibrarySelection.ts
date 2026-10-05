/**
 * Multi-select on /library rows: a long press starts it, clicks then toggle
 * rows, and a floating bar counts the selection and offers batch delete.
 */
import { askConfirm } from '@/core/ui/confirm';
import { isVoyagerLayerEvent } from '@/core/ui/layer';
import type { ToastTone, Toaster } from '@/core/ui/toast/types';

import { LibraryBatchDeleter } from './aistudioLibraryBatchDelete';
import { getLibraryPromptRows, isLibraryPath, libraryPromptData } from './aistudioLibraryTable';

const LONG_PRESS_MS = 500;
const MAX_BATCH_DELETE_COUNT = 50;
const PAGE_REFRESH_DELAY_MS = 1500;
const SELECTED_ROW_CLASS = 'gv-library-row-selected';

type SelectableRow = HTMLElement & { _gvLibraryMultiSelectBound?: boolean };

function createIcon(name: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'google-symbols';
  span.dataset.icon = name;
  span.textContent = name;
  return span;
}

function onControl(event: Event): boolean {
  return event.target instanceof Element && !!event.target.closest('button, [role="button"]');
}

export class LibrarySelection {
  private readonly selected = new Set<string>();
  private active = false;
  private deleting = false;
  private host: HTMLElement | null = null;
  private outsideClick: ((event: MouseEvent) => void) | null = null;
  /** Aborted when the selection ends, which answers its open confirm with null. */
  private session = new AbortController();
  /** Bumped by destroy(); the manager reuses this selection when re-enabled. */
  private lifetime = 0;
  private refreshTimer: number | null = null;
  private readonly deleter: LibraryBatchDeleter;

  constructor(
    private readonly t: (key: string) => string,
    private readonly notify: (message: string, tone: ToastTone) => void,
    toaster: Toaster,
  ) {
    this.deleter = new LibraryBatchDeleter(t, toaster);
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Long press starts selecting from this row; while selecting, a click toggles it. */
  bindRow(row: SelectableRow): void {
    if (row._gvLibraryMultiSelectBound) return;
    row._gvLibraryMultiSelectBound = true;
    let longPressed = false;
    let timer: number | null = null;
    const clearPress = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };

    row.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || onControl(event)) return;
      const data = libraryPromptData(row);
      if (!data) return;
      longPressed = false;
      clearPress();
      timer = window.setTimeout(() => {
        longPressed = true;
        this.enter(data.conversationId);
      }, LONG_PRESS_MS);
    });
    row.addEventListener('mouseup', clearPress);
    row.addEventListener('mouseleave', clearPress);
    row.addEventListener(
      'click',
      (event) => {
        if (onControl(event) || this.deleting) return;
        if (longPressed) {
          event.preventDefault();
          event.stopPropagation();
          longPressed = false;
          return;
        }
        const data = this.active ? libraryPromptData(row) : null;
        if (!data) return;
        event.preventDefault();
        event.stopPropagation();
        this.toggle(data.conversationId);
      },
      true,
    );
  }

  exit(): void {
    this.active = false;
    this.session.abort();
    this.removeOutsideClick();
    this.selected.clear();
    this.refresh();
  }

  /** Marks selected rows and syncs the floating bar with the selection. */
  refresh(): void {
    for (const row of getLibraryPromptRows()) {
      const data = libraryPromptData(row);
      row.classList.toggle(SELECTED_ROW_CLASS, !!data && this.selected.has(data.conversationId));
    }
    const host = this.active ? this.ensureHost() : this.host?.isConnected ? this.host : null;
    if (!host) return;
    host.classList.toggle('gv-multi-select-mode', this.active);
    const count = host.querySelector('[data-selection-count="true"]');
    if (count) count.textContent = this.countLabel(this.selected.size);
    const actions = host.querySelector('[data-multi-select-actions="true"]');
    if (!actions) return;
    if (!this.active) {
      if (actions.childElementCount > 0) actions.innerHTML = '';
      return;
    }
    if (actions.childElementCount === 0) actions.append(...this.actionButtons());
  }

  destroy(): void {
    this.lifetime++;
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    if (this.active) this.exit();
    this.removeOutsideClick();
    this.host?.remove();
    this.host = null;
    this.deleter.hideProgress();
  }

  private enter(conversationId: string): void {
    this.active = true;
    this.session = new AbortController();
    this.selected.add(conversationId);
    this.refresh();
    this.addOutsideClick();
  }

  private toggle(conversationId: string): void {
    if (this.selected.has(conversationId)) {
      this.selected.delete(conversationId);
      if (this.selected.size === 0) return this.exit();
    } else if (this.selected.size >= MAX_BATCH_DELETE_COUNT) {
      const message = this.t('batch_delete_limit_reached');
      this.notify(message.replace('{max}', String(MAX_BATCH_DELETE_COUNT)), 'info');
      return;
    } else {
      this.selected.add(conversationId);
    }
    this.refresh();
  }

  private countLabel(count: number): string {
    return this.t('folder_multi_select_count').replace('{count}', String(count));
  }

  private actionButtons(): HTMLButtonElement[] {
    const deleteButton = document.createElement('button');
    deleteButton.className = 'gv-multi-select-action-btn gv-multi-select-delete-btn';
    deleteButton.title = this.t('batch_delete_button');
    deleteButton.appendChild(createIcon('delete'));
    deleteButton.addEventListener('click', () => void this.deleteSelected(deleteButton));

    const exitButton = document.createElement('button');
    exitButton.className = 'gv-multi-select-action-btn gv-multi-select-exit-btn';
    exitButton.title = this.t('folder_multi_select_exit');
    exitButton.appendChild(createIcon('close'));
    exitButton.addEventListener('click', () => this.exit());
    return [deleteButton, exitButton];
  }

  private ensureHost(): HTMLElement {
    if (this.host?.isConnected) return this.host;
    const host = document.createElement('div');
    host.className = 'gv-folder-container gv-multi-select-floating-host gv-aistudio-library-select';
    host.dataset.multiSelectFloatingHost = 'true';
    Object.assign(host.style, {
      position: 'fixed',
      top: '72px',
      right: '24px',
      width: 'min(360px, calc(100vw - 48px))',
      zIndex: String(2147483647),
    });
    host.appendChild(this.indicator());
    document.body.appendChild(host);
    this.host = host;
    return host;
  }

  private indicator(): HTMLElement {
    const indicator = document.createElement('div');
    indicator.className = 'gv-multi-select-indicator';
    const content = document.createElement('div');
    content.className = 'gv-multi-select-indicator-content';
    content.appendChild(createIcon('check_circle'));
    const text = document.createElement('span');
    text.className = 'gv-multi-select-indicator-text';
    text.dataset.selectionCount = 'true';
    text.textContent = this.countLabel(0);
    content.appendChild(text);
    const actions = document.createElement('div');
    actions.className = 'gv-multi-select-actions';
    actions.dataset.multiSelectActions = 'true';
    indicator.append(content, actions);
    return indicator;
  }

  private addOutsideClick(): void {
    this.removeOutsideClick();
    const handler = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || this.host?.contains(target)) return;
      // The delete confirm and the toasts are part of this selection's flow.
      if (isVoyagerLayerEvent(event)) return;
      if ((target as Element).closest?.('.cdk-overlay-container, .mat-mdc-dialog-container'))
        return;
      if (getLibraryPromptRows().some((row) => row.contains(target))) return;
      this.exit();
    };
    this.outsideClick = handler;
    // Registered after the click that started selecting has finished.
    setTimeout(() => {
      if (this.outsideClick === handler) document.addEventListener('click', handler, true);
    }, 0);
  }

  private removeOutsideClick(): void {
    if (!this.outsideClick) return;
    document.removeEventListener('click', this.outsideClick, true);
    this.outsideClick = null;
  }

  private async deleteSelected(anchor: HTMLElement): Promise<void> {
    if (this.deleting || this.selected.size === 0) return;
    const ids = Array.from(this.selected);
    const lifetime = this.lifetime;
    const answer = await askConfirm({
      message: this.t('batch_delete_confirm').replace('{count}', String(ids.length)),
      anchor,
      tone: 'danger',
      choices: [{ id: 'confirm', label: this.t('pm_delete') }],
      signal: this.session.signal,
    });
    if (answer !== 'confirm' || this.deleting) return;

    this.deleting = true;
    const { successCount, failedCount } = await this.deleter.run(ids).finally(() => {
      this.deleting = false;
    });
    if (failedCount === 0) {
      this.notify(
        this.t('batch_delete_success').replace('{count}', String(successCount)),
        'success',
      );
    } else {
      const message = this.t('batch_delete_partial')
        .replace('{success}', String(successCount))
        .replace('{failed}', String(failedCount));
      this.notify(message, 'warning');
    }
    this.exit();
    // AI Studio's table does not drop deleted rows on its own.
    if (successCount > 0 && this.isCurrent(lifetime)) this.scheduleRefresh(lifetime);
  }

  /** Still mounted and on /library: a reload anywhere else would discard an open prompt. */
  private isCurrent(lifetime: number): boolean {
    return this.lifetime === lifetime && isLibraryPath();
  }

  private scheduleRefresh(lifetime: number): void {
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      if (this.isCurrent(lifetime)) location.reload();
    }, PAGE_REFRESH_DELAY_MS);
  }
}
