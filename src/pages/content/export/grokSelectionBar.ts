/**
 * Grok-only placement for the export selection bar.
 *
 * The shared bar is `position: fixed; top: 12px`, which sits on Grok's
 * conversation title and on the first message under it. Both landmarks and the
 * site id live in site.json. When this page is that site, the bar is inserted
 * after the title's block and before the transcript, so it takes its own row
 * instead of covering either.
 */
import grokSite from '@/features/plugins/catalog/sites/grok/site.json';

const TITLE_SELECTOR = grokSite.export.title;
const SCROLLER_SELECTOR = grokSite.selectors.scrollContainer;
const DOCKED_CLASS = 'gv-export-select-bar--docked';
const ROOM_CLASS = 'gv-export-msg-room';
/** Gap under a title we could not dock beneath. */
const TITLE_CLEARANCE_PX = 8;
/** `.gv-export-msg-checkbox` width plus the 8px gap used beside a bubble. */
const CHECKBOX_OUTSET_PX = 28;
/** Inset used when a checkbox left of the bubble would be clipped. */
const CLIPPED_INSET_PX = 8;
const SELECTOR_CLASS = 'gv-export-msg-selector';
/** An inset child counts as the bubble only when the row has real empty space beside it. */
const BUBBLE_INSET_PX = 32;

function onGrokPage(): boolean {
  return document.documentElement.dataset.gvPlatform === grokSite.id;
}

function clearPin(bar: HTMLElement): void {
  bar.style.removeProperty('left');
  bar.style.removeProperty('right');
  bar.style.removeProperty('top');
  bar.style.removeProperty('transform');
}

/**
 * The title's block that does not contain the transcript: its parent does.
 * Inserting after that block puts the bar under the title and above the messages.
 */
function blockAboveTranscript(title: Element, scroller: Element): HTMLElement | null {
  let node: HTMLElement | null = title instanceof HTMLElement ? title : title.parentElement;
  while (node) {
    const parent = node.parentElement;
    if (!parent) return null;
    if (parent.contains(scroller) && !node.contains(scroller)) return node;
    if (node === document.body || node === document.documentElement) return null;
    node = parent;
  }
  return null;
}

function visualBubble(host: HTMLElement, hostRect: DOMRect): DOMRect {
  const boxes = [...host.children].flatMap((child) => {
    if (!(child instanceof HTMLElement) || child.classList.contains(SELECTOR_CLASS)) return [];
    const rect = child.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? [rect] : [];
  });
  if (boxes.length !== 1) return hostRect;
  const box = boxes[0];
  const inset = box.left - hostRect.left;
  const slack = hostRect.width - box.width;
  if (inset >= BUBBLE_INSET_PX && slack >= BUBBLE_INSET_PX) return box;
  return hostRect;
}

/**
 * Checkbox position relative to the message host, just left of the bubble.
 * A right-aligned Grok bubble must not share the assistant column's far-left gutter.
 */
function grokCheckboxPosition(host: HTMLElement): { left: number; top: number } {
  const hostRect = host.getBoundingClientRect();
  const bubble = visualBubble(host, hostRect);
  return {
    left: Math.round(bubble.left - hostRect.left) - CHECKBOX_OUTSET_PX,
    top: Math.max(6, Math.round(bubble.top - hostRect.top) + 6),
  };
}

export interface GrokCheckboxHost {
  readonly host: HTMLElement;
  readonly selector: HTMLElement;
}

/**
 * Sit each Grok checkbox on its own bubble. The shared column lands in the blank
 * space left of a right-aligned user bubble. Returns false on every other site.
 */
export function placeGrokCheckboxes(
  placed: readonly GrokCheckboxHost[],
  root: HTMLElement,
  clipsColumn: (hosts: readonly HTMLElement[], root: HTMLElement, columnLeft: number) => boolean,
): boolean {
  if (!onGrokPage()) return false;
  for (const { host, selector } of placed) {
    const hostRect = host.getBoundingClientRect();
    const position = grokCheckboxPosition(host);
    const clipped = position.left < 0 && clipsColumn([host], root, hostRect.left + position.left);
    selector.style.left = `${clipped ? CLIPPED_INSET_PX : position.left}px`;
    selector.style.top = `${position.top}px`;
    const needsRoom = clipped;
    if (host.classList.contains(ROOM_CLASS) !== needsRoom) {
      host.classList.toggle(ROOM_CLASS, needsRoom);
    }
  }
  return true;
}

/**
 * Move the selection bar under Grok's title. Returns a cleanup, or null when
 * this page is not Grok (the shared fixed bar stays where it is).
 */
export function dockGrokSelectionBar(bar: HTMLElement): (() => void) | null {
  if (!onGrokPage()) return null;
  const title = document.querySelector(TITLE_SELECTOR);
  const scroller = document.querySelector(SCROLLER_SELECTOR);
  if (title && scroller) {
    const header = blockAboveTranscript(title, scroller);
    const parent = header?.parentElement;
    if (header && parent) {
      parent.insertBefore(bar, header.nextSibling);
      bar.classList.add(DOCKED_CLASS);
      clearPin(bar);
      return () => {
        bar.classList.remove(DOCKED_CLASS);
      };
    }
  }
  if (!title) return null;
  const bottom = title.getBoundingClientRect().bottom;
  if (bottom <= 0) return null;
  bar.style.top = `${Math.round(bottom + TITLE_CLEARANCE_PX)}px`;
  return () => {
    bar.style.removeProperty('top');
  };
}
