import browser from 'webextension-polyfill';

import { resolveGeminiTurnOperation, type GeminiTurnView } from '@/core/gemini/selectors';
import { StorageKeys } from '@/core/types/common';
import { getAssistantTurnSelectors, getUserTurnSelectors } from '@/core/utils/selectors';

import type { StopNativeFeature } from '../featureLifecycle';
import { createSelectionToolbarStyle } from './styles';

const SELECTION_DEBOUNCE_MS = 250;
const MIN_EDGE_OFFSET_PX = 10;
const BUTTON_SELECTION_GAP_PX = 16;
const CSS_CLASSES = {
  TOOLBAR: 'gv-selection-toolbar',
  ACTION: 'gv-selection-action',
  HIDDEN: 'gv-hidden',
} as const;

/** Names one accepted selection; an action's late result may only clear its own. */
export type SelectionToken = number;

/** Extra controls an action places right after its button, such as Highlight's color picker. */
export interface SelectionActionControls {
  mount(parent: ParentNode): void;
  unmount(): void;
  setVisible(visible: boolean): void;
  position(): void;
  hide(): void;
  /** True when the event was consumed and the selection must not be re-read. */
  handleDismissal(event: MouseEvent | KeyboardEvent): boolean;
  updateText(): void;
}

export interface SelectionAction {
  readonly id: string;
  readonly order: number;
  /** Feature class on the button, next to the shared `gv-selection-action`. */
  readonly className: string;
  label(): string;
  createIcon(): Node;
  isAvailable(range: Range): boolean;
  /** Resolves true when the action consumed the selection. */
  run(range: Range, token: SelectionToken): boolean | Promise<boolean>;
  readonly controls?: SelectionActionControls;
}

interface Registration {
  readonly action: SelectionAction;
}

interface MountedAction {
  readonly button: HTMLButtonElement;
  readonly nodes: readonly Node[];
}

interface SelectionToolbarHost {
  refresh(): void;
  markInternalClick(): void;
  restoreSelection(): void;
  stop(): void;
}

const registry = new Map<string, Registration>();
let activeHost: SelectionToolbarHost | null = null;

const getQuoteableMessageSelector = (view: GeminiTurnView): string =>
  [
    '.conversation-container',
    ...getUserTurnSelectors(view),
    ...getAssistantTurnSelectors(view),
  ].join(', ');

function sortedRegistrations(): Registration[] {
  return Array.from(registry.values()).sort(
    (left, right) => left.action.order - right.action.order,
  );
}

function createHost(): SelectionToolbarHost {
  const style = createSelectionToolbarStyle();
  document.head.appendChild(style);
  const mounted = new Map<Registration, MountedAction>();
  let toolbar: HTMLElement | null = null;
  let range: Range | null = null;
  let token: SelectionToken | null = null;
  let nextToken = 0;
  let isInternalClick = false;
  let stopped = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let scrollRafId: number | null = null;

  const controls = (): SelectionActionControls[] =>
    Array.from(mounted.keys()).flatMap(({ action }) => (action.controls ? [action.controls] : []));

  function updatePosition(): void {
    if (!toolbar || !range) return;
    const rangeRect = range.getBoundingClientRect();
    if (rangeRect.bottom < 0 || rangeRect.top > window.innerHeight) {
      toolbar.classList.add(CSS_CLASSES.HIDDEN);
      return;
    }
    toolbar.classList.remove(CSS_CLASSES.HIDDEN);
    const toolbarRect = toolbar.getBoundingClientRect();
    // The first line keeps multi-line selections from pushing the toolbar down.
    const firstLineRect =
      typeof range.getClientRects === 'function'
        ? range.getClientRects()[0] || rangeRect
        : rangeRect;
    const top = firstLineRect.top - toolbarRect.height - BUTTON_SELECTION_GAP_PX;
    const left = rangeRect.left + rangeRect.width / 2 - toolbarRect.width / 2;
    const maxLeft = window.innerWidth - toolbarRect.width - MIN_EDGE_OFFSET_PX;
    toolbar.style.top = `${Math.max(MIN_EDGE_OFFSET_PX, top)}px`;
    toolbar.style.left = `${Math.min(maxLeft, Math.max(MIN_EDGE_OFFSET_PX, left))}px`;
    controls().forEach((control) => control.position());
  }

  function onScrollOrResize(): void {
    if (scrollRafId) return;
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null;
      updatePosition();
    });
  }

  function mountAction(registration: Registration): void {
    if (!toolbar || mounted.has(registration)) return;
    const { action } = registration;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${action.className} ${CSS_CLASSES.ACTION} ${CSS_CLASSES.HIDDEN}`;
    const label = document.createElement('span');
    label.textContent = action.label();
    button.replaceChildren(action.createIcon(), label);
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      isInternalClick = true;
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      runAction(registration);
    });
    const fragment = document.createDocumentFragment();
    fragment.appendChild(button);
    action.controls?.mount(fragment);
    mounted.set(registration, { button, nodes: Array.from(fragment.childNodes) });
  }

  function unmountAction(registration: Registration): void {
    const entry = mounted.get(registration);
    if (!entry) return;
    mounted.delete(registration);
    registration.action.controls?.hide();
    registration.action.controls?.unmount();
    entry.nodes.forEach((node) => node.parentNode?.removeChild(node));
  }

  function arrange(): void {
    if (!toolbar) return;
    const ordered = sortedRegistrations().flatMap((registration) => {
      const entry = mounted.get(registration);
      return entry ? [{ registration, entry }] : [];
    });
    toolbar.replaceChildren(...ordered.flatMap(({ entry }) => entry.nodes));
    toolbar.setAttribute(
      'aria-label',
      ordered.map(({ registration }) => registration.action.label()).join(' / '),
    );
  }

  function syncMountedActions(): void {
    if (!toolbar) return;
    Array.from(mounted.keys())
      .filter((registration) => registry.get(registration.action.id) !== registration)
      .forEach(unmountAction);
    registry.forEach(mountAction);
    arrange();
  }

  function ensureToolbar(): HTMLElement {
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.className = `${CSS_CLASSES.TOOLBAR} ${CSS_CLASSES.HIDDEN}`;
      toolbar.setAttribute('role', 'toolbar');
      syncMountedActions();
    }
    // A host re-render can detach the toolbar: put back this host's own node, so it stays the
    // only one and stop still reaches it.
    if (!toolbar.isConnected) document.body.appendChild(toolbar);
    return toolbar;
  }

  /** Shows the actions that apply to the range; false when none does. */
  function applyAvailability(current: Range): boolean {
    let anyAvailable = false;
    mounted.forEach(({ button }, { action }) => {
      const available = action.isAvailable(current);
      button.classList.toggle(CSS_CLASSES.HIDDEN, !available);
      action.controls?.setVisible(available);
      anyAvailable ||= available;
    });
    return anyAvailable;
  }

  function showToolbar(): void {
    ensureToolbar();
    updatePosition();
    window.addEventListener('scroll', onScrollOrResize, { capture: true, passive: true });
    window.addEventListener('resize', onScrollOrResize, { passive: true });
  }

  function hideToolbar(): void {
    controls().forEach((control) => control.hide());
    toolbar?.classList.add(CSS_CLASSES.HIDDEN);
    window.removeEventListener('scroll', onScrollOrResize, { capture: true });
    window.removeEventListener('resize', onScrollOrResize);
    if (scrollRafId) {
      cancelAnimationFrame(scrollRafId);
      scrollRafId = null;
    }
  }

  function dropSelection(): void {
    hideToolbar();
    range = null;
    token = null;
  }

  /** Whether the page now holds a text selection other than `accepted`. */
  function hasOtherSelection(accepted: Range): boolean {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const current = selection.getRangeAt(0);
    // Picking a color can collapse the selection to a caret; that is not a new selection.
    if (current.collapsed) return false;
    return (
      current.compareBoundaryPoints(Range.START_TO_START, accepted) !== 0 ||
      current.compareBoundaryPoints(Range.END_TO_END, accepted) !== 0
    );
  }

  function finishSelection(
    accepted: SelectionToken,
    acceptedRange: Range,
    consumed: boolean,
  ): void {
    // A slow action (a highlight save) must not hide or clear a selection made after its click,
    // even one still inside the debounce window.
    if (!consumed || stopped || accepted !== token || hasOtherSelection(acceptedRange)) return;
    dropSelection();
    window.getSelection()?.removeAllRanges();
  }

  function runAction(registration: Registration): void {
    // Unregistered buttons can survive in a detached subtree; they must not begin a new action.
    if (
      stopped ||
      registry.get(registration.action.id) !== registration ||
      !range ||
      token === null
    )
      return;
    const accepted = token;
    const acceptedRange = range;
    const result = registration.action.run(range.cloneRange(), accepted);
    if (typeof result === 'boolean') {
      finishSelection(accepted, acceptedRange, result);
      return;
    }
    void result.then(
      (consumed) => finishSelection(accepted, acceptedRange, consumed),
      () => undefined,
    );
  }

  /** The selection's range when it lies in a conversation turn, outside nav and the composer. */
  function readConversationRange(selection: Selection): Range | null {
    const anchor = selection.anchorNode;
    const element =
      anchor?.nodeType === Node.TEXT_NODE ? anchor.parentElement : (anchor as HTMLElement | null);
    const mainContent = document.querySelector('main');
    if (mainContent && !mainContent.contains(element)) return null;
    if (
      element?.closest('nav') ||
      element?.closest('[role="navigation"]') ||
      element?.closest('.sidebar') ||
      element?.closest('.mat-drawer') ||
      element?.closest('[contenteditable="true"]')
    ) {
      return null;
    }
    // Gemini's new-chat greeting and suggestions also sit in <main>; only turns are messages.
    const candidate = selection.getRangeAt(0);
    const commonAncestor =
      candidate.commonAncestorContainer instanceof Element
        ? candidate.commonAncestorContainer
        : candidate.commonAncestorContainer.parentElement;
    const { value: insideMessage } = resolveGeminiTurnOperation(
      (view) => {
        const quoteable = getQuoteableMessageSelector(view);
        return !!element?.closest(quoteable) && !!commonAncestor?.closest(quoteable);
      },
      (inside) => inside,
    );
    if (!insideMessage) return null;
    return candidate;
  }

  function evaluateSelection(): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      dropSelection();
      return;
    }
    if (!selection.toString().trim()) {
      dropSelection();
      return;
    }
    if (!selection.anchorNode) return;
    const candidate = readConversationRange(selection);
    if (!candidate || !sortedRegistrations().some(({ action }) => action.isAvailable(candidate))) {
      dropSelection();
      return;
    }
    range = candidate.cloneRange();
    token = ++nextToken;
    ensureToolbar();
    if (!applyAvailability(range)) {
      dropSelection();
      return;
    }
    const rect = range.getBoundingClientRect();
    if (rect.width !== 0 || rect.height !== 0) showToolbar();
  }

  function scheduleEvaluation(): void {
    // The selection may already have changed: an action finishing now belongs to the old one.
    token = null;
    // Let the selection settle; rapid key events would otherwise each re-measure.
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      evaluateSelection();
    }, SELECTION_DEBOUNCE_MS);
  }

  function onMouseUp(event: MouseEvent): void {
    if (isInternalClick) {
      isInternalClick = false;
      return;
    }
    controls().forEach((control) => control.handleDismissal(event));
    scheduleEvaluation();
  }

  function onKeyUp(event: KeyboardEvent): void {
    if (controls().some((control) => control.handleDismissal(event))) return;
    if (event.key === 'Shift' || event.key.startsWith('Arrow')) scheduleEvaluation();
  }

  function onStorageChanged(
    changes: Record<string, browser.Storage.StorageChange>,
    areaName: string,
  ): void {
    if ((areaName !== 'sync' && areaName !== 'local') || !changes[StorageKeys.LANGUAGE]) return;
    mounted.forEach(({ button }, { action }) => {
      const label = button.querySelector('span');
      if (label) label.textContent = action.label();
    });
    arrange();
    controls().forEach((control) => control.updateText());
  }

  // Mouseup waits for a finished drag; keyup also supports keyboard selections.
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('keyup', onKeyUp);
  browser.storage.onChanged.addListener(onStorageChanged);

  return {
    refresh() {
      if (stopped || !toolbar) return;
      syncMountedActions();
      if (!range) return;
      // A registration change keeps the saved range, even a zero-sized one.
      if (applyAvailability(range)) showToolbar();
      else hideToolbar();
    },
    markInternalClick() {
      isInternalClick = true;
    },
    restoreSelection() {
      const selection = window.getSelection();
      if (!range || !selection) return;
      selection.removeAllRanges();
      selection.addRange(range.cloneRange());
    },
    stop() {
      if (stopped) return;
      stopped = true;
      dropSelection();
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = null;
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keyup', onKeyUp);
      browser.storage.onChanged.removeListener(onStorageChanged);
      Array.from(mounted.keys()).forEach(unmountAction);
      toolbar?.remove();
      toolbar = null;
      style.remove();
    },
  };
}

/**
 * Start the page's one selection toolbar. Actions registered before or after it appear in it.
 * A second start retires the first; each stop only removes the nodes its own host created.
 */
export function startSelectionToolbarHost(): StopNativeFeature {
  activeHost?.stop();
  const host = createHost();
  activeHost = host;
  return () => {
    host.stop();
    if (activeHost === host) activeHost = null;
  };
}

/**
 * Add an action to the toolbar. A later registration with the same id replaces it; the returned
 * unregister is idempotent and only removes its own registration.
 */
export function registerSelectionAction(action: SelectionAction): () => void {
  const registration: Registration = { action };
  registry.set(action.id, registration);
  activeHost?.refresh();
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    // A retired owner's late unregister must not remove the action that replaced it.
    if (registry.get(action.id) !== registration) return;
    registry.delete(action.id);
    activeHost?.refresh();
  };
}

/** Keep the mouseup that ends a click on an action's own control from re-reading the selection. */
export function markSelectionToolbarInternalClick(): void {
  activeHost?.markInternalClick();
}

/** Put the toolbar's saved range back after a control (a native color input) took focus. */
export function restoreSelectionToolbarRange(): void {
  activeHost?.restoreSelection();
}
