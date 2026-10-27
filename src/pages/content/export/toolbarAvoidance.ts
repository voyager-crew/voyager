// Where the persistent export toolbar may sit without covering a host control.
// Known top-right clusters (Gemini, ChatGPT) are found by selector; every host
// also gets a hit-test of the toolbar's own row, so controls no selector knows
// about (Claude's header, its file preview panel) are avoided too.

export const DEFAULT_RIGHT_OFFSET_PX = 84;
/** Closest the toolbar may sit to a viewport edge. */
export const VIEWPORT_EDGE_PX = 6;
const TOP_RIGHT_GAP_PX = 12;
const TOP_RIGHT_MAX_Y_PX = 96;
const TOP_RIGHT_MIN_LEFT_RATIO = 0.45;
/** A hit wider than this share of the viewport is a region (a card, a panel), not a control. */
const MAX_CONTROL_WIDTH_RATIO = 0.5;
export const CANVAS_OWNER_SELECTOR = 'inline-preview, immersive-panel';
export const CANVAS_CONTENT_SELECTOR = 'immersive-editor, code-immersive-panel';
const CANVAS_STRUCTURE_SELECTOR = `${CANVAS_OWNER_SELECTOR}, ${CANVAS_CONTENT_SELECTOR}`;
/** Selectors specific to top-bar controls. */
const TOP_RIGHT_CONTROL_SELECTORS = [
  'top-bar-actions',
  '.top-bar-actions',
  '[data-test-id="top-bar-actions"]',
  'side-nav-sparkle-button',
  'side-nav-menu-button',
  '[data-test-id*="upgrade" i]',
  '[aria-label*="upgrade" i]',
  // ChatGPT conversation header: Share / more sit in the same top-right cluster.
  '#conversation-header-actions',
  '[data-testid="share-chat-button"]',
  '[data-testid="conversation-options-button"]',
].join(',');
/**
 * Broad substring selectors that also match per-message buttons such as
 * "Copy prompt". Tracking hidden matches of these would put every chat turn's
 * ancestry under watch, so only visible ones count, and never ones inside a
 * conversation turn.
 */
const TOP_RIGHT_BROAD_SELECTORS = ['[aria-label*="pro" i]', '[aria-label*="advanced" i]'].join(',');
const TOP_RIGHT_AVOIDANCE_SELECTORS = `${TOP_RIGHT_CONTROL_SELECTORS},${TOP_RIGHT_BROAD_SELECTORS}`;
/** Conversation turns on Gemini (Angular hosts) and ChatGPT (role attribute). */
const CONVERSATION_TURN_SELECTOR = 'user-query, model-response, [data-message-author-role]';
export const INTERACTIVE_SELECTOR = 'button, a[href], [role="button"]';
/** Voyager's own layers and full-page dialog overlays, which can sit above the host header. */
export const VOYAGER_SURFACE_SELECTOR = [
  '[data-gv-layer]',
  '.gv-export-dialog-overlay',
  '.gv-folder-dialog-overlay',
  '.gv-fi-overlay',
  '.gv-changelog-overlay',
  '.gv-chatgpt-handoff-overlay',
].join(',');
const ROW_PROBE_STEP_PX = 8;
/** Share of the viewport, both ways, past which a topmost layer is a backdrop rather than page content. */
const COVERING_RATIO = 0.9;
const MAX_ROW_SHIFTS = 6;

/** A spot the user dropped the toolbar on: px from the viewport's right edge and top. */
export type ToolbarSpot = { right: number; top: number };

export type AvoidanceContext = {
  /** Conversation turns, whose per-message controls are never avoided (see `turnSelectorFor`). */
  turnSelector: string;
  /** The user's spot; null docks the toolbar in the top-right control area. */
  spot: ToolbarSpot | null;
};

/**
 * The built-in turn selector plus the host's own. A site selector this
 * browser cannot parse falls back to the built-in. It must match messages
 * only: one that matched a header ancestor would put every header control
 * "inside a turn", switching avoidance off for that site.
 */
export function turnSelectorFor(siteTurnSelector?: string): string {
  if (!siteTurnSelector) return CONVERSATION_TURN_SELECTOR;
  const combined = `${CONVERSATION_TURN_SELECTOR}, ${siteTurnSelector}`;
  try {
    document.createDocumentFragment().querySelector(combined);
    return combined;
  } catch {
    return CONVERSATION_TURN_SELECTOR;
  }
}

/**
 * Left edge of a visible top-right control; `'host'` for a visible top-band
 * match spanning past the right-side cluster; `'hidden'` for a zero-size
 * top-bar control that an ancestor may reveal later; null when it should be
 * ignored.
 */
function classifyTopRightElement(
  element: Element,
  toolbarRoot: HTMLElement,
  turnSelector: string,
): number | 'host' | 'hidden' | null {
  if (!(element instanceof HTMLElement)) return null;
  if (element === toolbarRoot || toolbarRoot.contains(element)) return null;
  // A turn's visible "Copy prompt" scrolled into the top band is not a top-bar
  // control; avoiding it pushed the toolbar over the message text.
  if (element.closest(turnSelector)) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return element.matches(TOP_RIGHT_CONTROL_SELECTORS) ? 'hidden' : null;
  }
  if (rect.bottom <= 0 || rect.top >= TOP_RIGHT_MAX_Y_PX) return null;
  // Some Gemini top-bar hosts span the full viewport. Treating those as
  // right-side controls makes the computed offset enormous and pushes the
  // toolbar into the left rail, so only avoid elements whose own left edge is
  // already in the right-side control cluster.
  return rect.left >= window.innerWidth * TOP_RIGHT_MIN_LEFT_RATIO ? rect.left : 'host';
}

export type TopRightMeasurement = {
  offset: number;
  /** Where avoidance started: the dock's selector-based offset, or the user's spot. */
  anchor: number;
  canvas: HTMLElement[];
  /** Avoided controls plus full-width hosts whose children can push them left. */
  watched: HTMLElement[];
  /** Zero-size matches: kept out of the offset, but an ancestor can reveal them. */
  hidden: HTMLElement[];
  /**
   * What the row hit-test found under the toolbar, control or not. A width
   * change along their ancestry (a side panel opening) can move controls under it.
   */
  rowHosts: HTMLElement[];
  /** Host backdrops the hit-test found over controls: the offset is unusable while they stay. */
  occluders: HTMLElement[];
};

export function measureTopRightControls(
  toolbarRoot: HTMLElement,
  context: AvoidanceContext,
): TopRightMeasurement {
  const watched: HTMLElement[] = [];
  const hidden: HTMLElement[] = [];
  const canvas: HTMLElement[] = [];
  const rowHosts: HTMLElement[] = [];
  const occluders: HTMLElement[] = [];
  const row: RowProbe = { turnSelector: context.turnSelector, rowHosts, occluders };
  let leftMost: number | null = null;
  const selector = `${TOP_RIGHT_AVOIDANCE_SELECTORS},${CANVAS_CONTENT_SELECTOR}`;
  for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
    if (element.matches(CANVAS_CONTENT_SELECTOR)) {
      canvas.push(element);
      continue;
    }
    const left = classifyTopRightElement(element, toolbarRoot, context.turnSelector);
    if (left === null) continue;
    if (left === 'hidden') {
      hidden.push(element as HTMLElement);
      continue;
    }
    watched.push(element as HTMLElement);
    if (left !== 'host') leftMost = Math.min(leftMost ?? window.innerWidth, left);
  }
  if (context.spot) {
    const anchor = clampRight(context.spot.right, toolbarRoot.getBoundingClientRect().width);
    const offset = findFreeRight(toolbarRoot, anchor, watched, row);
    return { offset, anchor, watched, hidden, canvas, rowHosts, occluders };
  }
  const anchor =
    leftMost === null
      ? DEFAULT_RIGHT_OFFSET_PX
      : Math.max(
          DEFAULT_RIGHT_OFFSET_PX,
          Math.ceil(window.innerWidth - leftMost + TOP_RIGHT_GAP_PX),
        );
  return {
    offset: avoidControlsInRow(toolbarRoot, anchor, watched, row),
    anchor,
    watched,
    hidden,
    canvas,
    rowHosts,
    occluders,
  };
}

type RowProbe = {
  turnSelector: string;
  /** Collects the first topmost element of each probe pass. */
  rowHosts: HTMLElement[];
  /** Collects backdrops found covering a control. */
  occluders: HTMLElement[];
};

/** What a hit-test at one point sees, topmost first, without Voyager's own layers. */
export function hostStackAt(toolbarRoot: HTMLElement, x: number, y: number): Element[] {
  return document
    .elementsFromPoint(x, y)
    .filter(
      (element) => !toolbarRoot.contains(element) && !element.closest(VOYAGER_SURFACE_SELECTOR),
    );
}

/**
 * The topmost element of `stack` when it is a full-viewport, non-interactive
 * layer with a control painted under it: a host backdrop. A page whose own
 * shell is topmost there has no control under it, so it never counts.
 */
export function coveringLayer(stack: readonly Element[]): HTMLElement | null {
  const topmost = stack[0];
  if (
    !(topmost instanceof HTMLElement) ||
    topmost === document.body ||
    topmost === document.documentElement ||
    topmost.closest(INTERACTIVE_SELECTOR)
  ) {
    return null;
  }
  const rect = topmost.getBoundingClientRect();
  if (
    rect.width < window.innerWidth * COVERING_RATIO ||
    rect.height < window.innerHeight * COVERING_RATIO
  ) {
    return null;
  }
  const coversControl = stack.slice(1).some((element) => {
    const control = element.closest(INTERACTIVE_SELECTOR);
    return control !== null && !control.contains(topmost);
  });
  return coversControl ? topmost : null;
}

// Host markup changes without notice, so also hit-test the toolbar's own row
// for controls the selector list does not know about.
function findControlUnderToolbar(
  toolbarRoot: HTMLElement,
  right: number,
  { turnSelector, rowHosts, occluders }: RowProbe,
): HTMLElement | null {
  if (typeof document.elementsFromPoint !== 'function') return null;
  const rect = toolbarRoot.getBoundingClientRect();
  const y = rect.top + rect.height / 2;
  const end = window.innerWidth - right;
  for (let x = end - 1; x > end - rect.width; x -= ROW_PROBE_STEP_PX) {
    // Voyager's export dialog overlay is topmost over the whole header; taking it
    // for "nothing here" dropped the offset to the default, right over Share.
    const stack = hostStackAt(toolbarRoot, x, y);
    const topmost = stack[0];
    // A host's own backdrop does the same; the caller keeps its last offset.
    const layer = coveringLayer(stack);
    if (layer) {
      if (!occluders.includes(layer)) occluders.push(layer);
      continue;
    }
    // A turn under the toolbar widens while a reply streams; watching its width
    // would re-measure every frame (#1040).
    if (x === end - 1 && topmost instanceof HTMLElement && !topmost.closest(turnSelector)) {
      rowHosts.push(topmost);
    }
    const control = topmost?.closest<HTMLElement>(INTERACTIVE_SELECTOR);
    if (!control || control.closest(turnSelector)) continue;
    if (control.getBoundingClientRect().width > window.innerWidth * MAX_CONTROL_WIDTH_RATIO) {
      continue;
    }
    return control;
  }
  return null;
}

/** The docked toolbar only moves left: it belongs beside the host's right-side cluster. */
function avoidControlsInRow(
  toolbarRoot: HTMLElement,
  initialRight: number,
  watched: HTMLElement[],
  row: RowProbe,
): number {
  let right = initialRight;
  for (let i = 0; i < MAX_ROW_SHIFTS; i++) {
    const control = findControlUnderToolbar(toolbarRoot, right, row);
    if (!control) break;
    const left = control.getBoundingClientRect().left;
    if (left < window.innerWidth * TOP_RIGHT_MIN_LEFT_RATIO) break;
    watched.push(control);
    right = Math.ceil(window.innerWidth - left + TOP_RIGHT_GAP_PX);
  }
  return right;
}

/** The right offset that keeps a toolbar of `width` inside the viewport. */
export function clampRight(right: number, width: number): number {
  const max = Math.max(VIEWPORT_EDGE_PX, window.innerWidth - width - VIEWPORT_EDGE_PX);
  return Math.round(Math.min(Math.max(right, VIEWPORT_EDGE_PX), max));
}

/** The top that keeps a toolbar of `height` inside the viewport. */
export function clampTop(top: number, height: number): number {
  const max = Math.max(VIEWPORT_EDGE_PX, window.innerHeight - height - VIEWPORT_EDGE_PX);
  return Math.round(Math.min(Math.max(top, VIEWPORT_EDGE_PX), max));
}

/** Steps past controls in one direction; null when it leaves the viewport or never clears. */
function shiftUntilFree(
  toolbarRoot: HTMLElement,
  start: number,
  direction: 'left' | 'right',
  row: RowProbe,
  found: HTMLElement[],
): number | null {
  const width = toolbarRoot.getBoundingClientRect().width;
  let right = start;
  for (let i = 0; i <= MAX_ROW_SHIFTS; i++) {
    const control = findControlUnderToolbar(toolbarRoot, right, row);
    if (!control) return right;
    found.push(control);
    const rect = control.getBoundingClientRect();
    right =
      direction === 'left'
        ? Math.ceil(window.innerWidth - rect.left + TOP_RIGHT_GAP_PX)
        : Math.floor(window.innerWidth - rect.right - TOP_RIGHT_GAP_PX - width);
    if (right !== clampRight(right, width)) return null;
  }
  return null;
}

/**
 * A user's spot moves to the nearest free place in its row, on either side of
 * whatever control it landed on; it stays put when neither side has room.
 */
function findFreeRight(
  toolbarRoot: HTMLElement,
  desired: number,
  watched: HTMLElement[],
  row: RowProbe,
): number {
  const start = desired;
  if (!findControlUnderToolbar(toolbarRoot, start, row)) return start;
  const found: HTMLElement[] = [];
  const candidates = [
    shiftUntilFree(toolbarRoot, start, 'left', row, found),
    shiftUntilFree(toolbarRoot, start, 'right', row, found),
  ].filter((candidate): candidate is number => candidate !== null);
  watched.push(...found);
  if (candidates.length === 0) return start;
  return candidates.reduce((best, next) =>
    Math.abs(next - start) < Math.abs(best - start) ? next : best,
  );
}

/** Top-right controls and Canvas content from the last update, for filtering mutations. */
export type MeasuredControls = {
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

/**
 * `occluders` are host layers covering the toolbar's row (a modal backdrop,
 * or body while a menu locks page pointer events): changing or removing one
 * ends the occlusion, so they count like watched controls' ancestry.
 */
export function indexMeasuredControls(
  watched: readonly HTMLElement[],
  hidden: readonly HTMLElement[] = [],
  canvas: readonly HTMLElement[] = [],
  occluders: readonly HTMLElement[] = [],
): MeasuredControls {
  return {
    watched: new Set(watched),
    watchedAndAncestors: collectWithAncestors([...watched, ...occluders]),
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

function isInsideTurn(node: Node, turnSelector: string): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest(turnSelector) != null;
}

function addsControlOutsideTurns(node: Node, turnSelector: string): boolean {
  if (!(node instanceof Element) || node.matches(turnSelector)) return false;
  if (node.matches(INTERACTIVE_SELECTOR)) return true;
  for (const control of Array.from(node.querySelectorAll(INTERACTIVE_SELECTOR))) {
    if (!control.closest(turnSelector)) return true;
  }
  return false;
}

/**
 * `hard`: a known control or Canvas changed, re-measure on the next frame.
 * `soft`: an unlabeled control appeared outside any turn and may sit under the
 * row hit-test; the caller rate-limits these. `none`: nothing the toolbar avoids.
 */
export type AvoidanceTrigger = 'none' | 'soft' | 'hard';

/**
 * Whether a mutation batch can change the controls the toolbar avoids. Gemini
 * streams sidebar rows and responses under `body`; re-querying the whole
 * document and reading every match's rect for those forced layout on each
 * frame (#1040). Selector and identity checks only — never geometry.
 */
export function classifyAvoidanceMutations(
  mutations: readonly MutationRecord[],
  toolbarRoot: HTMLElement,
  measured: MeasuredControls,
  turnSelector: string,
): AvoidanceTrigger {
  // Let the next update notice the detached toolbar and tear itself down.
  if (!toolbarRoot.isConnected) return 'hard';
  let trigger: AvoidanceTrigger = 'none';
  for (const mutation of mutations) {
    const target = mutation.target;
    // The toolbar's own offset writes and label updates.
    if (toolbarRoot.contains(target)) continue;
    if (mutation.type === 'attributes') {
      if (measured.watchedAndAncestors.has(target)) return 'hard';
      if (measured.hiddenAndAncestors.has(target)) return 'hard';
      if (measured.canvasAndAncestors.has(target)) return 'hard';
      if (isInsideWatchedElement(target, measured)) return 'hard';
      if (target instanceof Element && target.matches(TOP_RIGHT_AVOIDANCE_SELECTORS)) return 'hard';
      continue;
    }
    if (isInsideWatchedElement(target, measured)) return 'hard';
    // Neither measurement counts a control inside a turn, so a reply streaming
    // its text and per-message buttons cannot move the toolbar.
    const inTurn = isInsideTurn(target, turnSelector);
    for (const node of Array.from(mutation.addedNodes)) {
      if (containsMatch(node, CANVAS_STRUCTURE_SELECTOR)) return 'hard';
      if (inTurn) continue;
      if (containsMatch(node, TOP_RIGHT_AVOIDANCE_SELECTORS)) return 'hard';
      if (trigger === 'none' && addsControlOutsideTurns(node, turnSelector)) trigger = 'soft';
    }
    for (const node of Array.from(mutation.removedNodes)) {
      if (measured.watchedAndAncestors.has(node)) return 'hard';
      if (containsMatch(node, CANVAS_STRUCTURE_SELECTOR)) return 'hard';
    }
  }
  return trigger;
}
