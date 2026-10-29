/**
 * Voyager's toasts. One module-level host owns every open toast of this script
 * instance, so all owners share one stack at the bottom-end corner (clear of the
 * timeline rail, the prompt manager trigger and the research pack launcher), one
 * eviction rule and one z-index. Owners hold a `Toaster`, which scopes
 * channels, an anchor and cleanup.
 */
import { type LayerHost, mountLayerHost } from '../layer';
import toastCss from './toast.css?raw';
import type { ToastHandle, ToastInput, ToastPatch, Toaster } from './types';
import { type ToastView, createToastView } from './view';

/** Older toasts that will close on their own make way beyond this many. */
const MAX_TRANSIENT = 4;
/** How often anchored toasts follow their anchor, and notice it went stale or left. */
const ANCHOR_RECHECK_MS = 500;
const ANCHOR_GAP = 14;
const ANCHOR_PADDING = 12;
const ESTIMATED_TOAST_HEIGHT = 52;

type OwnerState = {
  anchor: { element: HTMLElement; until: number } | null;
  region: HTMLElement | null;
  recheck: number | null;
};

type ToastRecord = {
  readonly owner: OwnerState;
  readonly view: ToastView;
  readonly handle: ToastHandle;
  input: ToastInput;
  timer: number | null;
  /** Time left to show, and when the running countdown started. */
  remaining: number | null;
  startedAt: number;
  /** The pointer is over the toast, or focus is inside it. */
  engaged: { pointer: boolean; focus: boolean };
};

let layer: { mount: LayerHost; stack: HTMLElement } | null = null;
let records: ToastRecord[] = [];

// After an extension update the orphaned script keeps running beside the
// re-injected one, so each instance mounts its own host and never touches
// another's: removing a live host would drop its toasts without telling it.
function ensureLayer(): { mount: LayerHost; stack: HTMLElement } {
  if (layer?.mount.host.isConnected) return layer;
  // Toasts whose host left the page are already invisible; let them go.
  for (const record of records) closeRecord(record);
  records = [];
  layer?.mount.remove();
  const mount = mountLayerHost('toast', toastCss);
  const stack = document.createElement('div');
  stack.className = 'gv-toast-stack';
  mount.root.append(stack);
  layer = { mount, stack };
  return layer;
}

function closeRecord(record: ToastRecord): void {
  if (record.timer !== null) window.clearTimeout(record.timer);
  record.timer = null;
  record.view.element.remove();
}

/** A `pauseOnHover` toast the person is on waits for them. */
function isHeld(record: ToastRecord): boolean {
  return record.input.pauseOnHover === true && (record.engaged.pointer || record.engaged.focus);
}

function isEvictable(record: ToastRecord): boolean {
  return record.input.durationMs !== null && record.input.pending !== true && !isHeld(record);
}

function anchorRect(owner: OwnerState): DOMRect | null {
  const anchor = owner.anchor;
  if (!anchor || !anchor.element.isConnected || Date.now() > anchor.until) return null;
  const rect = anchor.element.getBoundingClientRect();
  // A hidden anchor measures 0×0 at the viewport origin.
  return rect.width > 0 || rect.height > 0 ? rect : null;
}

function stopRecheck(owner: OwnerState): void {
  if (owner.recheck !== null) window.clearTimeout(owner.recheck);
  owner.recheck = null;
}

/** Put the owner's toasts beside its anchor while it is fresh, otherwise in the shared stack. */
function placeOwner(owner: OwnerState): void {
  if (!layer) return;
  const own = records.filter((record) => record.owner === owner);
  const rect = own.length > 0 ? anchorRect(owner) : null;
  stopRecheck(owner);
  if (!rect) {
    for (const record of own) {
      if (record.view.element.parentElement !== layer.stack)
        layer.stack.append(record.view.element);
    }
    owner.region?.remove();
    owner.region = null;
    return;
  }

  if (!owner.region || !owner.region.isConnected) {
    owner.region = document.createElement('div');
    owner.region.className = 'gv-toast-anchored';
    layer.mount.root.append(owner.region);
  }
  const region = owner.region;
  for (const record of own) {
    if (record.view.element.parentElement !== region) region.append(record.view.element);
  }

  const box = region.getBoundingClientRect();
  const width = box.width || 300;
  const height =
    box.height ||
    Math.max(ESTIMATED_TOAST_HEIGHT, own.length * ESTIMATED_TOAST_HEIGHT + (own.length - 1) * 10);
  let left = rect.right + ANCHOR_GAP;
  if (left + width + ANCHOR_PADDING > window.innerWidth) left = rect.left - ANCHOR_GAP - width;
  left = Math.max(ANCHOR_PADDING, Math.min(left, window.innerWidth - width - ANCHOR_PADDING));
  let top = rect.top + rect.height / 2 - height / 2;
  top = Math.max(ANCHOR_PADDING, Math.min(top, window.innerHeight - height - ANCHOR_PADDING));
  region.style.left = `${left}px`;
  region.style.top = `${top}px`;
  const untilStale = (owner.anchor?.until ?? 0) - Date.now() + 1;
  owner.recheck = window.setTimeout(
    () => {
      owner.recheck = null;
      placeOwner(owner);
    },
    Math.max(1, Math.min(ANCHOR_RECHECK_MS, untilStale)),
  );
}

function remove(record: ToastRecord): void {
  const index = records.indexOf(record);
  if (index === -1) return;
  records.splice(index, 1);
  closeRecord(record);
  placeOwner(record.owner);
  if (records.length === 0 && layer) {
    layer.mount.remove();
    layer = null;
  }
}

/** Counts down the time left, unless the toast is held. */
function runTimer(record: ToastRecord): void {
  if (record.timer !== null) window.clearTimeout(record.timer);
  record.timer = null;
  if (record.remaining === null || isHeld(record)) return;
  record.startedAt = Date.now();
  record.timer = window.setTimeout(() => remove(record), record.remaining);
}

function startTimer(record: ToastRecord): void {
  record.remaining = record.input.durationMs;
  runTimer(record);
}

function holdTimer(record: ToastRecord): void {
  if (record.timer === null || !isHeld(record) || record.remaining === null) return;
  record.remaining = Math.max(0, record.remaining - (Date.now() - record.startedAt));
  window.clearTimeout(record.timer);
  record.timer = null;
}

/** Hover and focus hold a `pauseOnHover` toast; the listeners leave with its element. */
function watchEngagement(record: ToastRecord): void {
  const element = record.view.element;
  const engage = (kind: 'pointer' | 'focus', engaged: boolean) => {
    record.engaged[kind] = engaged;
    if (engaged) holdTimer(record);
    else if (record.timer === null && records.includes(record)) runTimer(record);
  };
  element.addEventListener('pointerenter', () => engage('pointer', true));
  element.addEventListener('pointerleave', () => engage('pointer', false));
  element.addEventListener('focusin', () => engage('focus', true));
  element.addEventListener('focusout', (event) => {
    if (event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) return;
    engage('focus', false);
  });
}

function open(owner: OwnerState, input: ToastInput): ToastRecord {
  ensureLayer();
  let record: ToastRecord;
  const view = createToastView({
    onAction: () => record.input.action?.run(record.handle),
    onDismiss: () => {
      remove(record);
      record.input.onDismiss?.();
    },
    onActivate: input.onActivate
      ? () => {
          remove(record);
          record.input.onActivate?.();
        }
      : undefined,
  });
  const handle: ToastHandle = {
    get isOpen() {
      return records.includes(record);
    },
    update(patch: ToastPatch) {
      if (!records.includes(record)) return;
      record.input = { ...record.input, ...patch };
      record.view.apply(record.input);
      if ('durationMs' in patch) startTimer(record);
      placeOwner(owner);
    },
    dismiss: () => remove(record),
  };
  record = {
    owner,
    view,
    handle,
    input,
    timer: null,
    remaining: null,
    startedAt: 0,
    engaged: { pointer: false, focus: false },
  };
  view.apply(input);
  records.push(record);
  watchEngagement(record);
  startTimer(record);
  placeOwner(owner);

  const transient = records.filter(isEvictable);
  if (transient.length > MAX_TRANSIENT) remove(transient[0]);
  return record;
}

export function createToaster(): Toaster {
  const owner: OwnerState = { anchor: null, region: null, recheck: null };
  let destroyed = false;
  const own = () => records.filter((record) => record.owner === owner);
  const closed: ToastHandle = { isOpen: false, update: () => {}, dismiss: () => {} };

  const clear = (): void => {
    owner.anchor = null;
    stopRecheck(owner);
    for (const record of own()) remove(record);
    owner.region?.remove();
    owner.region = null;
  };

  return {
    show(input) {
      if (destroyed) return closed;
      // Once the page dropped the host, its toasts are gone: open a fresh one.
      const existing =
        input.channel && layer?.mount.host.isConnected
          ? own().find((record) => record.input.channel === input.channel)
          : undefined;
      if (existing) {
        existing.input = input;
        existing.view.apply(input);
        startTimer(existing);
        placeOwner(owner);
        return existing.handle;
      }
      return open(owner, input).handle;
    },
    dismiss(channel) {
      for (const record of own()) if (record.input.channel === channel) remove(record);
    },
    setAnchor(element, ttlMs) {
      if (destroyed) return;
      owner.anchor = { element, until: Date.now() + ttlMs };
      placeOwner(owner);
    },
    clear,
    destroy() {
      clear();
      destroyed = true;
    },
  };
}
