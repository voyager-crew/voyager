// Persistent top-right export toolbar.
// Mounted as a fallback when Gemini's logo (the usual injection point for the
// inline export dropdown) is absent — e.g. after the lr26 UI refresh removed
// [data-test-id="logo"]. Calls back into showExportDialog when clicked.
import { createDownloadIcon } from '@/core/icons/promptManagerIcons';

import {
  exportLayoutData,
  exportToolbarMutationControls,
  resolveExportToolbarControls,
} from './toolbarTargets';

export type PersistentExportToolbarOptions = {
  label: string;
  tooltip: string;
  onClick: () => void;
};

const TOOLBAR_CLASS = 'gv-persistent-export-toolbar';
const BUTTON_CLASS = 'gv-persistent-export-btn';
const ICON_CLASS = 'gv-persistent-export-icon';
const LABEL_CLASS = 'gv-persistent-export-label';
const HIDDEN_CLASS = 'gv-hidden';
const DEFAULT_RIGHT_OFFSET_PX = 84;
const TOP_RIGHT_GAP_PX = 12;
const TOP_RIGHT_MAX_Y_PX = 96;
const TOP_RIGHT_MIN_LEFT_RATIO = 0.45;
/** Voyager's own layers and full-page dialog overlays, which can sit above the host header. */
const VOYAGER_SURFACE_SELECTOR = [
  '[data-gv-layer]',
  '.gv-export-dialog-overlay',
  '.gv-folder-dialog-overlay',
  '.gv-fi-overlay',
  '.gv-changelog-overlay',
  '.gv-chatgpt-handoff-overlay',
].join(',');
const ROW_PROBE_STEP_PX = 8;
const MAX_ROW_SHIFTS = 4;

type OwnedToolbarRoot = HTMLDivElement & { _gvOwner?: symbol };
type ToolbarButton = HTMLButtonElement & { _gvOnClick?: () => void };

let activeAvoidanceRoot: HTMLDivElement | null = null;
let activeAvoidanceCleanup: (() => void) | null = null;

const RIGHT_OFFSET_PROPERTY = '--gv-persistent-export-right';

/**
 * Left edge of a visible top-right control; `'host'` for a visible top-band
 * match spanning past the right-side cluster; `'hidden'` for a zero-size
 * top-bar control that an ancestor may reveal later; null when it should be
 * ignored.
 */
function classifyTopRightElement(
  element: Element,
  toolbarRoot: HTMLElement,
  controlSelector: string,
): number | 'host' | 'hidden' | null {
  if (!(element instanceof HTMLElement)) return null;
  if (element === toolbarRoot || toolbarRoot.contains(element)) return null;
  // A turn's visible "Copy prompt" scrolled into the top band is not a top-bar
  // control; avoiding it pushed the toolbar over the message text.
  if (element.closest(exportLayoutData(toolbarRoot).turns)) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return element.matches(controlSelector) ? 'hidden' : null;
  }
  if (rect.bottom <= 0 || rect.top >= TOP_RIGHT_MAX_Y_PX) return null;
  // Some Gemini top-bar hosts span the full viewport. Treating those as
  // right-side controls makes the computed offset enormous and pushes the
  // toolbar into the left rail, so only avoid elements whose own left edge is
  // already in the right-side control cluster.
  return rect.left >= window.innerWidth * TOP_RIGHT_MIN_LEFT_RATIO ? rect.left : 'host';
}

type TopRightMeasurement = {
  offset: number;
  canvas: HTMLElement[];
  /** Avoided controls plus full-width hosts whose children can push them left. */
  watched: HTMLElement[];
  /** Zero-size matches: kept out of the offset, but an ancestor can reveal them. */
  hidden: HTMLElement[];
};

function measureTopRightControls(toolbarRoot: HTMLElement): TopRightMeasurement {
  const watched: HTMLElement[] = [];
  const hidden: HTMLElement[] = [];
  const canvas: HTMLElement[] = [];
  let leftMost: number | null = null;
  const { selector: controls } = resolveExportToolbarControls(toolbarRoot);
  const layout = exportLayoutData(toolbarRoot);
  const selector = `${controls},${layout.broadControls.join(',')},${layout.canvasContent}`;
  for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
    if (element.matches(layout.canvasContent)) {
      canvas.push(element);
      continue;
    }
    const left = classifyTopRightElement(element, toolbarRoot, controls);
    if (left === null) continue;
    if (left === 'hidden') {
      hidden.push(element as HTMLElement);
      continue;
    }
    watched.push(element as HTMLElement);
    if (left !== 'host') leftMost = Math.min(leftMost ?? window.innerWidth, left);
  }
  const offset =
    leftMost === null
      ? DEFAULT_RIGHT_OFFSET_PX
      : Math.max(
          DEFAULT_RIGHT_OFFSET_PX,
          Math.ceil(window.innerWidth - leftMost + TOP_RIGHT_GAP_PX),
        );
  if (!usesRowAvoidance(toolbarRoot)) return { offset, watched, hidden, canvas };
  return { offset: avoidControlsInRow(toolbarRoot, offset, watched), watched, hidden, canvas };
}

function usesRowAvoidance(toolbarRoot: HTMLElement): boolean {
  return exportLayoutData(toolbarRoot).avoidRow;
}

// Host markup changes without notice, so also hit-test the toolbar's own row
// for controls the selector list does not know about.
function findControlUnderToolbar(toolbarRoot: HTMLElement, right: number): HTMLElement | null {
  if (typeof document.elementsFromPoint !== 'function') return null;
  const rect = toolbarRoot.getBoundingClientRect();
  const y = rect.top + rect.height / 2;
  const end = window.innerWidth - right;
  for (let x = end - 1; x > end - rect.width; x -= ROW_PROBE_STEP_PX) {
    // Voyager's export dialog overlay is topmost over the whole header; taking it
    // for "nothing here" dropped the offset to the default, right over Share.
    const topmost = document
      .elementsFromPoint(x, y)
      .find(
        (element) => !toolbarRoot.contains(element) && !element.closest(VOYAGER_SURFACE_SELECTOR),
      );
    const control = topmost?.closest<HTMLElement>(exportLayoutData(toolbarRoot).interactive);
    if (control) return control;
  }
  return null;
}

function avoidControlsInRow(
  toolbarRoot: HTMLElement,
  initialRight: number,
  watched: HTMLElement[],
): number {
  let right = initialRight;
  for (let i = 0; i < MAX_ROW_SHIFTS; i++) {
    const control = findControlUnderToolbar(toolbarRoot, right);
    if (!control) break;
    const left = control.getBoundingClientRect().left;
    if (left < window.innerWidth * TOP_RIGHT_MIN_LEFT_RATIO) break;
    watched.push(control);
    right = Math.ceil(window.innerWidth - left + TOP_RIGHT_GAP_PX);
  }
  return right;
}

/** Top-right controls and Canvas content from the last update, for filtering mutations. */
type MeasuredControls = {
  watched: ReadonlySet<Element>;
  /** Every watched element plus its ancestors: attribute changes there can hide or move it. */
  watchedAndAncestors: ReadonlySet<Node>;
  /** Every hidden match plus its ancestors: attribute changes there can reveal it. */
  hiddenAndAncestors: ReadonlySet<Node>;
  canvasAndAncestors: ReadonlySet<Node>;
};

function collectWithAncestors(elements: readonly HTMLElement[]): Set<Node> {
  const nodes = new Set<Node>();
  for (const element of elements) {
    for (let node: Node | null = element; node; node = node.parentNode) {
      if (nodes.has(node)) break;
      nodes.add(node);
    }
  }
  return nodes;
}

function indexMeasuredControls(
  watched: readonly HTMLElement[],
  hidden: readonly HTMLElement[] = [],
  canvas: readonly HTMLElement[] = [],
): MeasuredControls {
  return {
    watched: new Set(watched),
    watchedAndAncestors: collectWithAncestors(watched),
    hiddenAndAncestors: collectWithAncestors(hidden),
    canvasAndAncestors: collectWithAncestors(canvas),
  };
}

function isInsideWatchedElement(node: Node, measured: MeasuredControls): boolean {
  for (let el = node instanceof Element ? node : node.parentElement; el; el = el.parentElement) {
    if (measured.watched.has(el)) return true;
  }
  return false;
}

function containsMatch(node: Node, selector: string): boolean {
  return (
    node instanceof Element && (node.matches(selector) || node.querySelector(selector) !== null)
  );
}

/**
 * Whether a mutation batch can change the top-right controls the toolbar
 * avoids. Gemini streams sidebar rows and responses under `body`; re-querying
 * the whole document and reading every match's rect for those forced layout on
 * each frame (#1040). Selector and identity checks only — never geometry.
 */
function mutationsMayMoveTopRightControls(
  mutations: readonly MutationRecord[],
  toolbarRoot: HTMLElement,
  measured: MeasuredControls,
): boolean {
  // Let the next update notice the detached toolbar and tear itself down.
  if (!toolbarRoot.isConnected) return true;
  // Row avoidance hit-tests unlabeled controls, so any new one may land under the toolbar.
  const layout = exportLayoutData(toolbarRoot);
  const canvasStructure = `${layout.canvasOwner}, ${layout.canvasContent}`;
  const avoidanceSelector = `${exportToolbarMutationControls(toolbarRoot)},${layout.broadControls.join(',')}`;
  const addedSelector = usesRowAvoidance(toolbarRoot)
    ? `${avoidanceSelector},${canvasStructure},${layout.interactive}`
    : `${avoidanceSelector},${canvasStructure}`;
  for (const mutation of mutations) {
    const target = mutation.target;
    // The toolbar's own offset writes and label updates.
    if (toolbarRoot.contains(target)) continue;
    if (mutation.type === 'attributes') {
      if (measured.watchedAndAncestors.has(target)) return true;
      if (measured.hiddenAndAncestors.has(target)) return true;
      if (measured.canvasAndAncestors.has(target)) return true;
      if (isInsideWatchedElement(target, measured)) return true;
      if (target instanceof Element && target.matches(avoidanceSelector)) return true;
      continue;
    }
    if (isInsideWatchedElement(target, measured)) return true;
    for (const node of Array.from(mutation.addedNodes)) {
      if (containsMatch(node, addedSelector)) return true;
    }
    for (const node of Array.from(mutation.removedNodes)) {
      if (measured.watchedAndAncestors.has(node)) return true;
      if (containsMatch(node, canvasStructure)) return true;
    }
  }
  return false;
}

function installToolbarAvoidance(root: HTMLDivElement): void {
  if (activeAvoidanceRoot === root) return;
  activeAvoidanceCleanup?.();
  activeAvoidanceRoot = root;

  let frameId: number | null = null;
  let measured = indexMeasuredControls([]);
  let appliedOffset = root.style.getPropertyValue(RIGHT_OFFSET_PROPERTY);
  const update = () => {
    frameId = null;
    if (!root.isConnected) {
      activeAvoidanceCleanup?.();
      return;
    }
    const { offset, watched, hidden, canvas } = measureTopRightControls(root);
    const layout = exportLayoutData(root);
    // Fullscreen Canvas puts Collapse under this pill; its own Export menu remains available.
    root.classList.toggle(
      HIDDEN_CLASS,
      canvas.some(
        (editor) =>
          editor.closest(layout.canvasOwner)?.matches(layout.fullscreenCanvas) &&
          !editor.closest(layout.inactiveCanvas),
      ),
    );
    measured = indexMeasuredControls(watched, hidden, canvas);
    const next = `${offset}px`;
    if (next === appliedOffset) return;
    appliedOffset = next;
    root.style.setProperty(RIGHT_OFFSET_PROPERTY, next);
  };
  const scheduleUpdate = () => {
    if (frameId !== null) return;
    frameId = window.requestAnimationFrame(update);
  };

  const observer = new MutationObserver((mutations) => {
    if (frameId !== null) return;
    if (mutationsMayMoveTopRightControls(mutations, root, measured)) scheduleUpdate();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-hidden', 'class', 'hidden', 'style'],
  });
  window.addEventListener('resize', scheduleUpdate);
  scheduleUpdate();

  activeAvoidanceCleanup = () => {
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId);
      frameId = null;
    }
    observer.disconnect();
    window.removeEventListener('resize', scheduleUpdate);
    if (activeAvoidanceRoot === root) {
      activeAvoidanceRoot = null;
      activeAvoidanceCleanup = null;
    }
  };
}

function removeToolbarRoot(root: HTMLDivElement): void {
  if (activeAvoidanceRoot === root) activeAvoidanceCleanup?.();
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
    installToolbarAvoidance(existing);
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
  installToolbarAvoidance(root);

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
